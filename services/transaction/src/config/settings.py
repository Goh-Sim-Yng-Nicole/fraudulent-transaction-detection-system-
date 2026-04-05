from __future__ import annotations

import os

SERVICE_NAME = os.getenv("SERVICE_NAME", "transaction").strip() or "transaction"
SERVICE_VERSION = os.getenv("SERVICE_VERSION", "2.0.0").strip() or "2.0.0"

KAFKA_BOOTSTRAP_SERVERS = (
    os.getenv("KAFKA_BROKERS")
    or os.getenv("KAFKA_BOOTSTRAP_SERVERS")
    or "localhost:9092"
).strip()
KAFKA_CLIENT_ID = os.getenv("KAFKA_CLIENT_ID", "transaction-service").strip() or "transaction-service"
KAFKA_GROUP_ID = os.getenv("KAFKA_GROUP_ID", "transaction-service").strip() or "transaction-service"

TOPIC_TRANSACTION_CREATED = (
    os.getenv("KAFKA_TOPIC_TRANSACTION_CREATED")
    or os.getenv("TOPIC_TRANSACTION_CREATED")
    or "transaction.created"
).strip()
TOPIC_TRANSACTION_FLAGGED = (
    os.getenv("KAFKA_TOPIC_TRANSACTION_FLAGGED")
    or os.getenv("TOPIC_TRANSACTION_FLAGGED")
    or "transaction.flagged"
).strip()
TOPIC_TRANSACTION_FINALISED = (
    os.getenv("KAFKA_TOPIC_TRANSACTION_FINALISED")
    or os.getenv("TOPIC_TRANSACTION_FINALISED")
    or "transaction.finalised"
).strip()
TOPIC_TRANSACTION_REVIEWED = (
    os.getenv("KAFKA_TOPIC_TRANSACTION_REVIEWED")
    or os.getenv("TOPIC_TRANSACTION_REVIEWED")
    or "transaction.reviewed"
).strip()
TOPIC_APPEAL_RESOLVED = (
    os.getenv("KAFKA_TOPIC_APPEAL_RESOLVED")
    or os.getenv("TOPIC_APPEAL_RESOLVED")
    or "appeal.resolved"
).strip()
TOPIC_TRANSACTION_DLQ = os.getenv("KAFKA_DLQ_TOPIC", "transaction.dlq").strip() or "transaction.dlq"

REQUEST_ID_HEADER = "x-request-id"
CORRELATION_ID_HEADER = "x-correlation-id"
IDEMPOTENCY_KEY_HEADER = "x-idempotency-key"
