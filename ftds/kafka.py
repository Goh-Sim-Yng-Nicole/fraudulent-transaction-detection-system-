from __future__ import annotations

import json
from typing import Any, Callable, Optional

from aiokafka import AIOKafkaConsumer, AIOKafkaProducer


def _json_dumps(value: Any) -> bytes:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _json_loads(value: Optional[bytes]) -> Any:
    if value is None:
        return None
    return json.loads(value.decode("utf-8"))


async def create_producer(*, bootstrap_servers: str) -> AIOKafkaProducer:
    producer = AIOKafkaProducer(
        bootstrap_servers=bootstrap_servers,
        value_serializer=_json_dumps,
    )
    await producer.start()
    return producer


async def create_consumer(
    *,
    topics: list[str],
    group_id: str,
    bootstrap_servers: str,
    auto_offset_reset: str = "earliest",
    enable_auto_commit: bool = True,
) -> AIOKafkaConsumer:
    consumer = AIOKafkaConsumer(
        *topics,
        group_id=group_id,
        bootstrap_servers=bootstrap_servers,
        auto_offset_reset=auto_offset_reset,
        enable_auto_commit=enable_auto_commit,
        value_deserializer=_json_loads,
    )
    await consumer.start()
    return consumer


async def stop_quietly(resource: Any) -> None:
    try:
        await resource.stop()
    except Exception:
        return
