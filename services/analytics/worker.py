from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any

from ftds.config import settings
from ftds.event_types import (
    APPEAL_CREATED_V1,
    APPEAL_RESOLVED_V1,
    TRANSACTION_FINALISED_V1,
    TRANSACTION_FLAGGED_V1,
    TRANSACTION_REVIEWED_V1,
)
from ftds.events import get_event_type
from ftds.kafka import create_consumer, stop_quietly


# In-memory dashboard metrics (reset on restart — acceptable for demo)
dashboard: dict[str, Any] = {
    "transactions_approved":  0,
    "transactions_rejected":  0,
    "transactions_flagged":   0,
    "transactions_reviewed":  0,
    "appeals_created":        0,
    "appeals_approved":       0,
    "appeals_rejected":       0,
    "total_approved_amount":  0.0,
    "total_rejected_amount":  0.0,
}


def _print_dashboard() -> None:
    snapshot = {"updated_at": datetime.now(timezone.utc).isoformat(), **dashboard}
    print(f"[analytics] {json.dumps(snapshot)}", flush=True)


def _data(value: Any) -> dict[str, Any]:
    return value.get("data", {}) if isinstance(value, dict) else {}


async def main() -> None:
    consumer = await create_consumer(
        topics=[
            settings.topic_transaction_flagged,
            settings.topic_transaction_finalised,
            settings.topic_transaction_reviewed,
            settings.topic_appeal_created,
            settings.topic_appeal_resolved,
        ],
        group_id="analytics",
        bootstrap_servers=settings.kafka_bootstrap_servers,
    )
    try:
        async for message in consumer:
            value: Any = message.value
            et = get_event_type(value)
            d  = _data(value)

            if et == TRANSACTION_FLAGGED_V1:
                dashboard["transactions_flagged"] += 1

            elif et == TRANSACTION_FINALISED_V1:
                outcome = d.get("outcome", "")
                amount  = float(d.get("amount") or 0)
                if outcome == "APPROVED":
                    dashboard["transactions_approved"]    += 1
                    dashboard["total_approved_amount"]    += amount
                elif outcome == "REJECTED":
                    dashboard["transactions_rejected"]    += 1
                    dashboard["total_rejected_amount"]    += amount

            elif et == TRANSACTION_REVIEWED_V1:
                dashboard["transactions_reviewed"] += 1

            elif et == APPEAL_CREATED_V1:
                dashboard["appeals_created"] += 1

            elif et == APPEAL_RESOLVED_V1:
                outcome = d.get("manual_outcome", "")
                if outcome == "APPROVED":
                    dashboard["appeals_approved"] += 1
                elif outcome == "REJECTED":
                    dashboard["appeals_rejected"] += 1

            _print_dashboard()
    finally:
        await stop_quietly(consumer)


if __name__ == "__main__":
    asyncio.run(main())
