from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from services.transaction.src.config.settings import (
    SERVICE_NAME,
    TOPIC_APPEAL_RESOLVED,
    TOPIC_TRANSACTION_DLQ,
    TOPIC_TRANSACTION_FINALISED,
    TOPIC_TRANSACTION_FLAGGED,
    TOPIC_TRANSACTION_REVIEWED,
)
from services.transaction.src.controllers.transaction_controller import (
    _as_int_or_none,
    _as_text_or_none,
)


def _bytes_header(name: str, value: str | None) -> tuple[str, bytes]:
    return (name, (value or "").encode("utf-8"))


def normalize_status_update(topic: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    transaction_id = (
        payload.get("transactionId")
        or payload.get("transaction_id")
        or data.get("transaction_id")
        or data.get("transactionId")
    )
    if not transaction_id:
        return None

    if topic == TOPIC_TRANSACTION_FLAGGED:
        return {
            "transaction_id": transaction_id,
            "status": "FLAGGED",
            "fraud_score": _as_int_or_none(
                payload.get("fraudAnalysis", {}).get("riskScore"),
                payload.get("rules_score"),
                data.get("rules_score"),
            ),
            "outcome_reason": _as_text_or_none(
                payload.get("decisionReason"),
                payload.get("reason"),
                data.get("reason"),
                "Transaction flagged for manual review",
            ),
        }

    if topic == TOPIC_TRANSACTION_FINALISED:
        outcome = _as_text_or_none(payload.get("decision"), payload.get("outcome"), data.get("outcome"))
        if not outcome:
            return None
        return {
            "transaction_id": transaction_id,
            "status": "APPROVED" if outcome.upper() == "APPROVED" else "REJECTED",
            "fraud_score": _as_int_or_none(
                payload.get("fraudAnalysis", {}).get("riskScore"),
                payload.get("rules_score"),
                data.get("rules_score"),
            ),
            "outcome_reason": _as_text_or_none(
                payload.get("decisionReason"), payload.get("reason"), data.get("reason")
            ),
        }

    if topic == TOPIC_TRANSACTION_REVIEWED:
        review_decision = _as_text_or_none(
            payload.get("reviewDecision"),
            payload.get("decision"),
            payload.get("manual_outcome"),
            data.get("manual_outcome"),
        )
        if not review_decision:
            return None
        return {
            "transaction_id": transaction_id,
            "status": "APPROVED" if review_decision.upper() == "APPROVED" else "REJECTED",
            "fraud_score": _as_int_or_none(
                payload.get("fraudAnalysis", {}).get("riskScore"),
                payload.get("rules_score"),
                data.get("rules_score"),
            ),
            "outcome_reason": _as_text_or_none(
                payload.get("reviewNotes"), payload.get("reason"), data.get("reason"), "Manually reviewed"
            ),
        }

    if topic == TOPIC_APPEAL_RESOLVED:
        resolution = _as_text_or_none(
            payload.get("resolution"), payload.get("outcome"), data.get("manual_outcome")
        )
        if not resolution:
            return None
        return {
            "transaction_id": transaction_id,
            "status": "APPROVED" if resolution.upper() in {"REVERSE", "APPROVED"} else "REJECTED",
            "fraud_score": _as_int_or_none(
                payload.get("fraudAnalysis", {}).get("riskScore"),
                payload.get("rules_score"),
                data.get("rules_score"),
            ),
            "outcome_reason": _as_text_or_none(
                payload.get("resolutionNotes"),
                payload.get("outcome_reason"),
                data.get("outcome_reason"),
                "Appeal resolved",
            ),
        }

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
        raise RuntimeError("Transaction producer is not ready")

    key = (
        parsed_payload.get("transactionId") if parsed_payload else None
    ) or (
        parsed_payload.get("data", {}).get("transaction_id")
        if parsed_payload and isinstance(parsed_payload.get("data"), dict)
        else None
    ) or topic

    await producer.send_and_wait(
        TOPIC_TRANSACTION_DLQ,
        key=str(key).encode("utf-8"),
        value={
            "eventType": "transaction.dlq",
            "sourceTopic": topic,
            "sourcePartition": partition,
            "sourceOffset": offset,
            "reason": reason,
            "error": error,
            "rawPayload": raw_payload,
            "originalPayload": parsed_payload,
            "failedAt": datetime.now(timezone.utc).isoformat(),
            "serviceName": SERVICE_NAME,
        },
        headers=[
            _bytes_header("content-type", "application/json"),
            _bytes_header("service-source", SERVICE_NAME),
            _bytes_header("x-dlq-reason", reason),
        ],
    )
