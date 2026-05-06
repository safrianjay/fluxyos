from typing import List
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import datetime
import os

# Import local schemas
# Note: Ensure schemas.py exists in the same directory or adjust path
try:
    from schemas import DashboardSummary, TransactionResponse, ChatRequest, ChatResponse
except ImportError:
    # Fallback if schemas aren't found during direct execution
    from .schemas import DashboardSummary, TransactionResponse, ChatRequest, ChatResponse

app = FastAPI(title="FluxyOS API", version="2.4.1")

# SECURITY: CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/v1/dashboard/summary", response_model=DashboardSummary)
async def get_dashboard_summary():
    return {
        "revenue": "Rp 2.845M",
        "revenue_change": "14.2%",
        "opex": "Rp 682M",
        "margin": 76.0,
        "action_items_count": 5,
        "action_items_details": "3 Missing Receipts • 2 Approvals"
    }

@app.get("/api/v1/dashboard/ledger", response_model=List[TransactionResponse])
async def get_ledger():
    return [
        {
            "id": 1,
            "vendor_name": "TikTok Ads Pte Ltd",
            "amount": -4250000.0,
            "status": "Receipt Auto-Matched",
            "timestamp": datetime.datetime.now(),
            "category_name": "Q3 Marketing",
            "entity_name": "E-Commerce Brand",
            "icon": "📢"
        },
        {
            "id": 2,
            "vendor_name": "Midtrans Settlement",
            "amount": 18420000.0,
            "status": "Cleared",
            "timestamp": datetime.datetime.now() - datetime.timedelta(days=1),
            "category_name": "Revenue",
            "entity_name": "Global HQ",
            "icon": "M"
        }
    ]

@app.post("/api/v1/brain/chat", response_model=ChatResponse)
async def brain_chat(request: ChatRequest):
    return {
        "response": "I'm FluxyOS Brain. I can help you analyze your transactions.",
        "suggested_action": "View Insights"
    }

# MOUNT STATIC FILES
# This allows you to visit http://localhost:8000/dashboard.html
# and bypass the "ERR_ACCESS_DENIED" local file security error.
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
app.mount("/", StaticFiles(directory=parent_dir, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
