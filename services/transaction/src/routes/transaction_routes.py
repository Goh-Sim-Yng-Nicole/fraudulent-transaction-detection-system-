from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import RedirectResponse, Response
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator

from services.transaction.src.controllers.transaction_controller import (
    publish_transaction_created,
    serialize_record,
)
from services.transaction.src.state import state

router = APIRouter()


class TransactionCreateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    customer_id: str = Field(validation_alias=AliasChoices("customer_id", "customerId"))
    amount: float = Field(gt=0, le=1_000_000)
    currency: str = "SGD"
    card_type: str = Field(
        default="CREDIT",
        validation_alias=AliasChoices("card_type", "cardType"),
    )
    country: str
    merchant_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("merchant_id", "merchantId"),
    )
    sender_name: str | None = Field(
        default=None,
        validation_alias=AliasChoices("sender_name", "senderName"),
    )
    recipient_customer_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("recipient_customer_id", "recipientCustomerId"),
    )
    recipient_name: str | None = Field(
        default=None,
        validation_alias=AliasChoices("recipient_name", "recipientName"),
    )
    hour_utc: int | None = Field(
        default=None,
        ge=0,
        le=23,
        validation_alias=AliasChoices("hour_utc", "hourUtc"),
    )

    @field_validator("customer_id", "currency", "card_type", "country")
    @classmethod
    def _normalize_required_text(cls, value: str) -> str:
        normalized = str(value).strip()
        if not normalized:
            raise ValueError("field cannot be blank")
        return normalized

    @field_validator("currency", "card_type", "country")
    @classmethod
    def _uppercase_text(cls, value: str) -> str:
        return value.upper()

    @field_validator("merchant_id", "sender_name", "recipient_customer_id", "recipient_name", mode="before")
    @classmethod
    def _normalize_optional_text(cls, value: Any) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None


@router.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    return RedirectResponse(url="/docs")


@router.get("/favicon.ico", include_in_schema=False)
async def favicon() -> Response:
    return Response(status_code=204)


@router.get("/api-docs", include_in_schema=False)
async def api_docs() -> RedirectResponse:
    return RedirectResponse(url="/docs")


@router.post("/transactions", status_code=201)
async def create_transaction(payload: TransactionCreateRequest, request: Request) -> dict[str, Any]:
    assert state.store is not None

    normalized = payload.model_dump()
    if normalized["hour_utc"] is None:
        normalized["hour_utc"] = datetime.now(timezone.utc).hour
    if not normalized.get("merchant_id"):
        normalized["merchant_id"] = "FTDS_TRANSFER"

    idempotency_key = request.state.idempotency_key
    correlation_id = request.state.correlation_id
    request_id = request.state.request_id

    if idempotency_key:
        existing = await state.store.find_by_idempotency_key(idempotency_key, include_workflow_state=True)
        if existing is not None:
            if existing["outbound_event_published_at"] is None:
                existing_correlation_id = existing.get("correlation_id") or correlation_id
                try:
                    await publish_transaction_created(state.producer, existing, existing_correlation_id)
                    updated = await state.store.mark_outbound_event_published(existing["transaction_id"])
                    if updated is None:
                        raise RuntimeError("Failed to reload transaction after publish")
                    return serialize_record(updated)
                except Exception as exc:
                    await state.store.mark_outbound_event_failed(existing["transaction_id"], str(exc))
                    raise
            canonical = await state.store.find_by_id(existing["transaction_id"])
            if canonical is None:
                raise HTTPException(status_code=404, detail="transaction not found")
            return serialize_record(canonical)

    record = await state.store.create(
        normalized,
        idempotency_key=idempotency_key,
        correlation_id=correlation_id,
        request_id=request_id,
    )

    try:
        await publish_transaction_created(state.producer, record, correlation_id)
        updated = await state.store.mark_outbound_event_published(record["transaction_id"])
        if updated is None:
            raise RuntimeError("Failed to reload transaction after publish")
        return serialize_record(updated)
    except Exception as exc:
        await state.store.mark_outbound_event_failed(record["transaction_id"], str(exc))
        raise


@router.get("/transactions")
async def list_transactions(request: Request, direction: str = Query("all")) -> list[dict[str, Any]]:
    if direction not in {"all", "outgoing", "incoming"}:
        raise HTTPException(status_code=400, detail="direction must be all, outgoing, or incoming")
    customer_id = request.query_params.get("customer_id") or request.query_params.get("customerId")
    if not customer_id:
        raise HTTPException(status_code=400, detail="customer_id is required")
    assert state.store is not None
    records = await state.store.list_by_customer(customer_id, direction)
    return [serialize_record(record) for record in records]


@router.get("/transactions/customer/{customer_id}")
async def list_transactions_by_customer(
    customer_id: str,
    direction: str = Query("all"),
) -> list[dict[str, Any]]:
    if direction not in {"all", "outgoing", "incoming"}:
        raise HTTPException(status_code=400, detail="direction must be all, outgoing, or incoming")
    assert state.store is not None
    records = await state.store.list_by_customer(customer_id, direction)
    return [serialize_record(record) for record in records]


@router.get("/transactions/{transaction_id}")
async def get_transaction(transaction_id: str) -> dict[str, Any]:
    assert state.store is not None
    record = await state.store.find_by_id(transaction_id)
    if record is None:
        raise HTTPException(status_code=404, detail="transaction not found")
    return serialize_record(record)


@router.get("/transactions/{transaction_id}/decision")
async def get_transaction_decision(transaction_id: str) -> dict[str, Any]:
    assert state.store is not None
    record = await state.store.find_by_id(transaction_id)
    if record is None:
        raise HTTPException(status_code=404, detail="transaction not found")
    return {
        "transaction_id": record["transaction_id"],
        "status": record["status"],
        "fraud_score": record["fraud_score"],
        "outcome_reason": record["outcome_reason"],
        "updated_at": record["updated_at"].isoformat() if record.get("updated_at") else None,
    }
