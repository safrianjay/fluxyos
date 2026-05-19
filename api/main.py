from typing import Any, Dict, List
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import datetime
import os
import json
import re
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
FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "fluxyos")
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
DOCUMENT_ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "application/pdf", "text/csv", "application/vnd.ms-excel"}
DOCUMENT_MAX_FILE_BYTES = 10 * 1024 * 1024
ALLOWED_CATEGORIES = {"Revenue", "Marketing", "Infrastructure", "Operations", "SaaS"}
MONTH_NAMES = {
    "january": 1, "jan": 1,
    "february": 2, "feb": 2,
    "march": 3, "mar": 3,
    "april": 4, "apr": 4,
    "may": 5,
    "june": 6, "jun": 6,
    "july": 7, "jul": 7,
    "august": 8, "aug": 8,
    "september": 9, "sep": 9, "sept": 9,
    "october": 10, "oct": 10,
    "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}

def _today_jakarta() -> datetime.date:
    return (datetime.datetime.utcnow() + datetime.timedelta(hours=7)).date()

def _infer_period_type_from_message(message: str) -> str | None:
    msg = (message or "").lower()
    if any(term in msg for term in ["bulan lalu", "bulan kemarin", "periode sebelumnya"]):
        return "last_month"
    if "month before" in msg or "previous performance" in msg or "last month's" in msg or "previous month's" in msg or "prior month's" in msg:
        return "last_month"
    if "last month" in msg or "previous month" in msg or "prior month" in msg:
        return "last_month"
    if "last performance month" in msg or "previous performance month" in msg:
        return "last_month"
    return None

def _month_period(year: int, month: int) -> Dict[str, str]:
    start = datetime.date(year, month, 1)
    end = (start.replace(day=28) + datetime.timedelta(days=4)).replace(day=1) - datetime.timedelta(days=1)
    label = start.strftime("%B %Y")
    return {"type": "month", "label": label, "start_date": start.isoformat(), "end_date": end.isoformat()}

def _quarter_period(year: int, quarter: int) -> Dict[str, str]:
    start_month = ((quarter - 1) * 3) + 1
    start = datetime.date(year, start_month, 1)
    end = (start.replace(day=28) + datetime.timedelta(days=95)).replace(day=1) - datetime.timedelta(days=1)
    return {"type": "quarter", "label": f"Q{quarter} {year}", "start_date": start.isoformat(), "end_date": end.isoformat()}

def _explicit_period_from_message(message: str) -> Dict[str, str] | None:
    msg = (message or "").lower()
    if re.search(r"\b(all time|all-time|lifetime|entire history|full history|since the beginning|from the beginning)\b", msg):
        return {"type": "all_time", "label": "All time", "start_date": "", "end_date": ""}
    q_match = re.search(r"\bq([1-4])\s+(20\d{2})\b", msg)
    if q_match:
        return _quarter_period(int(q_match.group(2)), int(q_match.group(1)))
    month_pattern = "|".join(MONTH_NAMES.keys())
    month_match = re.search(rf"\b({month_pattern})\s+(20\d{{2}})\b", msg)
    if month_match:
        return _month_period(int(month_match.group(2)), MONTH_NAMES[month_match.group(1)])
    return None

def _period_dict(period, message: str = "") -> Dict[str, str]:
    today = _today_jakarta()
    explicit = _explicit_period_from_message(message)
    if explicit:
        return explicit
    message_type = _infer_period_type_from_message(message)
    requested_type = period.type if period and period.type in {"this_month", "last_month", "custom"} else "this_month"
    resolved_type = requested_type if requested_type == "custom" else message_type or requested_type
    if resolved_type == "last_month":
        first_this = today.replace(day=1)
        end = first_this - datetime.timedelta(days=1)
        start = end.replace(day=1)
        return {"type": "last_month", "label": "Last month", "start_date": start.isoformat(), "end_date": end.isoformat()}
    if resolved_type == "custom" and period and period.start_date and period.end_date:
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
    finance_hints = ["finance", "business", "revenue", "income", "sales", "expense", "spend", "opex", "cost", "bill", "subscription", "saas", "ledger", "transaction", "receipt", "margin", "profit", "cash", "vendor", "category", "performance", "records"]
    if any(term in msg for term in ["president", "politic", "election", "medical", "doctor", "diagnosis", "dating", "crypto", "bitcoin", "stock pick", "stock to buy", "legal advice", "investment advice", "weather", "sports"]):
        return "unsupported"
    if msg.startswith("who is") and not any(term in msg for term in finance_hints):
        return "unsupported"
    if msg.strip() in {"hi", "hello", "hey", "test"}:
        return "ambiguous"
    if "compare" in msg or " vs " in msg or "versus" in msg or "better than" in msg or "changed" in msg:
        return "comparison"
    if _explicit_period_from_message(message) and any(term in msg for term in ["performance", "summarize", "summary", "how was", "how did"]):
        return "period_performance"
    if any(term in msg for term in ["receipt", "cleanup", "clean up", "trust my ledger", "reconcile"]):
        return "ledger_cleanup"
    if any(term in msg for term in ["subscription", "renewal", "recurring"]):
        return "subscription_analysis"
    if any(term in msg for term in ["revenue", "income", "receivable", "sales"]):
        return "revenue_analysis"
    if any(category.lower() in msg for category in ALLOWED_CATEGORIES if category != "Revenue"):
        return "category_analysis"
    if re.search(r"\b(?:spend|spent|pay|paid|transactions?|records?)\s+(?:on|to|from|for)\s+[a-z0-9&.\- ]{2,48}", msg):
        return "vendor_analysis"
    if any(term in msg for term in ["cash pressure", "cash runway", "cash risk", "cover upcoming", "can i cover", "cover my bills"]):
        return "cash_pressure"
    if any(term in msg for term in ["bill", "payable", "due soon", "overdue"]):
        return "bills_analysis"
    if any(term in msg for term in ["margin", "profitable", "profitability"]):
        return "margin_analysis"
    if any(term in msg for term in ["expense", "spend", "opex", "cost", "vendor"]):
        return "expense_analysis"
    if any(term in msg for term in ["what should i", "fix first", "needs attention", "biggest problem", "worry"]):
        return "recommendation"
    if any(term in msg for term in ["healthy", "health", "summary", "summarize", "performance", "founder"]):
        return "finance_health"
    if any(term in msg for term in ["show", "find", "list"]):
        return "lookup"
    return {
        "ledger": "ledger_cleanup",
        "bills": "bills_analysis",
        "subscriptions": "subscription_analysis",
        "revenue_sync": "revenue_analysis",
        "ai_command_center": "finance_health",
    }.get(page_context, "finance_health")

def _file_ext(file_name: str | None) -> str:
    return (file_name or "").rsplit(".", 1)[-1].lower() if "." in (file_name or "") else ""

def _guess_mime(file_name: str | None) -> str:
    ext = _file_ext(file_name)
    return {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
        "pdf": "application/pdf",
        "csv": "text/csv",
    }.get(ext, "application/octet-stream")

def _clean_stem(file_name: str | None) -> str:
    stem = (file_name or "Uploaded document").rsplit(".", 1)[0]
    return stem.replace("-", " ").replace("_", " ").strip()[:80] or "Uploaded document"

def _document_detection_payload(detected_type: str, confidence: float, destination: str, action: str, message: str, file_name: str | None = None, warnings: List[str] | None = None, preview: Dict[str, Any] | None = None) -> Dict[str, Any]:
    extracted_preview = preview or {}
    if file_name and "file_name" not in extracted_preview:
        extracted_preview["file_name"] = file_name
    return {
        "success": True,
        "detected_type": detected_type,
        "confidence": confidence,
        "recommended_destination": destination,
        "recommended_action": action,
        "message": message,
        "extracted_preview": extracted_preview,
        "warnings": warnings or [],
    }

def _detect_document_type(file_name: str | None, mime_type: str | None, size_bytes: int | None) -> Dict[str, Any]:
    normalized_mime = mime_type or _guess_mime(file_name)
    ext = _file_ext(file_name)
    text = f"{file_name or ''} {normalized_mime}".lower()

    if size_bytes and size_bytes > DOCUMENT_MAX_FILE_BYTES:
        return _document_detection_payload(
            "unsupported_file", 1, "none", "refuse",
            "This file is larger than the 10MB limit. Please upload a smaller financial document.",
            file_name,
            ["File too large."],
        )
    if normalized_mime not in DOCUMENT_ALLOWED_MIME and ext not in {"jpg", "jpeg", "png", "webp", "pdf", "csv"}:
        return _document_detection_payload(
            "unsupported_file", 1, "none", "refuse",
            "Unsupported file type. Please upload a JPG, PNG, WEBP, PDF, or CSV financial document.",
            file_name,
            ["Unsupported file type."],
        )
    if ext == "csv" or normalized_mime in {"text/csv", "application/vnd.ms-excel"}:
        return _document_detection_payload(
            "csv_transactions", 0.88, "ledger", "review_csv_import",
            "Looks like this is a CSV file. If it contains transaction rows, review it through the Ledger CSV import flow.",
            file_name,
            preview={"document_name": _clean_stem(file_name)},
        )
    if any(term in text for term in ["subscription", "renewal", "recurring", "saas", "workspace", "canva", "figma", "notion"]):
        return _document_detection_payload(
            "subscription_invoice", 0.78, "subscriptions", "review_as_subscription",
            "Looks like this is a subscription invoice. I can help route it to subscription review; saving still needs confirmation.",
            file_name,
            ["Subscription-specific extraction is not fully automated yet. Review before saving."],
            {"vendor_name": _clean_stem(file_name)},
        )
    if any(term in text for term in ["invoice", "bill", "tagihan", "faktur", "pln", "telkom", "vendor"]):
        return _document_detection_payload(
            "invoice" if "invoice" in text or "faktur" in text else "bill",
            0.82, "bills", "review_and_save_to_bills",
            "Looks like this is a bill. I can extract the vendor, amount, due date, invoice number, and category, then prepare it for review before saving it to Bills.",
            file_name,
            ["Bill extraction will open the existing review-before-save flow."],
            {"vendor_name": _clean_stem(file_name)},
        )
    if any(term in text for term in ["receipt", "struk", "nota", "kuitansi"]):
        return _document_detection_payload(
            "receipt", 0.78, "ledger", "review_as_expense",
            "Looks like this is a receipt. I can extract key details and prepare it for Ledger review.",
            file_name,
            ["No transaction will be created until you review and confirm."],
            {"vendor_name": _clean_stem(file_name)},
        )
    if any(term in text for term in ["bank statement", "rekening koran", "statement"]):
        return _document_detection_payload(
            "bank_statement", 0.76, "ledger", "review_transaction",
            "Looks like this is a bank statement. I can prepare it for Ledger review without creating a transaction automatically.",
            file_name,
            ["Bank statement import is not fully automated yet. Review the source before saving anything."],
            {"document_name": _clean_stem(file_name)},
        )
    if any(term in text for term in ["payment", "transfer", "bank", "bca", "mandiri", "bni", "bri", "settlement"]):
        return _document_detection_payload(
            "payment_screenshot", 0.75, "ledger", "review_transaction",
            "Looks like this is a payment or bank document. I can prepare it for transaction review in the Ledger.",
            file_name,
            ["No transaction will be created until you review and confirm."],
            {"document_name": _clean_stem(file_name)},
        )
    if any(term in text for term in ["revenue", "order", "sales", "shopify", "tokopedia", "shopee", "stripe", "midtrans"]):
        return _document_detection_payload(
            "revenue_report", 0.74, "revenue_sync", "ask_user",
            "Looks like this may be a revenue or order report. Revenue Sync integrations are not connected here yet, so review the source before importing anything.",
            file_name,
            ["Revenue Sync data may be limited if no integration is connected."],
            {"document_name": _clean_stem(file_name)},
        )
    if any(term in text for term in ["selfie", "profile", "avatar", "holiday", "vacation", "family", "random", "wallpaper", "logo", "brand photo"]):
        return _document_detection_payload(
            "non_financial_image", 0.72, "none", "refuse",
            "This does not look like a finance-related document. I can help with bills, receipts, transactions, subscriptions, revenue reports, and financial records inside FluxyOS.",
            file_name,
        )
    return _document_detection_payload(
        "unknown_financial_document", 0.52, "ai_review", "ask_user",
        "I found a supported document file, but I am not fully sure where it belongs. Choose where you want to review it before saving anything.",
        file_name,
        ["Low-confidence document routing. Please review before taking action."],
        {"document_name": _clean_stem(file_name)},
    )

def _mock_bill_extraction(file_name: str | None) -> Dict[str, Any]:
    return {
        "document_type": "invoice",
        "vendor_name": _clean_stem(file_name),
        "amount": 1250000,
        "currency": "IDR",
        "due_date": None,
        "invoice_date": None,
        "invoice_number": None,
        "category": "Operations",
        "confidence": {"overall": 0.5, "vendor_name": 0.5, "amount": 0.6, "due_date": 0.3, "category": 0.4},
        "warnings": ["Bill scanning provider not configured - showing sample data."],
        "raw_text_preview": None,
    }

def _normalize_input_amount(value: Any) -> int | None:
    if isinstance(value, (int, float)) and value > 0:
        return round(abs(value))
    cleaned = "".join(ch for ch in str(value or "") if ch.isdigit() or ch in ",.-")
    if not cleaned:
        return None
    last_comma = cleaned.rfind(",")
    last_dot = cleaned.rfind(".")
    normalized = cleaned
    if last_comma > last_dot:
        normalized = cleaned.replace(".", "").replace(",", ".")
    else:
        normalized = cleaned.replace(",", "")
        parts = normalized.split(".")
        if len(parts) > 2 or (len(parts) == 2 and len(parts[1]) == 3):
            normalized = normalized.replace(".", "")
    try:
        parsed = float(normalized)
    except ValueError:
        return None
    return round(abs(parsed)) if parsed > 0 else None

def _is_date_key(value: Any) -> bool:
    if not isinstance(value, str) or len(value) != 10:
        return False
    try:
        datetime.date.fromisoformat(value)
        return True
    except ValueError:
        return False

def _fallback_input_extraction(detection: Dict[str, Any], file_name: str | None) -> Dict[str, Any]:
    detected_type = detection.get("detected_type")
    stem = _clean_stem(file_name)
    low_conf = {"overall": 0.46, "vendor_name": 0.46, "amount": 0.46, "date": 0.46, "category": 0.42}
    if detected_type in {"bill", "invoice"}:
        return {
            "document_type": detected_type,
            "vendor_name": stem,
            "amount": None,
            "currency": "IDR",
            "due_date": None,
            "invoice_date": None,
            "invoice_number": None,
            "category": "Operations",
            "confidence": {"overall": 0.5, "vendor_name": 0.5, "amount": 0.3, "due_date": 0.3, "category": 0.4},
            "warnings": ["Bill scanning provider not configured — amount and dates must be entered before saving."],
            "raw_text_preview": None,
        }
    if detected_type == "subscription_invoice":
        return {
            "document_type": detected_type,
            "vendor_name": stem,
            "amount": None,
            "currency": "IDR",
            "renewal_date": None,
            "billing_cycle": "monthly",
            "category": "SaaS",
            "status": "Completed",
            "notes": "",
            "confidence": low_conf,
            "warnings": ["Live AI extraction is not configured for this document type yet. Review and correct every field before saving."],
        }
    if detected_type in {"receipt", "payment_screenshot", "bank_transfer", "bank_statement"}:
        return {
            "document_type": detected_type,
            "vendor_name": stem,
            "recipient_or_vendor": stem,
            "amount": None,
            "currency": "IDR",
            "transaction_date": None,
            "type": "transfer" if detected_type == "bank_transfer" else "expense",
            "status": "Missing Receipt" if detected_type == "receipt" else "Completed",
            "category": "Operations",
            "payment_reference": None,
            "notes": "",
            "confidence": low_conf,
            "warnings": ["Live AI extraction is not configured for this document type yet. Review and correct every field before saving."],
        }
    if detected_type == "revenue_report":
        return {
            "document_type": detected_type,
            "total_revenue": None,
            "order_count": None,
            "channel": stem,
            "period_start": None,
            "period_end": None,
            "customer_or_source": stem,
            "rows": [],
            "confidence": {"overall": 0.42},
            "warnings": ["Revenue Sync data is not connected yet. I can prepare this for review, but I cannot sync it automatically."],
        }
    if detected_type == "csv_transactions":
        return {
            "document_type": detected_type,
            "rows": [],
            "detected_columns": [],
            "mapped_columns": {},
            "unmapped_columns": [],
            "validation_errors": [],
            "confidence": {"overall": 0.88},
            "warnings": ["Review CSV rows through the existing Ledger CSV import flow before saving."],
        }
    return {
        "document_type": detected_type or "unknown_financial_document",
        "document_name": stem,
        "confidence": {"overall": 0.32},
        "warnings": detection.get("warnings") or ["Low-confidence routing. Choose a destination before saving anything."],
    }

def _map_input_fields(detected_type: str, extracted: Dict[str, Any]) -> Dict[str, Any]:
    if detected_type in {"bill", "invoice"}:
        return {
            "vendor_name": extracted.get("vendor_name") or "",
            "amount": _normalize_input_amount(extracted.get("amount")),
            "category": extracted.get("category") if extracted.get("category") in ALLOWED_CATEGORIES else "Operations",
            "invoice_number": extracted.get("invoice_number") or "",
            "due_date": extracted.get("due_date") if _is_date_key(extracted.get("due_date")) else "",
            "invoice_date": extracted.get("invoice_date") if _is_date_key(extracted.get("invoice_date")) else "",
            "type": "pending_payable",
            "status": "Missing Receipt",
            "payment_status": "unpaid",
        }
    if detected_type in {"receipt", "payment_screenshot", "bank_transfer", "bank_statement"}:
        return {
            "vendor_name": extracted.get("vendor_name") or extracted.get("recipient_or_vendor") or "",
            "amount": _normalize_input_amount(extracted.get("amount")),
            "category": extracted.get("category") if extracted.get("category") in ALLOWED_CATEGORIES else "Operations",
            "transaction_date": extracted.get("transaction_date") if _is_date_key(extracted.get("transaction_date")) else "",
            "type": extracted.get("type") if extracted.get("type") in {"expense", "income", "transfer", "refund", "adjustment", "fee", "tax", "pending_payable", "pending_receivable"} else "expense",
            "status": extracted.get("status") or "Completed",
            "notes": extracted.get("notes") or "",
            "payment_reference": extracted.get("payment_reference") or "",
        }
    if detected_type == "subscription_invoice":
        return {
            "vendor_name": extracted.get("vendor_name") or "",
            "amount": _normalize_input_amount(extracted.get("amount")),
            "category": "SaaS",
            "renewal_date": extracted.get("renewal_date") if _is_date_key(extracted.get("renewal_date")) else "",
            "billing_cycle": extracted.get("billing_cycle") or "monthly",
            "type": "expense",
            "status": extracted.get("status") or "Completed",
            "notes": extracted.get("notes") or "",
        }
    if detected_type == "revenue_report":
        return {
            "total_revenue": _normalize_input_amount(extracted.get("total_revenue")),
            "order_count": extracted.get("order_count") if isinstance(extracted.get("order_count"), (int, float)) else None,
            "channel": extracted.get("channel") or extracted.get("customer_or_source") or "",
            "period_start": extracted.get("period_start") if _is_date_key(extracted.get("period_start")) else "",
            "period_end": extracted.get("period_end") if _is_date_key(extracted.get("period_end")) else "",
            "rows": extracted.get("rows")[:25] if isinstance(extracted.get("rows"), list) else [],
        }
    if detected_type == "csv_transactions":
        return {
            "rows": extracted.get("rows")[:25] if isinstance(extracted.get("rows"), list) else [],
            "detected_columns": extracted.get("detected_columns") if isinstance(extracted.get("detected_columns"), list) else [],
            "mapped_columns": extracted.get("mapped_columns") if isinstance(extracted.get("mapped_columns"), dict) else {},
            "unmapped_columns": extracted.get("unmapped_columns") if isinstance(extracted.get("unmapped_columns"), list) else [],
        }
    return extracted

def _validate_mapped(destination: str, mapped: Dict[str, Any]) -> Dict[str, List[str]]:
    missing: List[str] = []
    errors: List[str] = []
    if destination in {"bills", "ledger", "subscriptions"}:
        if not mapped.get("vendor_name"):
            missing.append("vendor_name")
        if not mapped.get("amount"):
            missing.append("amount")
        if mapped.get("amount") is not None and mapped.get("amount") <= 0:
            errors.append("Amount must be greater than 0.")
    if destination == "bills" and not mapped.get("due_date"):
        errors.append("Due date is recommended for Bills review.")
    if destination == "subscriptions" and not mapped.get("renewal_date") and not mapped.get("billing_cycle"):
        errors.append("Renewal date or billing cycle is recommended for subscription review.")
    if destination == "revenue_sync" and not mapped.get("total_revenue") and not mapped.get("rows"):
        missing.append("total_revenue_or_rows")
    return {"missing": missing, "errors": errors}

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

def _fetch_collection_safe(uid: str, token: str, collection_name: str, page_size: int = 1000) -> tuple[List[Dict[str, Any]], str | None]:
    try:
        return _fetch_collection(uid, token, collection_name, page_size), None
    except Exception:
        return [], f"Could not read {collection_name}; this answer may be incomplete."

def _normalize_snapshot_date(value: Any) -> str | None:
    if not value:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        seconds = value.get("seconds") or value.get("_seconds")
        if isinstance(seconds, (int, float)):
            return datetime.datetime.fromtimestamp(seconds, datetime.timezone.utc).isoformat()
    return None

def _normalize_snapshot_records(snapshot: Dict[str, Any] | None, key: str, limit_count: int) -> List[Dict[str, Any]]:
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get(key), list):
        return []
    records = []
    for record in snapshot[key][:limit_count]:
        if not isinstance(record, dict):
            continue
        records.append({
            "id": str(record.get("id") or ""),
            "vendor_name": str(record.get("vendor_name") or record.get("name") or record.get("label") or "Unnamed record"),
            "name": str(record.get("name")) if record.get("name") else None,
            "category": str(record.get("category") or "Uncategorized"),
            "type": str(record.get("type") or "unknown"),
            "status": str(record.get("status") or "Unknown"),
            "amount": float(record.get("amount") or 0),
            "timestamp": _normalize_snapshot_date(record.get("timestamp")),
            "due_date": _normalize_snapshot_date(record.get("due_date")),
            "renewal_date": _normalize_snapshot_date(record.get("renewal_date")),
        })
    return records

def _normalize_snapshot_read_meta(snapshot: Dict[str, Any] | None, key: str) -> Dict[str, Any]:
    if not isinstance(snapshot, dict):
        return {"success": False, "error": None}
    meta = snapshot.get("meta") if isinstance(snapshot.get("meta"), dict) else {}
    reads = meta.get("reads") if isinstance(meta.get("reads"), dict) else {}
    read = reads.get(key) if isinstance(reads.get(key), dict) else {}
    error = read.get("error") if isinstance(read.get("error"), str) and read.get("error") else None
    return {"success": read.get("success") is True, "error": error}

def _normalize_finance_snapshot(snapshot: Dict[str, Any] | None) -> Dict[str, Any]:
    normalized = {
        "transactions": _normalize_snapshot_records(snapshot, "transactions", 1000),
        "bills": _normalize_snapshot_records(snapshot, "bills", 500),
        "subscriptions": _normalize_snapshot_records(snapshot, "subscriptions", 500),
        "meta": {
            "source": snapshot.get("meta", {}).get("source") if isinstance(snapshot, dict) and isinstance(snapshot.get("meta"), dict) else None,
            "generated_at": snapshot.get("meta", {}).get("generated_at") if isinstance(snapshot, dict) and isinstance(snapshot.get("meta"), dict) else None,
            "reads": {
                "transactions": _normalize_snapshot_read_meta(snapshot, "transactions"),
                "bills": _normalize_snapshot_read_meta(snapshot, "bills"),
                "subscriptions": _normalize_snapshot_read_meta(snapshot, "subscriptions"),
            },
        },
    }
    normalized["meta"]["counts"] = {
        "transactions": len(normalized["transactions"]),
        "bills": len(normalized["bills"]),
        "subscriptions": len(normalized["subscriptions"]),
    }
    if not normalized["meta"]["reads"]["transactions"]["success"] and normalized["transactions"]:
        normalized["meta"]["reads"]["transactions"]["success"] = True
    if not normalized["meta"]["reads"]["bills"]["success"] and normalized["bills"]:
        normalized["meta"]["reads"]["bills"]["success"] = True
    if not normalized["meta"]["reads"]["subscriptions"]["success"] and normalized["subscriptions"]:
        normalized["meta"]["reads"]["subscriptions"]["success"] = True
    return normalized

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
    if period.get("type") in {"all_time", "none"}:
        return True
    date = _parse_record_date(record.get(field))
    if not date:
        return False
    start = datetime.date.fromisoformat(period["start_date"])
    end = datetime.date.fromisoformat(period["end_date"])
    return start <= date <= end

def _key_number(label: str, value: float, status_value: str = "neutral", formatted: str | None = None) -> Dict[str, Any]:
    return {"label": label, "value": value, "formatted_value": formatted or _format_idr(value), "status": status_value}

def _required_collections_for_intent(intent: str) -> List[str]:
    if intent in {"revenue_analysis", "expense_analysis", "margin_analysis", "ledger_cleanup", "ledger_quality", "period_performance", "vendor_analysis", "category_analysis", "comparison"}:
        return ["transactions"]
    if intent == "bills_analysis":
        return ["bills"]
    if intent == "cash_pressure":
        return ["transactions", "bills"]
    if intent == "subscription_analysis":
        return ["subscriptions"]
    if intent in {"finance_health", "business_health", "action_recommendation", "recommendation"}:
        return ["transactions", "bills"]
    if intent in {"data_lookup", "lookup"}:
        return ["transactions", "bills", "subscriptions"]
    return []

def _build_data_unavailable_answer(intent: str, period: Dict[str, str], missing_collections: List[str]) -> Dict[str, Any]:
    labels = ", ".join(item.replace("_", " ") for item in missing_collections)
    return {
        "intent": intent,
        "scope": FINANCE_SCOPE,
        "answer_type": "clarification",
        "confidence": 0,
        "period": {"label": period["label"], "start_date": period["start_date"], "end_date": period["end_date"]},
        "direct_answer": f"I could not access the required {labels} data from either the backend read or the authenticated page snapshot, so I cannot calculate this safely yet. I will not show zero values because unavailable data is not the same as zero.",
        "key_numbers": [],
        "insights": [],
        "recommended_actions": [{
            "title": "Retry the analysis",
            "description": "Refresh the page and ask again after the finance tables finish loading.",
            "priority": "medium",
        }],
        "limitations": [f"Could not access {collection} from backend Firestore or the client snapshot; no zero-value calculation was produced." for collection in missing_collections],
        "follow_up_questions": ["Try again", "Check a different finance area"],
    }

def _compact(record: Dict[str, Any], date_field: str = "timestamp") -> Dict[str, Any]:
    amount = float(record.get("amount") or 0)
    raw_source = str(record.get("source") or record.get("collection") or "").lower()
    if raw_source in {"bill", "bills", "invoice"} or date_field == "due_date" or record.get("due_date"):
        source = "bills"
    elif raw_source in {"subscription", "subscriptions"} or date_field == "renewal_date" or record.get("renewal_date"):
        source = "subscriptions"
    elif raw_source in {"revenue", "revenue_sync", "revenue-sync"} or str(record.get("type") or "").lower() in {"income", "revenue", "refund", "pending_receivable"}:
        source = "revenue_sync"
    else:
        source = "ledger"
    return {
        "id": record.get("id"),
        "source": source,
        "vendor_name": record.get("vendor_name") or "Unnamed record",
        "category": record.get("category") or "Uncategorized",
        "type": record.get("type") or "unknown",
        "status": record.get("status") or "Unknown",
        "amount": amount,
        "formatted_amount": _format_idr(amount),
        "due_date": record.get("due_date"),
        "renewal_date": record.get("renewal_date"),
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
    intent = {
        "business_health": "finance_health",
        "period_performance": "finance_health",
        "ledger_quality": "ledger_cleanup",
        "lookup": "data_lookup",
        "recommendation": "action_recommendation",
    }.get(intent, intent)

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
    today = _today_jakarta()
    window_end = today + datetime.timedelta(days=30)
    unpaid_bills = [b for b in bills if str(b.get("status", "")).lower() not in PAID_STATUSES]
    bills_with_due_dates = [b for b in unpaid_bills if _parse_record_date(b.get("due_date"))]
    overdue_bills = [b for b in bills_with_due_dates if _parse_record_date(b.get("due_date")) < today]
    due_soon_bills = [b for b in bills_with_due_dates if today <= _parse_record_date(b.get("due_date")) <= window_end]
    total_unpaid_amount = sum(abs(float(b.get("amount") or 0)) for b in unpaid_bills)
    pending_receivables = sum(abs(float(tx.get("amount") or 0)) for tx in transactions if str(tx.get("type", "")).lower() == "pending_receivable")
    active_subscriptions = [s for s in subscriptions if str(s.get("status", "")).lower() != "cancelled"]
    subs_total = sum(abs(float(s.get("amount") or 0)) for s in active_subscriptions)

    if base["intent"] in {"vendor_analysis", "category_analysis", "comparison"} and not period_txs:
        base.update({
            "answer_type": "no_data",
            "confidence": 1,
            "direct_answer": "I don't see finance records for the selected scope yet, so I can't calculate this accurately. Once revenue, expenses, bills, or subscriptions exist for that scope, I can summarize it.",
            "recommended_actions": [{"title": "Add or review finance records", "description": "Check the relevant FluxyOS table, then ask again once records exist for this period or filter.", "priority": "medium"}],
            "limitations": ["No matching records were found for the selected period, entity, or filter."],
            "follow_up_questions": ["Summarize this month", "Show missing receipts", "Show upcoming bills"],
        })
        return base
    if base["intent"] == "vendor_analysis":
        match = re.search(r"\b(?:spend|spent|pay|paid|transactions?|records?)\s+(?:on|to|from|for)\s+([a-z0-9&.\- ]{2,48})", message.lower())
        vendor = (match.group(1).strip(" ?.!,") if match else "")
        records = [tx for tx in period_txs if vendor and vendor in str(tx.get("vendor_name", "")).lower()]
        total = sum(abs(float(tx.get("amount") or 0)) for tx in records)
        base["direct_answer"] = f"{vendor.title()} has {_format_idr(total)} in matched transaction activity for {period['label'].lower()}." if records else f"I could not find matched records for {vendor.title() or 'that vendor'} in {period['label'].lower()}."
        base["key_numbers"] = [_key_number("Matched amount", total, "neutral"), _key_number("Matched records", len(records), "neutral", str(len(records)))]
        base["insights"] = [{"title": "Matched vendor records", "description": "These are the closest vendor records I found.", "severity": "info", "evidence": [_compact(r) for r in records[:5]]}] if records else []
        base["recommended_actions"] = [{"title": "Review matching records", "description": "Open related records to confirm vendor name, category, and transaction type.", "priority": "medium"}]
        return base
    if base["intent"] == "category_analysis":
        category = next((item for item in ALLOWED_CATEGORIES if item.lower() in message.lower()), "SaaS" if "saas" in message.lower() else "")
        records = [tx for tx in period_txs if category and str(tx.get("category", "")).lower() == category.lower()]
        total = sum(abs(float(tx.get("amount") or 0)) for tx in records if str(tx.get("type", "")).lower() in OPEX_TYPES)
        base["direct_answer"] = f"{category} has {_format_idr(total)} in expenses for {period['label'].lower()}."
        base["key_numbers"] = [_key_number(f"{category} expense", total, "neutral"), _key_number("Matched records", len(records), "neutral", str(len(records)))]
        base["insights"] = [{"title": "Related category records", "description": "These are the largest matched category records.", "severity": "info", "evidence": [_compact(r) for r in records[:5]]}]
        base["recommended_actions"] = [{"title": "Review category drivers", "description": "Start with the largest vendor and individual records in this category.", "priority": "medium"}]
        return base

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
    if intent == "cash_pressure":
        risk = "critical" if total_unpaid_amount and pending_receivables < total_unpaid_amount else "warning" if total_unpaid_amount else "neutral"
        base["direct_answer"] = f"I do not have actual bank balance data yet, so this is a cash pressure proxy. Upcoming payables are {_format_idr(total_unpaid_amount)} against {_format_idr(pending_receivables)} in pending receivables." if total_unpaid_amount else "I do not see upcoming unpaid payables in the supported bill data, but I still do not have actual bank balance data."
        base["key_numbers"] = [
            _key_number("Upcoming payables", total_unpaid_amount, risk),
            _key_number("Pending receivables", pending_receivables, "good" if pending_receivables >= total_unpaid_amount and total_unpaid_amount else "neutral"),
            _key_number("Recent revenue", revenue, "good" if revenue else "warning"),
            _key_number("Recent OpEx", opex, "critical" if revenue and opex > revenue else "neutral"),
        ]
        base["insights"] = [
            {"title": "Overdue bills", "description": f"{len(overdue_bills)} unpaid bill(s) are overdue.", "severity": "critical" if overdue_bills else "info", "evidence": [_compact(b, "due_date") for b in overdue_bills[:5]]},
            {"title": "Bills due soon", "description": f"{len(due_soon_bills)} bill(s) are due within 30 days.", "severity": "warning" if due_soon_bills else "info", "evidence": [_compact(b, "due_date") for b in due_soon_bills[:5]]},
        ]
        base["recommended_actions"] = [
            {"title": "Review upcoming payables", "description": "Check due soon and overdue bills before making spending decisions.", "priority": "high" if overdue_bills else "medium"},
            {"title": "Confirm receivables timing", "description": "Pending receivables only reduce pressure if they are likely to clear before bills are due.", "priority": "medium"},
        ]
        base["limitations"].extend([
            "I do not have your real bank balance yet, so this is a cash-pressure proxy, not an actual cash runway calculation.",
            "Bank balance is not connected. Cash pressure is based on upcoming payables, pending receivables, recent revenue, and recent OpEx.",
        ])
        return base
    if intent == "bills_analysis":
        risk = "critical" if overdue_bills else "warning" if due_soon_bills else "neutral"
        base["direct_answer"] = f"You have {len(unpaid_bills)} unpaid bills totaling {_format_idr(total_unpaid_amount)}." if unpaid_bills else "No unpaid bills are recorded right now."
        base["key_numbers"] = [
            _key_number("Unpaid bills", len(unpaid_bills), risk, str(len(unpaid_bills))),
            _key_number("Unpaid amount", total_unpaid_amount, risk),
        ]
        base["insights"] = [
            {"title": "Overdue bills found", "description": f"{len(overdue_bills)} unpaid bill(s) are overdue.", "severity": "critical" if overdue_bills else "info", "evidence": [_compact(b, "due_date") for b in overdue_bills[:5]]},
            {"title": "Bills due soon", "description": f"{len(due_soon_bills)} bill(s) are due within 30 days.", "severity": "warning" if due_soon_bills else "info", "evidence": [_compact(b, "due_date") for b in due_soon_bills[:5]]},
        ]
        base["recommended_actions"] = [{"title": "Prioritize overdue bills", "description": "Review overdue and largest bills before lower-value upcoming items.", "priority": "high" if overdue_bills else "medium"}]
        return base
    if intent == "subscription_analysis":
        base["direct_answer"] = f"Your recorded monthly subscription spend is {_format_idr(subs_total)} across {len(active_subscriptions)} subscription(s)." if active_subscriptions else "No active subscriptions were found."
        base["key_numbers"] = [
            _key_number("Monthly subscriptions", subs_total, "neutral" if subs_total else "warning"),
            _key_number("Active subscriptions", len(active_subscriptions), "neutral", str(len(active_subscriptions))),
        ]
        base["insights"] = [{"title": "Largest subscriptions", "description": "Here are the largest subscriptions found.", "severity": "info", "evidence": [_compact(s, "renewal_date") for s in sorted(active_subscriptions, key=lambda s: abs(float(s.get("amount") or 0)), reverse=True)[:5]]}]
        base["recommended_actions"] = [{"title": "Review recurring costs", "description": "Start with the largest subscriptions and upcoming renewals.", "priority": "medium"}]
        return base
    if intent == "ledger_cleanup":
        base["direct_answer"] = f"I found {len(missing)} missing receipt record(s) for {period['label'].lower()}." if missing else f"The ledger looks clean for missing receipts in {period['label'].lower()}."
        base["key_numbers"] = [_key_number("Missing receipts", len(missing), "warning" if missing else "good", str(len(missing)))]
        base["insights"] = [{"title": "Missing receipts", "description": "These records need receipt attachments before the ledger is reliable for reporting.", "severity": "warning" if missing else "info", "evidence": [_compact(r) for r in missing[:5]]}]
        base["recommended_actions"] = [{"title": "Clean missing receipts first", "description": "Attach receipts for the highest-value missing receipt records before relying on reports.", "priority": "high" if missing else "low"}]
        return base
    if intent == "data_lookup":
        terms = [term for term in message.lower().split() if len(term) > 2]
        records = [
            *[_compact(tx) for tx in period_txs],
            *[_compact(b, "due_date") for b in bills],
            *[_compact(s, "renewal_date") for s in subscriptions],
        ]
        matches = [
            record for record in records
            if any(term in " ".join(str(record.get(field) or "").lower() for field in ["vendor_name", "category", "type", "status"]).lower() for term in terms)
        ][:10]
        base["answer_type"] = "lookup"
        base["direct_answer"] = f"I found {len(matches)} related finance record(s)." if matches else "I could not find matching finance records in the current data."
        base["insights"] = [{"title": "Matching records", "description": "Here are the closest records I found.", "severity": "info", "evidence": matches}] if matches else []
        base["recommended_actions"] = [{"title": "Refine the lookup", "description": "Try a vendor name, category, or record status if you need a narrower result.", "priority": "low"}]
        return base

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

    period = _period_dict(request.period, message)
    intent = _classify_intent(message, request.page_context or "global")
    chat_id = request.chat_id.strip()[:128] if isinstance(request.chat_id, str) and request.chat_id.strip() else None
    if intent in {"unsupported", "ambiguous"}:
        answer = _build_answer(intent, message, period, [], [], [], request.page_context or "global")
        return {"success": True, "chat_id": chat_id, "intent": intent, "scope": FINANCE_SCOPE, "answer": answer, "related_records": [], "error": None}

    uid = _user.get("user_id") or _user.get("sub")
    token = _user.get("_id_token")
    transactions, transactions_error = _fetch_collection_safe(uid, token, "transactions", 1000)
    bills, bills_error = _fetch_collection_safe(uid, token, "bills", 500)
    subscriptions, subscriptions_error = _fetch_collection_safe(uid, token, "subscriptions", 500)
    snapshot = _normalize_finance_snapshot(request.finance_snapshot)
    used_snapshot = []
    transactions_snapshot_ok = snapshot["meta"]["reads"]["transactions"]["success"]
    bills_snapshot_ok = snapshot["meta"]["reads"]["bills"]["success"]
    subscriptions_snapshot_ok = snapshot["meta"]["reads"]["subscriptions"]["success"]
    if transactions_error and transactions_snapshot_ok:
        transactions = snapshot["transactions"]
        used_snapshot.append(f"transactions ({len(snapshot['transactions'])})")
    if bills_error and bills_snapshot_ok:
        bills = snapshot["bills"]
        used_snapshot.append(f"bills ({len(snapshot['bills'])})")
    if subscriptions_error and subscriptions_snapshot_ok:
        subscriptions = snapshot["subscriptions"]
        used_snapshot.append(f"subscriptions ({len(snapshot['subscriptions'])})")
    unavailable_collections = [
        collection for collection, error, snapshot_records in [
            ("transactions", transactions_error, transactions_snapshot_ok),
            ("bills", bills_error, bills_snapshot_ok),
            ("subscriptions", subscriptions_error, subscriptions_snapshot_ok),
        ] if error and not snapshot_records
    ]
    missing_required_collections = [
        collection for collection in _required_collections_for_intent(intent)
        if collection in unavailable_collections
    ]
    if missing_required_collections:
        answer = _build_data_unavailable_answer(intent, period, missing_required_collections)
        return {"success": True, "chat_id": chat_id, "intent": intent, "scope": FINANCE_SCOPE, "answer": answer, "related_records": [], "error": None}

    answer = _build_answer(intent, message, period, transactions, bills, subscriptions, request.page_context or "global")
    read_limitations = [
        item for item, snapshot_records in [
            (transactions_error, transactions_snapshot_ok),
            (bills_error, bills_snapshot_ok),
            (subscriptions_error, subscriptions_snapshot_ok),
        ] if item and not snapshot_records
    ]
    if read_limitations:
        answer["limitations"] = [*(answer.get("limitations") or []), *read_limitations]
    if used_snapshot:
        answer["limitations"] = [
            *(answer.get("limitations") or []),
            f"Used the authenticated page data snapshot for {', '.join(used_snapshot)} because direct backend Firestore read was unavailable.",
        ]
    related_records = [record for item in answer.get("insights", []) for record in item.get("evidence", [])][:10]
    return {"success": True, "chat_id": chat_id, "intent": intent, "scope": FINANCE_SCOPE, "answer": answer, "related_records": related_records, "error": None}

@app.post("/api/v1/ai/detect-document")
async def detect_document(payload: Dict[str, Any], _user=Depends(verify_firebase_token)):
    file_name = payload.get("file_name")
    mime_type = payload.get("mime_type") or _guess_mime(file_name)
    size_bytes = payload.get("size_bytes")
    if size_bytes is not None:
        try:
            size_bytes = int(size_bytes)
        except (TypeError, ValueError):
            size_bytes = None
    return _detect_document_type(file_name, mime_type, size_bytes)

@app.post("/api/v1/ai/input-from-file")
async def input_from_file(payload: Dict[str, Any], _user=Depends(verify_firebase_token)):
    file_base64 = payload.get("file_base64")
    file_name = payload.get("file_name")
    mime_type = payload.get("mime_type") or _guess_mime(file_name)
    size_bytes = payload.get("size_bytes")
    destination_hint = payload.get("destination_hint")
    if not isinstance(file_base64, str) or not file_base64:
        return {"success": False, "error": {"code": "missing_file", "message": "file_base64 is required."}}
    try:
        numeric_size = int(size_bytes) if size_bytes is not None else 0
    except (TypeError, ValueError):
        numeric_size = 0
    detection = _detect_document_type(file_name, mime_type, numeric_size)
    if detection.get("detected_type") in {"unsupported_file", "non_financial_image"}:
        return {
            **detection,
            "extracted": {},
            "mapped_fields": {},
            "missing_required_fields": [],
            "validation_errors": detection.get("warnings", []),
            "provider_state": "deterministic_fallback",
        }

    extracted = _fallback_input_extraction(detection, file_name)
    provider_state = "provider_not_configured"
    destination = destination_hint if destination_hint and destination_hint != "auto" else detection.get("recommended_destination")
    mapped = _map_input_fields(detection.get("detected_type", "unknown_financial_document"), extracted)
    validation = _validate_mapped(destination or "ai_review", mapped)
    warnings = [*(detection.get("warnings") or []), *(extracted.get("warnings") or [])]
    return {
        "success": True,
        "detected_type": detection.get("detected_type"),
        "recommended_destination": destination,
        "recommended_action": detection.get("recommended_action"),
        "confidence": extracted.get("confidence", {}).get("overall", detection.get("confidence", 0)),
        "extracted": extracted,
        "mapped_fields": mapped,
        "missing_required_fields": validation["missing"],
        "validation_errors": validation["errors"],
        "warnings": warnings,
        "message": f"{detection.get('message', '')} Live AI extraction is not configured, so review these low-confidence fields before saving.",
        "provider_state": provider_state,
    }

@app.post("/api/v1/bills/extract")
async def extract_bill(payload: Dict[str, Any], _user=Depends(verify_firebase_token)):
    file_base64 = payload.get("file_base64")
    file_name = payload.get("file_name")
    mime_type = payload.get("mime_type") or _guess_mime(file_name)
    size_bytes = payload.get("size_bytes")
    if not isinstance(file_base64, str) or not file_base64:
        return {"ok": False, "error": {"code": "MISSING_FILE", "message": "file_base64 is required."}}
    if mime_type not in {"image/jpeg", "image/png", "image/webp", "application/pdf"}:
        return {"ok": False, "error": {"code": "UNSUPPORTED_MIME", "message": "Unsupported file type."}}
    try:
        numeric_size = int(size_bytes) if size_bytes is not None else 0
    except (TypeError, ValueError):
        numeric_size = 0
    if numeric_size > DOCUMENT_MAX_FILE_BYTES or len(file_base64) > DOCUMENT_MAX_FILE_BYTES * 1.5:
        return {"ok": False, "error": {"code": "FILE_TOO_LARGE", "message": "File is too large."}}
    return {
        "ok": True,
        "extraction_source": "mock",
        "data": _mock_bill_extraction(file_name),
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
