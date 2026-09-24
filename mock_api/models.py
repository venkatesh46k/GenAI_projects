from typing import Optional

from pydantic import BaseModel


class BalanceResponse(BaseModel):
    msisdn: str
    balance: float
    plan_id: Optional[str]
    status: str


class PlanResponse(BaseModel):
    plan_id: str
    name: str
    price: float
    validity_days: int
    data_per_day_gb: float
    voice_minutes: int
    sms_per_day: int


class RechargeRequest(BaseModel):
    msisdn: str
    amount: float
    plan_id: Optional[str] = None


class RechargeResponse(BaseModel):
    txn_id: str
    new_balance: float
    status: str


class CDRItem(BaseModel):
    cdr_id: str
    call_type: str
    duration_sec: Optional[int]
    data_mb: Optional[float]
    charge: float
    timestamp: str


class DisputeRequest(BaseModel):
    msisdn: str
    reason: str
    amount_disputed: float


class DisputeResponse(BaseModel):
    dispute_id: str
    status: str


class DisputeDetail(BaseModel):
    dispute_id: str
    status: str
    reason: str
    amount_disputed: float


class EscalateResponse(BaseModel):
    dispute_id: str
    status: str
    ticket_id: str
