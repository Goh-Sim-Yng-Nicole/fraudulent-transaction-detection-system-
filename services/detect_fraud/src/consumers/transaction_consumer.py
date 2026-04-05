from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from typing import Any

from services.detect_fraud.src.config.settings import settings

logger = logging.getLogger("detect_fraud")


def _header(name: str, value: str | None) -> tuple[str, bytes]:
    return (name, (value or "").encode("utf-8"))


def normalize_transaction(payload: dict[str, Any]) -> dict[str, Any]:
    raw = payload.get("transaction") or payload.get("originalTransaction") or payload.get("data") or payload
    metadata = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {}
    created_at = raw.get("createdAt") or payload.get("createdAt") or datetime.now(timezone.utc).isoformat()

    return {
        "id": raw.get("id") or raw.get("transactionId") or raw.get("transaction_id"),
        "customerId": (
            raw.get("customerId") or raw.get("customer_id")
            or payload.get("customerId") or payload.get("customer_id")
        ),
        "merchantId": (
            raw.get("merchantId") or raw.get("merchant_id")
            or payload.get("merchantId") or payload.get("merchant_id")
            or "FTDS_TRANSFER"
        ),
        "amount": float(raw.get("amount")) if raw.get("amount") is not None else float("nan"),
        "currency": raw.get("currency") or "SGD",
        "cardType": raw.get("cardType") or raw.get("card_type") or "CREDIT",
        "createdAt": created_at,
        "location": raw.get("location") or {"country": raw.get("country") or "SG"},
        "metadata": metadata,
    }


def validate_transaction(transaction: dict[str, Any]) -> str | None:
    if not transaction.get("id"):
        return "transaction.id is required"
    if not transaction.get("customerId"):
        return "transaction.customerId is required"
    amount = transaction.get("amount")
    if not isinstance(amount, (int, float)) or not math.isfinite(float(amount)):
        return "transaction.amount must be a finite number"
    return None


async def send_to_dlq(
    producer: Any,
    *,
    topic: str,
    partition: int,
    offset: int,
    reason: str,
    raw_payload: str | None = None,
    parsed_payload: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    if producer is None:
        raise RuntimeError("Detect fraud DLQ producer is not ready")

    key = (
        parsed_payload.get("transactionId") if parsed_payload else None
    ) or (
        parsed_payload.get("transaction", {}).get("id")
        if parsed_payload and isinstance(parsed_payload.get("transaction"), dict)
        else None
    ) or topic

    await producer.send_and_wait(
        settings.kafka_dlq_topic,
        key=str(key).encode("utf-8"),
        value={
            "eventType": "detect-fraud.dlq",
            "sourceTopic": topic,
            "sourcePartition": partition,
            "sourceOffset": offset,
            "reason": reason,
            "error": error,
            "rawPayload": raw_payload,
            "originalPayload": parsed_payload,
            "failedAt": datetime.now(timezone.utc).isoformat(),
            "serviceName": settings.service_name,
        },
        headers=[
            _header("content-type", "application/json"),
            _header("service-source", settings.service_name),
            _header("x-dlq-reason", reason),
        ],
    )
