from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

import httpx
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from aiokafka.coordinator.assignors.roundrobin import RoundRobinPartitionAssignor
from fastapi import FastAPI

from services.detect_fraud.src.config.settings import decision_mode_uses_local_decisioning, settings
from services.detect_fraud.src.consumers.transaction_consumer import (
    normalize_transaction,
    send_to_dlq,
    validate_transaction,
)
from services.detect_fraud.src.controllers.decision_publisher import DecisionPublisher
from services.detect_fraud.src.controllers.fraud_detection_service import FraudDetectionService
from services.detect_fraud.src.controllers.ml_scoring_client import MlScoringClient
from services.detect_fraud.src.controllers.rules_engine import FraudRulesEngine
from services.detect_fraud.src.routes.health_routes import router as health_router
from services.detect_fraud.src.state import state
from services.detect_fraud.src.utils.observability import instrument_fastapi, shutdown_tracing
from services.detect_fraud.src.utils.velocity_store import VelocityStore

logging.basicConfig(
    level=getattr(logging, settings.log_level, logging.INFO),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("detect_fraud")


class KafkaJSCompatibleRoundRobinAssignor(RoundRobinPartitionAssignor):
    name = "RoundRobinAssigner"


def _json_serializer(value: Any) -> bytes:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False, default=str).encode("utf-8")


def _header(name: str, value: str | None) -> tuple[str, bytes]:
    return (name, (value or "").encode("utf-8"))


async def _publish_scored_event(
    transaction: dict[str, Any],
    payload: dict[str, Any],
    fraud_analysis: dict[str, Any],
) -> None:
    if state.producer is None:
        raise RuntimeError("Detect fraud producer is not ready")

    await state.producer.send_and_wait(
        settings.kafka_output_topic,
        key=str(transaction["customerId"]).encode("utf-8"),
        value={
            "eventType": "transaction.scored",
            "transactionId": transaction["id"],
            "customerId": transaction["customerId"],
            "merchantId": transaction["merchantId"],
            "correlationId": payload.get("correlationId") or payload.get("trace_id") or transaction["id"],
            "originalTransaction": transaction,
            "fraudAnalysis": fraud_analysis,
            "data": {
                "transaction_id": transaction["id"],
                "rules_score": fraud_analysis["riskScore"],
                "reason": fraud_analysis["reasons"][0] if fraud_analysis["reasons"] else None,
            },
            "processedAt": datetime.now(timezone.utc).isoformat(),
        },
        headers=[
            _header("content-type", "application/json"),
            _header("service-source", settings.service_name),
        ],
    )


async def _handle_message(message: Any) -> None:
    raw_bytes = message.value
    raw_payload = raw_bytes.decode("utf-8", errors="replace") if raw_bytes else None

    if not raw_payload:
        logger.warning("Sending empty transaction.created event to DLQ")
        await send_to_dlq(
            state.producer,
            topic=message.topic, partition=message.partition,
            offset=message.offset, reason="empty_payload",
        )
        await state.consumer.commit()
        return

    try:
        payload = json.loads(raw_payload)
    except json.JSONDecodeError as exc:
        logger.error("Sending malformed transaction.created event to DLQ: %s", exc)
        await send_to_dlq(
            state.producer,
            topic=message.topic, partition=message.partition,
            offset=message.offset, reason="parse_error",
            raw_payload=raw_payload, error=str(exc),
        )
        await state.consumer.commit()
        return

    transaction = normalize_transaction(payload)
    validation_error = validate_transaction(transaction)
    if validation_error is not None:
        logger.error("Sending invalid transaction.created event to DLQ: %s", validation_error)
        await send_to_dlq(
            state.producer,
            topic=message.topic, partition=message.partition,
            offset=message.offset, reason="invalid_event",
            raw_payload=raw_payload, parsed_payload=payload, error=validation_error,
        )
        await state.consumer.commit()
        return

    fraud_analysis = await state.fraud_detection_service.analyze_transaction(transaction)
    await _publish_scored_event(transaction, payload, fraud_analysis)

    correlation_id = payload.get("correlationId") or payload.get("trace_id") or transaction["id"]

    if decision_mode_uses_local_decisioning(settings.decision_integration_mode):
        await state.decision_publisher.process(
            producer=state.producer,
            transaction=transaction,
            fraud_analysis=fraud_analysis,
            correlation_id=correlation_id,
        )
    else:
        logger.info(
            "Published transaction.scored and deferred final decision to external Kafka consumer",
            extra={
                "transactionId": transaction["id"],
                "decisionIntegrationMode": settings.decision_integration_mode,
                "correlationId": correlation_id,
            },
        )
    await state.consumer.commit()


async def _consume_transactions() -> None:
    assert state.consumer is not None
    try:
        async for message in state.consumer:
            await _handle_message(message)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        state.processing_error = exc
        logger.exception("Fraud detection consumer failed to process transaction")
        raise


@asynccontextmanager
async def lifespan(_app: FastAPI):
    state.processing_error = None
    state.velocity_store = VelocityStore()
    state.http_client = httpx.AsyncClient(timeout=settings.ml_scoring_timeout_ms / 1000)
    ml_scoring_client = MlScoringClient(state.http_client)
    rules_engine = FraudRulesEngine(state.velocity_store)
    state.fraud_detection_service = FraudDetectionService(rules_engine, ml_scoring_client)
    state.decision_publisher = DecisionPublisher(state.http_client)

    state.producer = AIOKafkaProducer(
        bootstrap_servers=settings.kafka_brokers,
        value_serializer=_json_serializer,
        compression_type="gzip",
        acks="all",
        enable_idempotence=True,
        client_id=f"{settings.kafka_client_id}-producer",
    )
    await state.producer.start()

    state.consumer = AIOKafkaConsumer(
        settings.kafka_input_topic,
        bootstrap_servers=settings.kafka_brokers,
        group_id=settings.kafka_group_id,
        auto_offset_reset="latest",
        enable_auto_commit=False,
        client_id=f"{settings.kafka_client_id}-consumer",
        partition_assignment_strategy=(KafkaJSCompatibleRoundRobinAssignor,),
    )
    await state.consumer.start()
    state.consumer_task = asyncio.create_task(_consume_transactions())

    try:
        yield
    finally:
        if state.consumer_task is not None:
            state.consumer_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await state.consumer_task
            state.consumer_task = None
        if state.consumer is not None:
            await state.consumer.stop()
            state.consumer = None
        if state.producer is not None:
            await state.producer.stop()
            state.producer = None
        if state.http_client is not None:
            await state.http_client.aclose()
            state.http_client = None
        if state.velocity_store is not None:
            await state.velocity_store.close()
            state.velocity_store = None
        state.fraud_detection_service = None
        state.decision_publisher = None
        shutdown_tracing()


app = FastAPI(title="FTDS Fraud Detection Service", version=settings.service_version, lifespan=lifespan)
instrument_fastapi(app)

app.include_router(health_router)
app.include_router(health_router, prefix="/api/v1")
