from pydantic import BaseModel, Field
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

class TransactionBase(BaseModel):
    vendor_name: str
    amount: float
    status: str
    timestamp: datetime
    icon: str

class TransactionResponse(TransactionBase):
    id: int
    category_name: str
    entity_name: str

    class Config:
        from_attributes = True

class DashboardSummary(BaseModel):
    revenue: str
    revenue_change: str
    opex: str
    margin: float
    action_items_count: int
    action_items_details: str

class ChatPeriod(BaseModel):
    type: Optional[Literal["this_month", "last_month", "custom"]] = "this_month"
    start_date: Optional[str] = None
    end_date: Optional[str] = None

class ChatRequest(BaseModel):
    message: str
    chat_id: Optional[str] = None
    page_context: Optional[Literal["dashboard", "ledger", "bills", "subscriptions", "revenue_sync", "ai_command_center", "global"]] = "global"
    period: Optional[ChatPeriod] = None
    finance_snapshot: Optional[Dict[str, Any]] = None

class ChatAnswerPeriod(BaseModel):
    label: str
    start_date: str
    end_date: str

class ChatKeyNumber(BaseModel):
    label: str
    value: float
    formatted_value: str
    status: Literal["good", "warning", "critical", "neutral"]

class ChatInsight(BaseModel):
    title: str
    description: str
    severity: Literal["info", "warning", "critical"]
    evidence: List[Dict[str, Any]] = []

class ChatRecommendedAction(BaseModel):
    title: str
    description: str
    priority: Literal["low", "medium", "high"]

class ChatAnswer(BaseModel):
    intent: Literal[
        "finance_health",
        "business_health",
        "period_performance",
        "revenue_analysis",
        "expense_analysis",
        "margin_analysis",
        "vendor_analysis",
        "category_analysis",
        "bills_analysis",
        "subscription_analysis",
        "ledger_cleanup",
        "ledger_quality",
        "cash_pressure",
        "data_lookup",
        "lookup",
        "action_recommendation",
        "recommendation",
        "comparison",
        "unsupported",
        "ambiguous",
    ]
    scope: Literal["project_finance"] = "project_finance"
    answer_type: Literal["analysis", "lookup", "comparison", "recommendation", "no_data", "refusal", "clarification"]
    confidence: float
    period: ChatAnswerPeriod
    direct_answer: str
    key_numbers: List[ChatKeyNumber] = []
    insights: List[ChatInsight] = []
    recommended_actions: List[ChatRecommendedAction] = []
    limitations: List[str] = []
    follow_up_questions: List[str] = []

class ChatError(BaseModel):
    code: str
    message: str

class ChatResponse(BaseModel):
    success: bool
    chat_id: Optional[str] = None
    intent: Optional[str] = None
    scope: Literal["project_finance"] = "project_finance"
    answer: Optional[ChatAnswer] = None
    related_records: List[Dict[str, Any]] = []
    error: Optional[ChatError] = None

class AIInputFromFileRequest(BaseModel):
    file_base64: str
    file_name: str
    mime_type: Optional[str] = None
    size_bytes: Optional[int] = None
    source_page: Optional[Literal["ai_command_center", "bills", "ledger", "subscriptions", "revenue_sync"]] = "ai_command_center"
    destination_hint: Optional[Literal["bills", "ledger", "subscriptions", "revenue_sync", "ai_review", "auto"]] = "auto"

class AIInputFromFileResponse(BaseModel):
    success: bool
    detected_type: Optional[str] = None
    recommended_destination: Optional[str] = None
    recommended_action: Optional[str] = None
    confidence: Optional[float] = None
    extracted: Dict[str, Any] = Field(default_factory=dict)
    mapped_fields: Dict[str, Any] = Field(default_factory=dict)
    missing_required_fields: List[str] = Field(default_factory=list)
    validation_errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    message: str = ""
    provider_state: Optional[Literal["openai", "deterministic_fallback", "provider_not_configured"]] = None
    error: Optional[ChatError] = None
