from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


load_dotenv()


def _env(name: str, default: str) -> str:
    return os.getenv(name, default).strip()


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return int(value)


@dataclass(frozen=True)
class Settings:
    kafka_bootstrap_servers: str = _env("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")

    fraud_score_url: str = _env("FRAUD_SCORE_URL", "http://localhost:8001/score")

    database_url: str = _env("DATABASE_URL", "")

    approve_max_score: int = _env_int("APPROVE_MAX_SCORE", 40)
    flag_max_score: int = _env_int("FLAG_MAX_SCORE", 70)

    topic_transaction_created: str = _env("TOPIC_TRANSACTION_CREATED", "transaction.created")
    topic_transaction_scored: str = _env("TOPIC_TRANSACTION_SCORED", "transaction.scored")
    topic_transaction_flagged: str = _env("TOPIC_TRANSACTION_FLAGGED", "transaction.flagged")
    topic_transaction_finalised: str = _env("TOPIC_TRANSACTION_FINALISED", "transaction.finalised")
    topic_transaction_reviewed: str = _env("TOPIC_TRANSACTION_REVIEWED", "transaction.reviewed")
    topic_appeal_created: str = _env("TOPIC_APPEAL_CREATED", "appeal.created")
    topic_appeal_resolved: str = _env("TOPIC_APPEAL_RESOLVED", "appeal.resolved")


settings = Settings()
