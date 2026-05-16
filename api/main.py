from typing import List
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import datetime
import os
import json
import urllib.request
from jose import jwt, JWTError

try:
    from schemas import DashboardSummary, TransactionResponse, ChatRequest, ChatResponse
except ImportError:
    from .schemas import DashboardSummary, TransactionResponse, ChatRequest, ChatResponse

app = FastAPI(title="FluxyOS API", version="2.4.1")

# CORS: read allowed origins from env — never use wildcard with credentials
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:8000,http://127.0.0.1:5500")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

# Firebase token verification
FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "")
_bearer = HTTPBearer()

def _fetch_google_public_keys() -> dict:
    url = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
    with urllib.request.urlopen(url, timeout=5) as resp:
        return json.loads(resp.read())

def verify_firebase_token(credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    token = credentials.credentials
    try:
        header = jwt.get_unverified_header(token)
        certs = _fetch_google_public_keys()
        public_key = certs.get(header.get("kid"))
        if not public_key:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        payload = jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            audience=FIREBASE_PROJECT_ID,
            issuer=f"https://securetoken.google.com/{FIREBASE_PROJECT_ID}",
        )
        return payload
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


@app.get("/api/v1/dashboard/summary", response_model=DashboardSummary)
async def get_dashboard_summary(_user=Depends(verify_firebase_token)):
    return {
        "revenue": "Rp 2.845M",
        "revenue_change": "14.2%",
        "opex": "Rp 682M",
        "margin": 76.0,
        "action_items_count": 5,
        "action_items_details": "3 Missing Receipts • 2 Approvals"
    }

@app.get("/api/v1/dashboard/ledger", response_model=List[TransactionResponse])
async def get_ledger(_user=Depends(verify_firebase_token)):
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
async def brain_chat(request: ChatRequest, _user=Depends(verify_firebase_token)):
    return {
        "response": "I'm FluxyOS Brain. I can help you analyze your transactions.",
        "suggested_action": "View Insights"
    }

# Dev-only static file serving. In production, Netlify serves these directly.
# Never enable this in production — it would expose .env and config files.
if os.getenv("ENVIRONMENT", "production") == "development":
    current_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(current_dir)
    app.mount("/", StaticFiles(directory=parent_dir, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
