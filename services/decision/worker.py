from __future__ import annotations

import asyncio
from typing import Any

from ftds.config import settings
from ftds.event_types import (
    TRANSACTION_FINALISED_V1,
    TRANSACTION_FLAGGED_V1,
    TRANSACTION_SCORED_V1,
)
from ftds.events import envelope, get_event_type
from ftds.kafka import create_consumer, create_producer, stop_quietly
from ftds.schemas import TransactionFinalised, TransactionFlagged, TransactionScored


async def main() -> None:
    consumer = await create_consumer(
        topics=[settings.topic_transaction_scored],
        group_id="decision",
        bootstrap_servers=settings.kafka_bootstrap_servers,
    )
    producer = await create_producer(bootstrap_servers=settings.kafka_bootstrap_servers)

    try:
        async for message in consumer:
            value: Any = message.value
            if get_event_type(value) != TRANSACTION_SCORED_V1:
                continue
            scored = TransactionScored.model_validate(value.get("data", {}))
            score = scored.rules_score

            if score <= settings.approve_max_score:
                finalised = TransactionFinalised(
                    transaction_id=scored.transaction_id,
                    outcome="APPROVED",
                    rules_score=score,
                    reason=f"score={score} <= {settings.approve_max_score}",
                )
                payload = envelope(
                    event_type=TRANSACTION_FINALISED_V1, data=finalised, trace_id=scored.transaction_id
                )
                await producer.send_and_wait(settings.topic_transaction_finalised, payload)
                continue

            if score <= settings.flag_max_score:
                flagged = TransactionFlagged(
                    transaction_id=scored.transaction_id,
                    rules_score=score,
                    reason=f"score={score} in ({settings.approve_max_score},{settings.flag_max_score}]",
                )
                payload = envelope(
                    event_type=TRANSACTION_FLAGGED_V1, data=flagged, trace_id=scored.transaction_id
                )
                await producer.send_and_wait(settings.topic_transaction_flagged, payload)
                continue

            finalised = TransactionFinalised(
                transaction_id=scored.transaction_id,
                outcome="REJECTED",
                rules_score=score,
                reason=f"score={score} > {settings.flag_max_score}",
            )
            payload = envelope(
                event_type=TRANSACTION_FINALISED_V1, data=finalised, trace_id=scored.transaction_id
            )
            await producer.send_and_wait(settings.topic_transaction_finalised, payload)
    finally:
        await stop_quietly(consumer)
        await stop_quietly(producer)


if __name__ == "__main__":
    asyncio.run(main())

