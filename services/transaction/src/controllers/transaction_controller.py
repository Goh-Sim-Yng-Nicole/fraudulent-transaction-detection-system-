from __future__ import annotations

import json
from typing import Any

from services.transaction.src.config.settings import SERVICE_NAME, TOPIC_TRANSACTION_CREATED


def _json_serializer(value: Any) -> bytes:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False, default=str).encode("utf-8")


def _bytes_header(name: str, value: str | None) -> tuple[str, bytes]:
    return (name, (value or "").encode("utf-8"))


def _as_int_or_none(*values: Any) -> int | None:
    for value in values:
        if value in (None, ""):
            continue
        try:
            return int(float(value))
        except (TypeError, ValueError):
            continue
    return None


def _as_text_or_none(*values: Any) -> str | None:
    for value in values:
        if value is None:
            continue
        normalized = str(value).strip()
        if normalized:
            return normalized
    return None


def serialize_record(record: dict[str, Any]) -> dict[str, Any]:
    return {
        **record,
        "created_at": record["created_at"].isoformat() if record.get("created_at") else None,
        "updated_at": record["updated_at"].isoformat() if record.get("updated_at") else None,
        "direction": record.get("direction"),
    }


def to_fraud_transaction(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": record["transaction_id"],
        "customerId": record["customer_id"],
        "merchantId": record["merchant_id"],
        "amount": float(record["amount"]),
        "currency": record["currency"],
        "cardType": record["card_type"],
        "createdAt": record["created_at"].isoformat(),
        "location": {"country": record["country"]},
        "metadata": {
            "senderName": record["sender_name"],
            "recipientCustomerId": record["recipient_customer_id"],
            "recipientName": record["recipient_name"],
            "hourUtc": record["hour_utc"],
        },
    }


async def publish_transaction_created(
    producer: Any,
    record: dict[str, Any],
    correlation_id: str,
) -> None:
    if producer is None:
        raise RuntimeError("Transaction producer is not ready")

    payload = {
        "eventType": "transaction.created",
        "event_type": "transaction.created.v1",
        "trace_id": record["transaction_id"],
        "correlationId": correlation_id,
        "transactionId": record["transaction_id"],
        "customerId": record["customer_id"],
        "merchantId": record["merchant_id"],
        "transaction": to_fraud_transaction(record),
        "data": {
            "transaction_id": record["transaction_id"],
            "amount": record["amount"],
            "currency": record["currency"],
            "card_type": record["card_type"],
            "country": record["country"],
            "merchant_id": record["merchant_id"],
            "hour_utc": record["hour_utc"],
            "customer_id": record["customer_id"],
            "sender_name": record["sender_name"],
            "recipient_customer_id": record["recipient_customer_id"],
            "recipient_name": record["recipient_name"],
        },
        "createdAt": record["created_at"].isoformat(),
    }

    await producer.send_and_wait(
        TOPIC_TRANSACTION_CREATED,
        key=str(record["customer_id"]).encode("utf-8"),
        value=payload,
        headers=[
            _bytes_header("content-type", "application/json"),
            _bytes_header("service-source", SERVICE_NAME),
            _bytes_header("x-correlation-id", correlation_id),
        ],
    )
