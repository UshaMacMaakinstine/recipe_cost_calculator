Recipe Cost Calculator — Quick Start Guide

A tool to upload recipes, pull meat prices automatically from your email invoice, and calculate production batch costs.

Prerequisites

Make sure you have installed:

Python (version 3.10 or newer)

Node.js (LTS version)

1. Setup & Start the Backend

Open a terminal (PowerShell on Windows) and run:

cd backend
python -m venv venv

# Activate virtual environment:
# On Windows:
.\venv\Scripts\Activate.ps1
# On Mac/Linux:
source venv/bin/activate

# Install dependencies:
pip install -r requirements.txt


Add Your Credentials

Inside the backend folder, create a file named .env and paste:

OPENAI_API_KEY=your_openai_api_key_here
IMAP_SERVER=imap.gmail.com
EMAIL_USER=your_email@gmail.com
EMAIL_PASSWORD=your_16_character_app_password


Start Backend Server

uvicorn main:app --reload --port 8000


(Leave this terminal window open)

2. Start the Frontend

Open a second terminal window and run:

cd frontend
npm install
npm run dev


Open your browser and visit: http://localhost:3000

How to Use It

Upload Recipe: Drop in a PDF, image, or text file of your recipe.

Fetch Supplier Prices: Click Search Inbox, choose the latest invoice email, and click Load Selected Invoice.

Auto-Price: Click Auto-Price Ingredients to match meat cuts against the invoice and estimate standard grocery items.

Scale Batch: Enter how much you want to make (e.g., change from 6 lbs to 24 lbs). The dashboard updates total cost and cost-per-pound automatically.