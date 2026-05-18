from typing import Any, Dict, List
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import datetime
import os
import json
import urllib.request
import urllib.parse
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
        payload["_id_token"] = token
        return payload
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


FINANCE_SCOPE = "project_finance"
REFUSAL_MESSAGE = "I can help with FluxyOS finance data, business performance, bills, subscriptions, revenue, expenses, and operational financial risks. I can't answer unrelated questions here."
REVENUE_TYPES = {"income", "revenue", "refund"}
EXPECTED_REVENUE_TYPES = {"income", "revenue", "refund", "pending_receivable"}
OPEX_TYPES = {"expense", "fee", "tax"}
OBLIGATION_OPEX_TYPES = {"expense", "fee", "tax", "pending_payable"}
PAID_STATUSES = {"completed", "paid", "reconciled", "cancelled"}

def _today_jakarta() -> datetime.date:
    return (datetime.datetime.utcnow() + datetime.timedelta(hours=7)).date()

def _period_dict(period) -> Dict[str, str]:
    today = _today_jakarta()
    if period and period.type == "last_month":
        first_this = today.replace(day=1)
        end = first_this - datetime.timedelta(days=1)
        start = end.replace(day=1)
        return {"type": "last_month", "label": "Last month", "start_date": start.isoformat(), "end_date": end.isoformat()}
    if period and period.type == "custom" and period.start_date and period.end_date:
        return {"type": "custom", "label": "Selected period", "start_date": period.start_date, "end_date": period.end_date}
    start = today.replace(day=1)
    next_month = (start.replace(day=28) + datetime.timedelta(days=4)).replace(day=1)
    end = next_month - datetime.timedelta(days=1)
    return {"type": "this_month", "label": "This month", "start_date": start.isoformat(), "end_date": end.isoformat()}

def _format_idr(value: float) -> str:
    return f"Rp {int(abs(value)):,}".replace(",", ".")

def _classify_intent(message: str, page_context: str = "global") -> str:
    msg = (message or "").lower()
    if not msg:
        return "ambiguous"
    if any(term in msg for term in ["president", "politic", "medical", "dating", "crypto", "bitcoin", "legal advice", "investment advice", "weather"]):
        return "unsupported"
    if msg.strip() in {"hi", "hello", "hey", "test"}:
        return "ambiguous"
    if any(term in msg for term in ["receipt", "cleanup", "clean up", "trust my ledger", "reconcile"]):
        return "ledger_cleanup"
    if any(term in msg for term in ["subscription", "saas", "renewal", "recurring"]):
        return "subscription_analysis"
    if any(term in msg for term in ["bill", "payable", "due soon", "overdue", "cash pressure"]):
        return "bills_analysis"
    if any(term in msg for term in ["margin", "profitable", "profitability"]):
        return "margin_analysis"
    if any(term in msg for term in ["expense", "spend", "opex", "cost", "vendor"]):
        return "expense_analysis"
    if any(term in msg for term in ["revenue", "income", "receivable", "sales"]):
        return "revenue_analysis"
    if any(term in msg for term in ["what should i", "fix first", "needs attention", "biggest problem", "worry"]):
        return "action_recommendation"
    if any(term in msg for term in ["healthy", "health", "summary", "summarize", "performance", "founder"]):
        return "finance_health"
    if any(term in msg for term in ["show", "find", "list"]):
        return "data_lookup"
    return {
        "ledger": "ledger_cleanup",
        "bills": "bills_analysis",
        "subscriptions": "subscription_analysis",
        "revenue_sync": "revenue_analysis",
    }.get(page_context, "finance_health")

def _decode_firestore_value(value: Dict[str, Any]) -> Any:
    if "stringValue" in value:
        return value["stringValue"]
    if "integerValue" in value:
        return float(value["integerValue"])
    if "doubleValue" in value:
        return float(value["doubleValue"])
    if "booleanValue" in value:
        return bool(value["booleanValue"])
    if "timestampValue" in value:
        return value["timestampValue"]
    if "arrayValue" in value:
        return [_decode_firestore_value(v) for v in value.get("arrayValue", {}).get("values", [])]
    if "mapValue" in value:
        return {k: _decode_firestore_value(v) for k, v in value.get("mapValue", {}).get("fields", {}).items()}
    return None

def _decode_firestore_doc(document: Dict[str, Any]) -> Dict[str, Any]:
    fields = document.get("fields", {})
    decoded = {k: _decode_firestore_value(v) for k, v in fields.items()}
    decoded["id"] = document.get("name", "").split("/")[-1]
    return decoded

def _fetch_collection(uid: str, token: str, collection_name: str, page_size: int = 1000) -> List[Dict[str, Any]]:
    project_id = FIREBASE_PROJECT_ID or "fluxyos"
    uid_encoded = urllib.parse.quote(uid, safe="")
    collection_encoded = urllib.parse.quote(collection_name, safe="")
    url = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents/users/{uid_encoded}/{collection_encoded}?pageSize={page_size}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return []
        raise
    return [_decode_firestore_doc(doc) for doc in data.get("documents", [])]

def _parse_record_date(value) -> datetime.date | None:
    if not value:
        return None
    try:
        if isinstance(value, str):
            return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        return None
    return None

def _in_period(record: Dict[str, Any], period: Dict[str, str], field: str = "timestamp") -> bool:
    date = _parse_record_date(record.get(field))
    if not date:
        return False
    start = datetime.date.fromisoformat(period["start_date"])
    end = datetime.date.fromisoformat(period["end_date"])
    return start <= date <= end

def _key_number(label: str, value: float, status_value: str = "neutral", formatted: str | None = None) -> Dict[str, Any]:
    return {"label": label, "value": value, "formatted_value": formatted or _format_idr(value), "status": status_value}

def _compact(record: Dict[str, Any], date_field: str = "timestamp") -> Dict[str, Any]:
    amount = float(record.get("amount") or 0)
    return {
        "id": record.get("id"),
        "vendor_name": record.get("vendor_name") or "Unnamed record",
        "category": record.get("category") or "Uncategorized",
        "type": record.get("type") or "unknown",
        "status": record.get("status") or "Unknown",
        "amount": amount,
        "formatted_amount": _format_idr(amount),
        "date": record.get(date_field) or record.get("timestamp"),
    }

def _build_answer(intent: str, message: str, period: Dict[str, str], transactions: List[Dict[str, Any]], bills: List[Dict[str, Any]], subscriptions: List[Dict[str, Any]], page_context: str = "global") -> Dict[str, Any]:
    base = {
        "intent": intent,
        "scope": FINANCE_SCOPE,
        "answer_type": "analysis",
        "confidence": 0.82,
        "period": {"label": period["label"], "start_date": period["start_date"], "end_date": period["end_date"]},
        "direct_answer": "",
        "key_numbers": [],
        "insights": [],
        "recommended_actions": [],
        "limitations": ["FastAPI compatibility path uses deterministic FluxyOS finance calculations."],
        "follow_up_questions": [],
    }
    if intent == "unsupported":
        base.update({"answer_type": "refusal", "confidence": 1, "direct_answer": REFUSAL_MESSAGE})
        return base
    if intent == "ambiguous":
        base.update({
            "answer_type": "clarification",
            "direct_answer": "What finance area should I check first: business health, revenue, expenses, bills, subscriptions, or ledger cleanup?",
            "follow_up_questions": ["Which finance area should I analyze?"],
        })
        return base

    period_txs = [tx for tx in transactions if _in_period(tx, period)]
    confirmed_revenue_records = [tx for tx in period_txs if str(tx.get("type", "")).lower() in REVENUE_TYPES]
    confirmed_expense_records = [tx for tx in period_txs if str(tx.get("type", "")).lower() in OPEX_TYPES]
    dashboard_revenue_records = [tx for tx in period_txs if str(tx.get("type", "")).lower() in EXPECTED_REVENUE_TYPES]
    dashboard_expense_records = [tx for tx in period_txs if str(tx.get("type", "")).lower() in OBLIGATION_OPEX_TYPES]
    use_dashboard_basis = page_context == "dashboard" and intent in {"finance_health", "action_recommendation"}
    revenue_records = dashboard_revenue_records if use_dashboard_basis else confirmed_revenue_records
    expense_records = dashboard_expense_records if use_dashboard_basis else confirmed_expense_records
    revenue = sum(abs(float(tx.get("amount") or 0)) for tx in revenue_records)
    opex = sum(abs(float(tx.get("amount") or 0)) for tx in expense_records)
    margin = ((revenue - opex) / revenue * 100) if revenue > 0 else 0
    missing = [tx for tx in period_txs if tx.get("status") == "Missing Receipt"]

    if intent == "revenue_analysis":
        base["direct_answer"] = f"Based on the current records, revenue for {period['label'].lower()} is {_format_idr(revenue)}." if revenue else f"No confirmed revenue records were found for {period['label'].lower()}."
        base["key_numbers"] = [_key_number("Revenue", revenue, "good" if revenue else "warning")]
        base["insights"] = [{"title": "Revenue records", "description": f"{len(revenue_records)} confirmed revenue record(s) were found.", "severity": "info", "evidence": [_compact(r) for r in sorted(revenue_records, key=lambda r: abs(float(r.get('amount') or 0)), reverse=True)[:5]]}]
        base["recommended_actions"] = [{"title": "Check revenue records", "description": "Confirm revenue entries are up to date before using this as a performance view.", "priority": "medium"}]
        return base
    if intent == "expense_analysis":
        base["direct_answer"] = f"Your OpEx for {period['label'].lower()} is {_format_idr(opex)}." if opex else f"No expense records were found for {period['label'].lower()}."
        base["key_numbers"] = [_key_number("OpEx", opex, "critical" if revenue and opex > revenue else "neutral")]
        base["insights"] = [{"title": "Largest expenses", "description": "Here are the largest expense records found in this period.", "severity": "info", "evidence": [_compact(r) for r in sorted(expense_records, key=lambda r: abs(float(r.get('amount') or 0)), reverse=True)[:5]]}]
        base["recommended_actions"] = [{"title": "Review top spend drivers", "description": "Start with the largest vendor and category before cutting smaller costs.", "priority": "medium"}]
        return base
    if intent == "margin_analysis":
        base["direct_answer"] = f"Gross margin for {period['label'].lower()} is {margin:.1f}%." if revenue else f"Gross margin is unavailable because there is no confirmed revenue for {period['label'].lower()}."
        base["key_numbers"] = [_key_number("Revenue", revenue, "good" if revenue else "warning"), _key_number("OpEx", opex), _key_number("Gross margin", margin, "warning" if margin < 40 else "good", f"{margin:.1f}%")]
        base["recommended_actions"] = [{"title": "Review margin drivers", "description": "Check the largest expense categories and vendors first.", "priority": "high"}]
        return base
    if intent == "ledger_cleanup":
        base["direct_answer"] = f"I found {len(missing)} missing receipt record(s) for {period['label'].lower()}." if missing else f"The ledger looks clean for missing receipts in {period['label'].lower()}."
        base["key_numbers"] = [_key_number("Missing receipts", len(missing), "warning" if missing else "good", str(len(missing)))]
        base["insights"] = [{"title": "Missing receipts", "description": "These records need receipt attachments before the ledger is reliable for reporting.", "severity": "warning" if missing else "info", "evidence": [_compact(r) for r in missing[:5]]}]
        base["recommended_actions"] = [{"title": "Clean missing receipts first", "description": "Attach receipts for the highest-value missing receipt records before relying on reports.", "priority": "high" if missing else "low"}]
        return base

    unpaid_bills = [b for b in bills if str(b.get("status", "")).lower() not in PAID_STATUSES]
    subs_total = sum(abs(float(s.get("amount") or 0)) for s in subscriptions if str(s.get("status", "")).lower() != "cancelled")
    revenue_label = "Live Revenue" if use_dashboard_basis else "Revenue"
    base["direct_answer"] = f"Here is what I am seeing for {period['label'].lower()}: {revenue_label.lower()} is {_format_idr(revenue)}, OpEx is {_format_idr(opex)}, and gross margin is {margin:.1f}%." if period_txs else f"There is not enough ledger data for {period['label'].lower()} to judge business health yet."
    base["key_numbers"] = [_key_number(revenue_label, revenue, "good" if revenue else "warning"), _key_number("OpEx", opex), _key_number("Gross margin", margin, "warning" if margin < 40 else "good", f"{margin:.1f}%"), _key_number("Missing receipts", len(missing), "warning" if missing else "good", str(len(missing)))]
    base["insights"] = [
        {"title": "Bills pressure", "description": f"{len(unpaid_bills)} unpaid bill(s) are recorded.", "severity": "warning" if unpaid_bills else "info", "evidence": [_compact(b, "due_date") for b in unpaid_bills[:5]]},
        {"title": "Subscription spend", "description": f"Recorded subscription spend is {_format_idr(subs_total)}.", "severity": "info", "evidence": [_compact(s, "renewal_date") for s in subscriptions[:5]]},
    ]
    base["recommended_actions"] = [{"title": "Check the largest cost driver", "description": "Review top expenses and missing receipts before using this for reporting decisions.", "priority": "medium"}]
    if use_dashboard_basis:
        base["limitations"].append("Live Revenue includes pending receivables; OpEx includes pending payables.")
    base["limitations"].append("This is an operational finance signal from your FluxyOS data, not formal accounting or tax advice.")
    return base


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
    message = request.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")
    if len(message) > 500:
        raise HTTPException(status_code=400, detail="message must be 500 characters or fewer")

    period = _period_dict(request.period)
    intent = _classify_intent(message, request.page_context or "global")
    if intent in {"unsupported", "ambiguous"}:
        answer = _build_answer(intent, message, period, [], [], [], request.page_context or "global")
        return {"success": True, "intent": intent, "scope": FINANCE_SCOPE, "answer": answer, "related_records": [], "error": None}

    uid = _user.get("user_id") or _user.get("sub")
    token = _user.get("_id_token")
    try:
        transactions = _fetch_collection(uid, token, "transactions", 1000)
        bills = _fetch_collection(uid, token, "bills", 500)
        subscriptions = _fetch_collection(uid, token, "subscriptions", 500)
    except Exception:
        return {
            "success": False,
            "intent": intent,
            "scope": FINANCE_SCOPE,
            "answer": None,
            "related_records": [],
            "error": {"code": "tool_error", "message": "I could not read your finance data right now. Please try again."}
        }

    answer = _build_answer(intent, message, period, transactions, bills, subscriptions, request.page_context or "global")
    related_records = [record for item in answer.get("insights", []) for record in item.get("evidence", [])][:10]
    return {"success": True, "intent": intent, "scope": FINANCE_SCOPE, "answer": answer, "related_records": related_records, "error": None}

# Dev-only static file serving. In production, Netlify serves these directly.
# Never enable this in production — it would expose .env and config files.
if os.getenv("ENVIRONMENT", "production") == "development":
    current_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(current_dir)
    app.mount("/", StaticFiles(directory=parent_dir, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
