from pydantic import BaseModel
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
    page_context: Optional[Literal["dashboard", "ledger", "bills", "subscriptions", "revenue_sync", "global"]] = "global"
    period: Optional[ChatPeriod] = None

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
        "revenue_analysis",
        "expense_analysis",
        "margin_analysis",
        "bills_analysis",
        "subscription_analysis",
        "ledger_cleanup",
        "data_lookup",
        "action_recommendation",
        "unsupported",
        "ambiguous",
    ]
    scope: Literal["project_finance"] = "project_finance"
    answer_type: Literal["analysis", "lookup", "refusal", "clarification"]
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
    intent: Optional[str] = None
    scope: Literal["project_finance"] = "project_finance"
    answer: Optional[ChatAnswer] = None
    related_records: List[Dict[str, Any]] = []
    error: Optional[ChatError] = None
