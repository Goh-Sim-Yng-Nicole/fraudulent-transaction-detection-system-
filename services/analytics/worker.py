from __future__ import annotations

import asyncio
from collections import Counter
from typing import Any

from ftds.config import settings
from ftds.kafka import create_consumer, stop_quietly


async def main() -> None:
    counts: Counter[str] = Counter()
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
            if isinstance(value, dict) and isinstance(value.get("event_type"), str):
                counts[value["event_type"]] += 1
            print(f"[analytics] counts={dict(counts)} last={value}")
    finally:
        await stop_quietly(consumer)


if __name__ == "__main__":
    asyncio.run(main())

