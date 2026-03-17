from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any

from ftds.config import settings
from ftds.event_types import (
    APPEAL_CREATED_V1,
    APPEAL_RESOLVED_V1,
    TRANSACTION_CREATED_V1,
    TRANSACTION_FINALISED_V1,
    TRANSACTION_FLAGGED_V1,
    TRANSACTION_REVIEWED_V1,
    TRANSACTION_SCORED_V1,
)
from ftds.events import get_event_type
from ftds.kafka import create_consumer, stop_quietly


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _audit(event_type: str, summary: str, detail: dict[str, Any]) -> None:
    entry = {"audit_at": _now(), "event_type": event_type, "summary": summary, **detail}
    print(f"[audit] {json.dumps(entry)}", flush=True)


def _data(value: Any) -> dict[str, Any]:
    return value.get("data", {}) if isinstance(value, dict) else {}


async def main() -> None:
    consumer = await create_consumer(
        topics=[
            settings.topic_transaction_created,
            settings.topic_transaction_scored,
            settings.topic_transaction_flagged,
            settings.topic_transaction_finalised,
            settings.topic_transaction_reviewed,
            settings.topic_appeal_created,
            settings.topic_appeal_resolved,
        ],
        group_id="audit",
        bootstrap_servers=settings.kafka_bootstrap_servers,
    )
    try:
        async for message in consumer:
            value: Any = message.value
            et = get_event_type(value)
            d  = _data(value)

            if et == TRANSACTION_CREATED_V1:
                _audit(et, "Transaction submitted", {
                    "transaction_id": d.get("transaction_id"),
                    "amount": d.get("amount"), "currency": d.get("currency"),
                    "country": d.get("country"),
                })
            elif et == TRANSACTION_SCORED_V1:
                _audit(et, "Fraud score assigned", {
                    "transaction_id": d.get("transaction_id"),
                    "rules_score": d.get("rules_score"),
                })
            elif et == TRANSACTION_FLAGGED_V1:
                _audit(et, "Transaction flagged for review", {
                    "transaction_id": d.get("transaction_id"),
                    "rules_score": d.get("rules_score"), "reason": d.get("reason"),
                })
            elif et == TRANSACTION_FINALISED_V1:
                _audit(et, f"Transaction finalised: {d.get('outcome')}", {
                    "transaction_id": d.get("transaction_id"),
                    "outcome": d.get("outcome"), "rules_score": d.get("rules_score"),
                    "reason": d.get("reason"),
                })
            elif et == TRANSACTION_REVIEWED_V1:
                _audit(et, f"Manual review complete: {d.get('manual_outcome')}", {
                    "transaction_id": d.get("transaction_id"),
                    "manual_outcome": d.get("manual_outcome"), "reason": d.get("reason"),
                })
            elif et == APPEAL_CREATED_V1:
                _audit(et, "Appeal submitted", {
                    "appeal_id": d.get("appeal_id"),
                    "transaction_id": d.get("transaction_id"),
                    "reason_for_appeal": d.get("reason_for_appeal"),
                })
            elif et == APPEAL_RESOLVED_V1:
                _audit(et, f"Appeal resolved: {d.get('manual_outcome')}", {
                    "appeal_id": d.get("appeal_id"),
                    "transaction_id": d.get("transaction_id"),
                    "manual_outcome": d.get("manual_outcome"),
                    "outcome_reason": d.get("outcome_reason"),
                })
    finally:
        await stop_quietly(consumer)


if __name__ == "__main__":
    asyncio.run(main())
