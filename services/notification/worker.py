from __future__ import annotations

import asyncio
from typing import Any

from ftds.config import settings
from ftds.kafka import create_consumer, stop_quietly


async def main() -> None:
    consumer = await create_consumer(
        topics=[
            settings.topic_transaction_flagged,
            settings.topic_transaction_finalised,
            settings.topic_transaction_reviewed,
            settings.topic_appeal_resolved,
        ],
        group_id="notification",
        bootstrap_servers=settings.kafka_bootstrap_servers,
    )
    try:
        async for message in consumer:
            value: Any = message.value
            print(f"[notification] {value}")
    finally:
        await stop_quietly(consumer)


if __name__ == "__main__":
    asyncio.run(main())

