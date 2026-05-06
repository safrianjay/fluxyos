from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional

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

class ChatRequest(BaseModel):
    message: str

class ChatResponse(BaseModel):
    response: str
    suggested_action: Optional[str] = None
