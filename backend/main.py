import os
import re
import io
import json
import base64
import email
from email.header import decode_header
import imaplib
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

def verify_access_token(x_app_access_key: Optional[str] = Header(None)):
    configured_key = os.getenv("APP_SECRET_KEY")
    if not configured_key:
        return True
    if not x_app_access_key or x_app_access_key != configured_key:
        raise HTTPException(status_code=401, detail="Unauthorized: Invalid staff access token.")
    return True

app = FastAPI(title="Recipe Cost Calculator API", dependencies=[Depends(verify_access_token)])

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Ingredient(BaseModel):
    name: str
    quantity: float
    unit: str
    is_meat: bool = False
    unit_price: float = 0.0
    source: str = "Pending"

class RecipeExtractionResponse(BaseModel):
    recipe_name: str
    base_yield_amount: float
    base_yield_unit: str
    ingredients: List[Ingredient]

class EmailItem(BaseModel):
    id: str
    display: str
    subject: str

class PriceEnrichmentRequest(BaseModel):
    ingredients: List[Ingredient]
    invoice_text: str

class SavedRecipe(BaseModel):
    recipe_name: str
    base_yield_amount: float
    base_yield_unit: str
    ingredients: List[Ingredient]
    labor_rate: Optional[float] = 15.0
    num_employees: Optional[int] = 2
    hours_worked: Optional[float] = 2.5
    wastage_pct: Optional[float] = 2.0
    utilities_pct: Optional[float] = 3.0

# ----------------- Persistent Recipe Storage (Disk JSON) -----------------
RECIPES_DB_FILE = "saved_recipes.json"

def read_db() -> dict:
    if not os.path.exists(RECIPES_DB_FILE):
        with open(RECIPES_DB_FILE, "w") as f:
            json.dump({}, f)
        return {}
    try:
        with open(RECIPES_DB_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {}

def write_db(data: dict):
    with open(RECIPES_DB_FILE, "w") as f:
        json.dump(data, f, indent=2)

@app.post("/api/recipes/save")
def save_recipe(recipe: SavedRecipe):
    if not recipe.recipe_name.strip():
        raise HTTPException(status_code=400, detail="Recipe name cannot be empty.")
    db = read_db()
    db[recipe.recipe_name.strip()] = recipe.model_dump()
    write_db(db)
    return {"message": f"Recipe '{recipe.recipe_name}' saved successfully."}

@app.get("/api/recipes")
def list_saved_recipes():
    db = read_db()
    # Returns a list of recipe names and their ingredient counts
    return [{"name": name, "item_count": len(data.get("ingredients", []))} for name, data in db.items()]

@app.get("/api/recipes/{recipe_name}", response_model=SavedRecipe)
def get_saved_recipe(recipe_name: str):
    db = read_db()
    if recipe_name not in db:
        raise HTTPException(status_code=404, detail=f"Recipe '{recipe_name}' not found.")
    return db[recipe_name]

def get_openai_client():
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is missing from backend/.env")
    return OpenAI(api_key=api_key)

def get_imap_connection():
    host = os.getenv("IMAP_SERVER", "imap.gmail.com")
    user = os.getenv("EMAIL_USER")
    password = os.getenv("EMAIL_PASSWORD")
    if not user or not password:
        raise HTTPException(status_code=400, detail="EMAIL_USER and EMAIL_PASSWORD must be configured in .env")
    mail = imaplib.IMAP4_SSL(host)
    mail.login(user, password)
    return mail

# ----------------- 1. Extract Recipe via OpenAI Vision / Text -----------------
@app.post("/api/extract-recipe", response_model=RecipeExtractionResponse)
async def extract_recipe(file: UploadFile = File(...)):
    client = get_openai_client()
    file_bytes = await file.read()
    content_type = file.content_type or "application/pdf"

    system_prompt = (
        "You are an expert culinary operations specialist. Analyze the provided recipe document. "
        "Extract the recipe name, base yield amount, yield unit, and ingredient items. "
        "IMPORTANT: If any meat ingredient (beef, chicken, lamb, goat, poultry, etc.) is specified in grams (g), kilograms (kg), or ounces (oz), "
        "AUTOMATICALLY convert its quantity to pounds (lb) (e.g., 500g -> 1.10 lb, 1kg -> 2.20 lb) and set its unit strictly to 'lb'. "
        "Strictly mark is_meat=true for all meat ingredients. "
        "Return a JSON object matching this schema: "
        "{\"recipe_name\": string, \"base_yield_amount\": float, \"base_yield_unit\": string, "
        "\"ingredients\": [{\"name\": string, \"quantity\": float, \"unit\": string, \"is_meat\": bool, \"unit_price\": 0.0, \"source\": \"Pending\"}]}"
    )

    try:
        # If image, send via Vision
        if content_type.startswith("image/"):
            b64_image = base64.b64encode(file_bytes).decode("utf-8")
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "Extract all ingredients and base yield from this recipe image."},
                            {"type": "image_url", "image_url": {"url": f"data:{content_type};base64,{b64_image}"}}
                        ]
                    }
                ],
                temperature=0.1
            )
        else:
            # Fallback for text/markdown recipe documents
            text_content = file_bytes.decode("utf-8", errors="ignore")
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Recipe Text:\n{text_content}"}
                ],
                temperature=0.1
            )

        raw_json = response.choices[0].message.content
        return json.loads(raw_json)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OpenAI Recipe Extraction failed: {str(e)}")

# ----------------- 2. Search Inbox for Invoices -----------------
@app.get("/api/emails", response_model=List[EmailItem])
def list_supplier_emails(limit: int = 15):
    try:
        mail = get_imap_connection()
        mail.select("INBOX")
        status, messages = mail.search(None, 'ALL')
        if status != "OK" or not messages[0]:
            mail.logout()
            return []

        msg_ids = messages[0].split()
        scan_ids = msg_ids[-50:]
        results = []

        for m_id in reversed(scan_ids):
            res, data = mail.fetch(m_id, "(BODY.PEEK[HEADER.FIELDS (SUBJECT DATE FROM)])")
            if not data or not data[0] or not isinstance(data[0], tuple):
                continue

            msg = email.message_from_bytes(data[0][1])
            raw_sub = msg.get("Subject", "(No Subject)")
            sub, enc = decode_header(raw_sub)[0]
            if isinstance(sub, bytes):
                sub = sub.decode(enc or "utf-8", errors="ignore")

            raw_from = msg.get("From", "")
            sender, s_enc = decode_header(raw_from)[0]
            if isinstance(sender, bytes):
                sender = sender.decode(s_enc or "utf-8", errors="ignore")

            date_str = msg.get("Date", "Unknown Date")
            searchable = f"{sub} {sender}".lower()
            keywords = ["price list", "price", "greenvalley", "green valley", "munaf", "kitabi", "book"]

            if any(k in searchable for k in keywords):
                results.append({
                    "id": m_id.decode("utf-8"),
                    "display": f"{date_str[:16]} — {sub}",
                    "subject": sub
                })

            if len(results) >= limit:
                break

        mail.logout()
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"IMAP Error: {str(e)}")

# ----------------- 3. Fetch Email Body & Parse Excel Attachments -----------------
@app.get("/api/emails/{email_id}")
def get_email_content(email_id: str):
    try:
        mail = get_imap_connection()
        mail.select("INBOX")
        res, data = mail.fetch(email_id.encode("utf-8"), "(RFC822)")
        msg = email.message_from_bytes(data[0][1])

        body_text = ""
        attachment_tables = []

        if msg.is_multipart():
            for part in msg.walk():
                ctype = part.get_content_type()
                filename = part.get_filename() or ""
                if filename:
                    h_filename, enc = decode_header(filename)[0]
                    if isinstance(h_filename, bytes):
                        filename = h_filename.decode(enc or "utf-8", errors="ignore")

                if ctype == "text/plain" and not filename:
                    body_text += part.get_payload(decode=True).decode(errors="ignore") + "\n"

                # Parse .xlsx or .xls attachments directly with pandas
                if filename.lower().endswith((".xlsx", ".xls")):
                    payload = part.get_payload(decode=True)
                    try:
                        df = pd.read_excel(io.BytesIO(payload))
                        df = df.dropna(how="all").dropna(axis=1, how="all")
                        attachment_tables.append(f"--- Attachment: {filename} ---\n{df.to_string(index=False)}")
                    except Exception as parse_err:
                        attachment_tables.append(f"[Failed parsing {filename}: {str(parse_err)}]")
        else:
            body_text = msg.get_payload(decode=True).decode(errors="ignore")

        mail.logout()
        full_text = body_text.strip()
        if attachment_tables:
            full_text += "\n\n" + "\n\n".join(attachment_tables)

        return {"content": full_text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # ----------------- 4. Enrich Prices via OpenAI (gpt-4o-mini) -----------------
    def convert_to_lbs(quantity: float, unit: str) -> float:
        u = unit.lower().strip()
        if u in ["g", "gram", "grams"]:
            return quantity / 453.59237
        elif u in ["kg", "kilogram", "kilograms", "kilo", "kilos"]:
            return quantity * 2.20462
        elif u in ["oz", "ounce", "ounces"]:
            return quantity / 16.0
        return quantity

    @app.post("/api/enrich-prices", response_model=List[Ingredient])
    def enrich_prices(payload: PriceEnrichmentRequest):
        client = get_openai_client()

        # Standardize all meat ingredients to 'lb' before sending to OpenAI
        normalized_ingredients = []
        for item in payload.ingredients:
            if item.is_meat and item.unit.lower().strip() not in ["lb", "lbs", "pound", "pounds"]:
                converted_qty = round(convert_to_lbs(item.quantity, item.unit), 3)
                normalized_ingredients.append(
                    Ingredient(
                        name=item.name,
                        quantity=converted_qty,
                        unit="lb",
                        is_meat=True,
                        unit_price=item.unit_price,
                        source=item.source
                    )
                )
            else:
                normalized_ingredients.append(item)

        invoice_snippet = payload.invoice_text[:8000] if payload.invoice_text else "No invoice text provided."
        compact_ingredients = [
            {"name": item.name, "quantity": item.quantity, "unit": item.unit, "is_meat": item.is_meat}
            for item in normalized_ingredients
        ]

        prompt = f"""
    You are a wholesale food costing analyst.
    Supplier invoice data from Green Valley Meat Distributors:
    \"\"\"{invoice_snippet}\"\"\"

    Ingredients to price:
    {json.dumps(compact_ingredients)}

    TASK:
    1. For every ingredient with "is_meat": true:
    - Ensure the unit remains strictly "lb" (pounds).
    - Match and extract the price per lb ($/lb) from the Green Valley invoice data (e.g. matching Ground Beef 80/20 to BEEF GROUND 80/20). If not present, assign a realistic wholesale meat benchmark price per lb.
    2. For non-meat ingredients:
    - Estimate current benchmark wholesale US grocery market price per specified unit.

    Return a JSON object with an "items" array matching this exact schema:
    {{
    "items": [
        {{
        "name": "string",
        "quantity": float,
        "unit": "string",
        "is_meat": boolean,
        "unit_price": float,
        "source": "Green Valley Meat Attachment" or "Market Search Index"
        }}
    ]
    }}
    """

        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": "You are a precise food operations costing engine that only responds in valid raw JSON."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.1
            )

            data = json.loads(response.choices[0].message.content)
            items = data.get("items") or data.get("ingredients") or (data if isinstance(data, list) else list(data.values())[0])

            # Enforce that every meat entry has unit set to 'lb'
            for item in items:
                if item.get("is_meat"):
                    item["unit"] = "lb"

            return items

        except Exception as e:
            raise HTTPException(status_code=500, detail=f"OpenAI pricing error: {str(e)}")

# ----------------- 5. Enrich Prices via OpenAI (gpt-4o-mini) -----------------
@app.post("/api/enrich-prices", response_model=List[Ingredient])
def enrich_prices(payload: PriceEnrichmentRequest):
    client = get_openai_client()

    invoice_snippet = payload.invoice_text[:8000] if payload.invoice_text else "No invoice text provided."
    compact_ingredients = [
        {"name": item.name, "quantity": item.quantity, "unit": item.unit, "is_meat": item.is_meat}
        for item in payload.ingredients
    ]

    prompt = f"""
You are a wholesale food costing analyst.
Supplier invoice data from Green Valley Meat Distributors:
\"\"\"{invoice_snippet}\"\"\"

Ingredients to price:
{json.dumps(compact_ingredients)}

TASK:
1. For every ingredient with "is_meat": true, search and match the price per unit ($/lb, $/kg) from the Green Valley invoice text above (e.g. matching Ground Beef 80/20 to BEEF GROUND 80/20). If not present, assign realistic wholesale meat price.
2. For non-meat ingredients, estimate current benchmark wholesale US grocery market price per unit.

Return a JSON object with an "items" array matching this exact schema:
{{
  "items": [
    {{
      "name": "string",
      "quantity": float,
      "unit": "string",
      "is_meat": boolean,
      "unit_price": float,
      "source": "Green Valley Meat Attachment" or "Market Search Index"
    }}
  ]
}}
"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "You are a precise food operations costing engine that only responds in valid raw JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.1
        )

        data = json.loads(response.choices[0].message.content)
        if "items" in data:
            return data["items"]
        if "ingredients" in data:
            return data["ingredients"]
        if isinstance(data, list):
            return data
        return list(data.values())[0]

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OpenAI pricing error: {str(e)}")