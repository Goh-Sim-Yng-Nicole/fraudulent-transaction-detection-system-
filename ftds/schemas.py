from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Generic, Literal, Optional, TypeVar
from uuid import uuid4

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class TransactionStatus(str, Enum):
    PENDING = "PENDING"
    FLAGGED = "FLAGGED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    RESOLVED = "RESOLVED"


class DecisionOutcome(str, Enum):
    APPROVE = "APPROVE"
    DECLINE = "DECLINE"
    FLAG = "FLAG"


class ManualOutcome(str, Enum):
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class TransactionCreateRequest(BaseModel):
    amount: float
    currency: str
    card_type: str
    country: str
    merchant_id: Optional[str] = None
    hour_utc: Optional[int] = Field(default=None, ge=0, le=23)
    customer_id: Optional[str] = None
    sender_name: Optional[str] = None
    recipient_customer_id: Optional[str] = None
    recipient_name: Optional[str] = None


class TransactionRecord(TransactionCreateRequest):
    transaction_id: str
    status: TransactionStatus
    created_at: datetime
    updated_at: datetime
    fraud_score: Optional[int] = None
    outcome_reason: Optional[str] = None
    direction: Optional[str] = None  # OUTGOING | INCOMING (set at query time)


class TransactionCreated(BaseModel):
    transaction_id: str
    amount: float
    currency: str
    card_type: str
    country: str
    merchant_id: str
    hour_utc: int


class FraudScoreRequest(TransactionCreated):
    # Optional enrichment fields (kept minimal for the MVP)
    velocity_txn_hour_raw: Optional[int] = None
    geo_country_high_risk: Optional[bool] = None


class TransactionScored(BaseModel):
    transaction_id: str
    rules_score: int = Field(ge=0, le=100)


class TransactionFlagged(BaseModel):
    transaction_id: str
    rules_score: int = Field(ge=0, le=100)
    reason: str


class TransactionFinalised(BaseModel):
    transaction_id: str
    outcome: Literal["APPROVED", "REJECTED"]
    rules_score: int = Field(ge=0, le=100)
    reason: str


class TransactionReviewed(BaseModel):
    transaction_id: str
    manual_outcome: ManualOutcome
    reason: str


class AppealCreateRequest(BaseModel):
    transaction_id: str
    reason_for_appeal: str


class AppealCreated(BaseModel):
    appeal_id: str
    transaction_id: str
    reason_for_appeal: str


class AppealResolved(BaseModel):
    appeal_id: str
    transaction_id: str
    manual_outcome: ManualOutcome
    outcome_reason: str


DataT = TypeVar("DataT", bound=BaseModel)


class EventEnvelope(BaseModel, Generic[DataT]):
    event_id: str = Field(default_factory=lambda: str(uuid4()))
    event_type: str
    occurred_at: datetime = Field(default_factory=utc_now)
    trace_id: Optional[str] = None
    data: DataT
