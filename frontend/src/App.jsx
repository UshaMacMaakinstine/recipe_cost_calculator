import React, { useState } from 'react';
import { UploadCloud, Mail, DollarSign, Calculator, RefreshCw, FileText, CheckCircle2, AlertCircle } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || "";

// Read token from ?access=KEY in URL, or from local storage
const urlParams = new URLSearchParams(window.location.search);
const urlToken = urlParams.get("access");
if (urlToken) {
  localStorage.setItem("staff_access_token", urlToken);
}
const staffToken = localStorage.getItem("staff_access_token") || "";

export default function App() {
  const [recipeName, setRecipeName] = useState("Savory Almond Meat Pie");
  const [baseYield, setBaseYield] = useState(6.0);
  const [baseUnit, setBaseUnit] = useState("lbs");
  const [targetYield, setTargetYield] = useState(24.0);
  
  // Cost Overheads
  const [laborRate, setLaborRate] = useState(15.0);
  const [numEmployees, setNumEmployees] = useState(2);
  const [hoursWorked, setHoursWorked] = useState(2.5);
  const [wastagePct, setWastagePct] = useState(2.0);
  const [utilitiesPct, setUtilitiesPct] = useState(3.0);

  // Email State
  const [emailList, setEmailList] = useState([]);
  const [selectedEmailId, setSelectedEmailId] = useState("");
  const [invoiceText, setInvoiceText] = useState("Munaf Greenvalley Invoice #4928: Ground Beef (80/20) - $4.10/lb | Chicken Breast Bone-in - $2.85/lb | Lamb Shoulder - $7.90/lb");
  const [statusMsg, setStatusMsg] = useState("");
  const [loading, setLoading] = useState(false);

  // Ingredients State
  const [ingredients, setIngredients] = useState([
    { name: "Ground Beef (80/20)", quantity: 3.0, unit: "lb", is_meat: true, unit_price: 4.10, source: "Munaf Greenvalley Invoice" },
    { name: "Almond Flour", quantity: 1.5, unit: "lb", is_meat: false, unit_price: 6.50, source: "Market Search Index" },
    { name: "Unsalted Butter", quantity: 0.5, unit: "lb", is_meat: false, unit_price: 3.80, source: "Market Search Index" },
    { name: "Eggs", quantity: 4.0, unit: "each", is_meat: false, unit_price: 0.30, source: "Market Search Index" }
  ]);

  // Scaling Factor
  const scaleMultiplier = baseYield > 0 ? (targetYield / baseYield) : 1;

  // File Upload & Decrypt
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    setStatusMsg("Decrypting recipe document with AI...");
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("${API_BASE}/api/extract-recipe", { method: "POST", headers: { "X-App-Access-Key": staffToken }, body: formData });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setRecipeName(data.recipe_name || "Custom Recipe");
      setBaseYield(data.base_yield_amount || 1.0);
      setBaseUnit(data.base_yield_unit || "lbs");
      setTargetYield((data.base_yield_amount || 1.0) * 4);
      setIngredients(data.ingredients || []);
      setStatusMsg("Recipe successfully parsed!");
    } catch (err) {
      setStatusMsg("Error parsing recipe: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Saved Recipes Library State
  const [savedRecipeList, setSavedRecipeList] = useState([]);
  const [selectedSavedRecipe, setSelectedSavedRecipe] = useState("");

  // Load existing recipe names on initial page render
  React.useEffect(() => {
    fetchSavedRecipesList();
  }, []);

  const fetchSavedRecipesList = async () => {
    try {
      const res = await fetch("${API_BASE}/api/recipes", { headers: { "X-App-Access-Key": staffToken }});
      if (res.ok) {
        const data = await res.json();
        setSavedRecipeList(data);
        if (data.length > 0 && !selectedSavedRecipe) {
          setSelectedSavedRecipe(data[0].name);
        }
      }
    } catch (err) {
      console.error("Failed to fetch saved recipes list:", err);
    }
  };

  const handleSaveRecipe = async () => {
    if (!recipeName.trim()) {
      alert("Please enter a recipe name before saving.");
      return;
    }
    setLoading(true);
    setStatusMsg(`Saving "${recipeName}" to memory...`);
    try {
      const payload = {
        recipe_name: recipeName,
        base_yield_amount: baseYield,
        base_yield_unit: baseUnit,
        ingredients: ingredients,
        labor_rate: laborRate,
        num_employees: numEmployees,
        hours_worked: hoursWorked,
        wastage_pct: wastagePct,
        utilities_pct: utilitiesPct,
      };

      const res = await fetch("${API_BASE}/api/recipes/save", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-App-Access-Key": staffToken },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(await res.text());
      await fetchSavedRecipesList();
      setSelectedSavedRecipe(recipeName);
      setStatusMsg(`"${recipeName}" saved permanently!`);
    } catch (err) {
      setStatusMsg("Save failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadRecipe = async () => {
    if (!selectedSavedRecipe) return;
    setLoading(true);
    setStatusMsg(`Loading "${selectedSavedRecipe}"...`);
    try {
      const res = await fetch(`${API_BASE}/api/recipes/${encodeURIComponent(selectedSavedRecipe)}`, {
  headers: { "X-App-Access-Key": staffToken }
});
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      setRecipeName(data.recipe_name);
      setBaseYield(data.base_yield_amount);
      setBaseUnit(data.base_yield_unit);
      setIngredients(data.ingredients || []);
      if (data.labor_rate !== undefined) setLaborRate(data.labor_rate);
      if (data.num_employees !== undefined) setNumEmployees(data.num_employees);
      if (data.hours_worked !== undefined) setHoursWorked(data.hours_worked);
      if (data.wastage_pct !== undefined) setWastagePct(data.wastage_pct);
      if (data.utilities_pct !== undefined) setUtilitiesPct(data.utilities_pct);

      setStatusMsg(`"${data.recipe_name}" loaded with all unit prices!`);
    } catch (err) {
      setStatusMsg("Failed loading recipe: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Search Supplier Emails
  const handleSearchEmails = async () => {
    setLoading(true);
    setStatusMsg("Searching inbox for Munaf Greenvalley invoices...");
    try {
      const res = await fetch("${API_BASE}/api/emails?limit=10", {
  headers: { "X-App-Access-Key": staffToken }
});
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setEmailList(data);
      if (data.length > 0) setSelectedEmailId(data[0].id);
      setStatusMsg(`Found ${data.length} emails from inbox!`);
    } catch (err) {
      const detail = err.response ? await err.response.text() : err.message;
      setStatusMsg("Email search failed: " + detail);
    } finally {
      setLoading(false);
    }
  };

  // Fetch Selected Email
  const handleLoadSelectedEmail = async () => {
    if (!selectedEmailId) return;
    setLoading(true);
    setStatusMsg("Fetching email content...");
    try {
      const res = await fetch(`${API_BASE}/api/emails/${selectedEmailId}`, {
  headers: { "X-App-Access-Key": staffToken }
});
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setInvoiceText(data.content);
      setStatusMsg("Invoice text loaded into active context!");
    } catch (err) {
      setStatusMsg("Failed loading email: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Enrich Prices via Backend AI
  const handleEnrichPrices = async () => {
    setLoading(true);
    setStatusMsg("Matching meat from invoice & searching market rates...");
    try {
    const res = await fetch("${API_BASE}/api/enrich-prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingredients, invoice_text: invoiceText })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      throw new Error(errData?.detail || `HTTP ${res.status}`);
    }
    const data = await res.json();
    setIngredients(data);
    setStatusMsg("Ingredient prices updated!");
  } catch (err) {
    setStatusMsg("Pricing failed: " + err.message);
  } finally {
    setLoading(false);
  }
  };

  // Update line item
  const updateIngredient = (index, field, value) => {
    const updated = [...ingredients];
    updated[index][field] = value;
    setIngredients(updated);
  };

  // Financial Calculations
  const rawMaterialsCost = ingredients.reduce((sum, item) => sum + (item.quantity * scaleMultiplier * (item.unit_price || 0)), 0);
  const wastageCost = rawMaterialsCost * (wastagePct / 100);
  const directLaborCost = hoursWorked * numEmployees * laborRate;
  const directSubtotal = rawMaterialsCost + wastageCost + directLaborCost;
  const utilitiesCost = directSubtotal * (utilitiesPct / 100);
  const totalBatchCost = directSubtotal + utilitiesCost;
  const costPerUnit = targetYield > 0 ? (totalBatchCost / targetYield) : 0;

  if (!staffToken) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-100 shadow-xl">
          <div className="text-4xl mb-4">🔒</div>
          <h2 className="text-xl font-bold mb-2">Restricted Staff Access</h2>
          <p className="text-sm text-slate-400 mb-6">
            This costing tool is private. Please access it using the secure link provided by management.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const val = e.target.elements.tokenInput.value.trim();
              if (val) {
                localStorage.setItem("staff_access_token", val);
                window.location.reload();
              }
            }}
            className="space-y-3"
          >
            <input
              name="tokenInput"
              type="password"
              placeholder="Or enter staff passcode..."
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-200 outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              className="w-full py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold transition"
            >
              Unlock App
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <header className="flex justify-between items-center border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <Calculator className="text-emerald-400" /> Standalone Recipe Cost Calculator
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Decentralized React UI connected to FastAPI backend. Automated AI OCR, IMAP Email Sync & Batch Scaling.
          </p>
        </div>
        {statusMsg && (
          <span className="text-xs bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-full text-emerald-400 animate-pulse">
            {statusMsg}
          </span>
        )}
      </header>

      {/* Grid: 2 Columns for Inputs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Step 1: Upload Recipe & Document AI */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <UploadCloud className="text-emerald-400 w-5 h-5" /> 1. Upload & Decrypt Recipe Document
          </h2>
          <label className="border-2 border-dashed border-slate-700 hover:border-emerald-500 rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer transition">
            <FileText className="text-slate-400 mb-2 w-8 h-8" />
            <span className="text-sm font-medium text-slate-300">Choose PDF, Image, or Scanned Recipe</span>
            <input type="file" className="hidden" accept=".pdf,image/*,.txt" onChange={handleFileUpload} />
          </label>
        </div>

        {/* Step 2: Gmail IMAP Sync */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <Mail className="text-blue-400 w-5 h-5" /> 2. Munaf Greenvalley Supplier Invoice (Gmail)
          </h2>
          <div className="flex gap-2">
            <button
              onClick={handleSearchEmails}
              disabled={loading}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-semibold text-slate-200 transition"
            >
              Search Inbox
            </button>
            {emailList.length > 0 && (
              <button
                onClick={handleLoadSelectedEmail}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold text-white transition"
              >
                Load Selected Invoice
              </button>
            )}
          </div>

          {emailList.length > 0 && (
            <select
              value={selectedEmailId}
              onChange={(e) => setSelectedEmailId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-slate-200"
            >
              {emailList.map((em) => (
                <option key={em.id} value={em.id}>{em.display}</option>
              ))}
            </select>
          )}

          <textarea
            value={invoiceText}
            onChange={(e) => setInvoiceText(e.target.value)}
            rows={3}
            placeholder="Active invoice text..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs font-mono text-slate-300"
          />
        </div>
      </div>

      {/* Recipe Library / Memory Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase font-semibold text-slate-400 tracking-wider">
            📁 Saved Recipe Vault:
          </span>
          {savedRecipeList.length > 0 ? (
            <select
              value={selectedSavedRecipe}
              onChange={(e) => setSelectedSavedRecipe(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200"
            >
              {savedRecipeList.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name} ({r.item_count} ingredients)
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-slate-500 italic">No recipes saved to vault yet</span>
          )}

          {savedRecipeList.length > 0 && (
            <button
              onClick={handleLoadRecipe}
              disabled={loading}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition"
            >
              📂 Load Selected
            </button>
          )}
        </div>

        <button
          onClick={handleSaveRecipe}
          disabled={loading}
          className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold flex items-center gap-2 transition"
        >
          💾 Save Current Recipe & Prices to Vault
        </button>
      </div>

      {/* Recipe Specs & Batch Scaling */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wider block">Recipe Name</label>
            <input
              type="text"
              value={recipeName}
              onChange={(e) => setRecipeName(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-sm font-semibold text-white"
            />
          </div>

          <div className="flex gap-4">
            <div>
              <label className="text-xs text-slate-400 uppercase tracking-wider block">Base Yield ({baseUnit})</label>
              <input
                type="number"
                value={baseYield}
                onChange={(e) => setBaseYield(parseFloat(e.target.value) || 0)}
                className="bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-sm w-24 text-center"
              />
            </div>
            <div>
              <label className="text-xs text-emerald-400 uppercase tracking-wider block">Target Output ({baseUnit})</label>
              <input
                type="number"
                value={targetYield}
                onChange={(e) => setTargetYield(parseFloat(e.target.value) || 0)}
                className="bg-slate-950 border border-emerald-500 rounded px-3 py-1.5 text-sm w-28 text-center font-bold text-emerald-400"
              />
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded px-4 py-1 flex flex-col justify-center text-center">
              <span className="text-[10px] text-slate-400 uppercase">Scale Factor</span>
              <span className="text-base font-bold text-cyan-400">{scaleMultiplier.toFixed(2)}x</span>
            </div>
          </div>

          <button
            onClick={handleEnrichPrices}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-medium transition shadow-lg shadow-emerald-950"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Auto-Price Ingredients
          </button>
        </div>

        {/* Ingredients Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-950 text-slate-400 uppercase text-[11px] border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-3">Ingredient</th>
                <th className="py-2.5 px-3">Base Qty</th>
                <th className="py-2.5 px-3">Unit</th>
                <th className="py-2.5 px-3 text-center">Is Meat?</th>
                <th className="py-2.5 px-3 text-cyan-400">Scaled Qty ({scaleMultiplier.toFixed(1)}x)</th>
                <th className="py-2.5 px-3">Unit Price ($)</th>
                <th className="py-2.5 px-3">Total Cost ($)</th>
                <th className="py-2.5 px-3">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {ingredients.map((item, idx) => {
                const scaledQty = item.quantity * scaleMultiplier;
                const lineTotal = scaledQty * (item.unit_price || 0);
                return (
                  <tr key={idx} className="hover:bg-slate-850">
                    <td className="py-2 px-3 font-medium text-slate-200">
                      <input
                        type="text"
                        value={item.name}
                        onChange={(e) => updateIngredient(idx, "name", e.target.value)}
                        className="bg-transparent border-none text-white focus:ring-0 w-full"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        step="0.01"
                        value={item.quantity}
                        onChange={(e) => updateIngredient(idx, "quantity", parseFloat(e.target.value) || 0)}
                        className="w-16 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-center"
                      />
                    </td>
                    <td className="py-2 px-3 text-slate-400">{item.unit}</td>
                    <td className="py-2 px-3 text-center">
                      <input
                        type="checkbox"
                        checked={item.is_meat}
                        onChange={(e) => updateIngredient(idx, "is_meat", e.target.checked)}
                        className="rounded border-slate-700 text-emerald-500 focus:ring-0 bg-slate-950"
                      />
                    </td>
                    <td className="py-2 px-3 font-semibold text-cyan-400">{scaledQty.toFixed(2)} {item.unit}</td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        step="0.01"
                        value={item.unit_price}
                        onChange={(e) => updateIngredient(idx, "unit_price", parseFloat(e.target.value) || 0)}
                        className="w-20 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-right font-mono"
                      />
                    </td>
                    <td className="py-2 px-3 font-mono font-bold text-white">${lineTotal.toFixed(2)}</td>
                    <td className="py-2 px-3">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${item.is_meat ? 'bg-red-950 text-red-300 border border-red-800' : 'bg-slate-800 text-slate-300'}`}>
                        {item.source}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Production Overheads & Financial Dashboard */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Overhead Controls */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Labor & Overhead Rates</h3>
          <div>
            <label className="text-xs text-slate-400 flex justify-between">
              <span>Labor Rate ($/hr)</span>
              <span className="text-white">${laborRate}</span>
            </label>
            <input type="number" step="0.5" value={laborRate} onChange={(e) => setLaborRate(parseFloat(e.target.value) || 0)} className="w-full bg-slate-950 border border-slate-700 rounded p-1 text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs text-slate-400 flex justify-between">
              <span>Number of Employees</span>
              <span className="text-white">{numEmployees}</span>
            </label>
            <input type="number" value={numEmployees} onChange={(e) => setNumEmployees(parseInt(e.target.value) || 1)} className="w-full bg-slate-950 border border-slate-700 rounded p-1 text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs text-slate-400 flex justify-between">
              <span>Batch Hours Worked</span>
              <span className="text-white">{hoursWorked} hrs</span>
            </label>
            <input type="number" step="0.25" value={hoursWorked} onChange={(e) => setHoursWorked(parseFloat(e.target.value) || 0)} className="w-full bg-slate-950 border border-slate-700 rounded p-1 text-sm mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-2 pt-2">
            <div>
              <span className="text-[11px] text-slate-400 block">Wastage %</span>
              <input type="number" step="0.5" value={wastagePct} onChange={(e) => setWastagePct(parseFloat(e.target.value) || 0)} className="w-full bg-slate-950 border border-slate-700 rounded p-1 text-sm" />
            </div>
            <div>
              <span className="text-[11px] text-slate-400 block">Utilities %</span>
              <input type="number" step="0.5" value={utilitiesPct} onChange={(e) => setUtilitiesPct(parseFloat(e.target.value) || 0)} className="w-full bg-slate-950 border border-slate-700 rounded p-1 text-sm" />
            </div>
          </div>
        </div>

        {/* Metric Cards */}
        <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col justify-between">
            <span className="text-xs text-slate-400 uppercase">Scaled Raw Materials</span>
            <span className="text-2xl font-bold font-mono text-white">${rawMaterialsCost.toFixed(2)}</span>
            <span className="text-[11px] text-slate-500">Base sum × {scaleMultiplier.toFixed(1)}</span>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col justify-between">
            <span className="text-xs text-slate-400 uppercase">Direct Labor</span>
            <span className="text-2xl font-bold font-mono text-white">${directLaborCost.toFixed(2)}</span>
            <span className="text-[11px] text-slate-500">{hoursWorked}h × {numEmployees} staff @ ${laborRate}</span>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col justify-between">
            <span className="text-xs text-slate-400 uppercase">Wastage + Utilities</span>
            <span className="text-2xl font-bold font-mono text-amber-400">${(wastageCost + utilitiesCost).toFixed(2)}</span>
            <span className="text-[11px] text-slate-500">Wastage: ${wastageCost.toFixed(2)} | Util: ${utilitiesCost.toFixed(2)}</span>
          </div>

          <div className="bg-emerald-950/40 border border-emerald-600/50 p-4 rounded-xl flex flex-col justify-between shadow-lg">
            <span className="text-xs text-emerald-400 uppercase font-semibold">Total Batch Cost</span>
            <span className="text-3xl font-extrabold font-mono text-emerald-300">${totalBatchCost.toFixed(2)}</span>
            <span className="text-xs font-semibold text-emerald-400">
              ${costPerUnit.toFixed(2)} / {baseUnit} ({targetYield} {baseUnit})
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
