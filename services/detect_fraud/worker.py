from __future__ import annotations

import asyncio
from typing import Any

import httpx

from ftds.config import settings
from ftds.event_types import TRANSACTION_CREATED_V1, TRANSACTION_SCORED_V1
from ftds.events import envelope, get_event_type
from ftds.kafka import create_consumer, create_producer, stop_quietly
from ftds.schemas import FraudScoreRequest, TransactionCreated, TransactionScored


async def main() -> None:
    consumer = await create_consumer(
        topics=[settings.topic_transaction_created],
        group_id="detect-fraud",
        bootstrap_servers=settings.kafka_bootstrap_servers,
    )
    producer = await create_producer(bootstrap_servers=settings.kafka_bootstrap_servers)

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            async for message in consumer:
                value: Any = message.value
                if get_event_type(value) != TRANSACTION_CREATED_V1:
                    continue
                created = TransactionCreated.model_validate(value.get("data", {}))
                score_request = FraudScoreRequest(**created.model_dump())
                resp = await client.post(settings.fraud_score_url, json=score_request.model_dump())
                resp.raise_for_status()
                rules_score = int(resp.json().get("rules_score", 0))

                scored = TransactionScored(transaction_id=created.transaction_id, rules_score=rules_score)
                payload = envelope(
                    event_type=TRANSACTION_SCORED_V1, data=scored, trace_id=created.transaction_id
                )
                await producer.send_and_wait(settings.topic_transaction_scored, payload)
        finally:
            await stop_quietly(consumer)
            await stop_quietly(producer)


if __name__ == "__main__":
    asyncio.run(main())
