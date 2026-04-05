from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _env_csv(name: str, default: str) -> list[str]:
    raw = os.getenv(name, default)
    return [value.strip() for value in raw.split(",") if value.strip()]


def decision_mode_uses_local_decisioning(mode: str) -> bool:
    return mode in {"local", "outsystems_http"}


class Settings:
    def __init__(self) -> None:
        external_decision_url = (
            _env("OUTSYSTEMS_DECISION_URL")
            or _env("DECISION_ENGINE_SERVICE_URL")
            or _env("DECISION_BASE_URL")
        )
        configured_decision_mode = _env("DECISION_INTEGRATION_MODE", "").lower()

        approve_max = _env_int("THRESHOLD_APPROVE_MAX", _env_int("APPROVE_MAX_SCORE", 49))
        flag_min = _env_int("THRESHOLD_FLAG_MIN", approve_max + 1)
        flag_max = _env_int("THRESHOLD_FLAG_MAX", _env_int("FLAG_MAX_SCORE", 75))
        decline_min = _env_int("THRESHOLD_DECLINE_MIN", flag_max + 1)

        self.env = _env("NODE_ENV", "development")
        self.port = _env_int("PORT", 8008)
        self.service_name = _env("SERVICE_NAME", "detect-fraud")
        self.service_version = _env("SERVICE_VERSION", "2.0.0")
        self.log_level = _env("LOG_LEVEL", "INFO").upper()

        self.kafka_brokers = _env_csv("KAFKA_BROKERS", _env("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092"))
        self.kafka_client_id = _env("KAFKA_CLIENT_ID", "detect-fraud")
        self.kafka_group_id = _env("KAFKA_GROUP_ID", "detect-fraud-group")
        self.kafka_input_topic = _env("KAFKA_INPUT_TOPIC", _env("TOPIC_TRANSACTION_CREATED", "transaction.created"))
        self.kafka_output_topic = _env("KAFKA_OUTPUT_TOPIC", _env("TOPIC_TRANSACTION_SCORED", "transaction.scored"))
        self.kafka_flagged_topic = _env("KAFKA_OUTPUT_TOPIC_FLAGGED", _env("TOPIC_TRANSACTION_FLAGGED", "transaction.flagged"))
        self.kafka_finalised_topic = _env("KAFKA_OUTPUT_TOPIC_FINALISED", _env("TOPIC_TRANSACTION_FINALISED", "transaction.finalised"))
        self.kafka_dlq_topic = _env("KAFKA_DLQ_TOPIC", "detect-fraud.dlq")

        self.ml_scoring_url = _env("FRAUD_SCORE_URL", _env("ML_SCORING_SERVICE_URL", "http://fraud-score:8001/score"))
        self.ml_scoring_timeout_ms = _env_int("ML_SCORING_TIMEOUT_MS", 3000)

        self.redis_host = _env("REDIS_HOST", "")
        self.redis_port = _env_int("REDIS_PORT", 6379)
        self.redis_password = _env("REDIS_PASSWORD", "")
        self.redis_db = _env_int("REDIS_DB", 3)
        self.redis_disabled = _env_bool("REDIS_DISABLED", True)

        self.high_risk_countries = [v.upper() for v in _env_csv("HIGH_RISK_COUNTRIES", "NG,RU,CN,PK")]
        self.high_amount_threshold = _env_float("HIGH_AMOUNT_THRESHOLD", 5000)
        self.suspicious_amount_threshold = _env_float("SUSPICIOUS_AMOUNT_THRESHOLD", 10000)
        self.max_txn_per_hour = _env_int("VELOCITY_MAX_COUNT_PER_HOUR", 10)
        self.max_amount_per_hour = _env_float("VELOCITY_MAX_AMOUNT_PER_HOUR", 10000)
        self.max_txn_per_day = _env_int("VELOCITY_MAX_COUNT_PER_DAY", 50)
        self.max_distinct_recipients_per_hour = _env_int("VELOCITY_MAX_DISTINCT_RECIPIENTS_PER_HOUR", 4)
        self.max_distinct_merchants_per_hour = _env_int("VELOCITY_MAX_DISTINCT_MERCHANTS_PER_HOUR", 5)
        self.first_time_recipient_review_amount = _env_float("FIRST_TIME_RECIPIENT_REVIEW_AMOUNT", 1500)
        self.high_risk_merchant_review_amount = _env_float("HIGH_RISK_MERCHANT_REVIEW_AMOUNT", 400)
        self.prepaid_high_amount_threshold = _env_float("PREPAID_HIGH_AMOUNT_THRESHOLD", 2500)
        self.bin_blacklist = [v.strip() for v in _env_csv("BIN_BLACKLIST", "") if v.strip()]
        self.high_risk_merchant_ids = [v.upper() for v in _env_csv("HIGH_RISK_MERCHANT_IDS", "")]
        self.high_risk_merchant_prefixes = [
            v.upper() for v in _env_csv("HIGH_RISK_MERCHANT_PREFIXES", "CRYPTO_,GIFT_,CASHOUT_,FTDS_FLAGGED")
        ]

        self.scoring_velocity_count_hour = _env_float("SCORING_VELOCITY_COUNT_HOUR", 15)
        self.scoring_velocity_amount_hour = _env_float("SCORING_VELOCITY_AMOUNT_HOUR", 20)
        self.scoring_velocity_count_day = _env_float("SCORING_VELOCITY_COUNT_DAY", 10)
        self.scoring_high_risk_country = _env_float("SCORING_HIGH_RISK_COUNTRY", 25)
        self.scoring_suspicious_amount = _env_float("SCORING_SUSPICIOUS_AMOUNT", 30)
        self.scoring_high_amount = _env_float("SCORING_HIGH_AMOUNT", 10)
        self.scoring_unusual_time = _env_float("SCORING_UNUSUAL_TIME", 5)
        self.scoring_round_amount = _env_float("SCORING_ROUND_AMOUNT", 5)
        self.scoring_bin_blacklist = _env_float("SCORING_BIN_BLACKLIST", 40)

        self.rules_weight = _env_float("COMBINATION_RULES_WEIGHT", 0.4)
        self.ml_weight = _env_float("COMBINATION_ML_WEIGHT", 0.6)
        self.ml_flag_threshold = _env_float("ML_FLAG_THRESHOLD", 70)

        if configured_decision_mode in {"local", "outsystems_http", "outsystems_kafka"}:
            self.decision_integration_mode = configured_decision_mode
        elif external_decision_url:
            self.decision_integration_mode = "outsystems_http"
        else:
            self.decision_integration_mode = "local"

        self.outsystems_decision_url = external_decision_url or None
        self.outsystems_decision_timeout_ms = _env_int("OUTSYSTEMS_DECISION_TIMEOUT_MS", 5000)
        self.outsystems_auth_type = _env("OUTSYSTEMS_AUTH_TYPE", "none").lower()
        self.outsystems_bearer_token = _env("OUTSYSTEMS_BEARER_TOKEN")
        self.outsystems_auth_header_name = _env("OUTSYSTEMS_AUTH_HEADER_NAME", "X-API-Key")
        self.outsystems_auth_header_value = _env("OUTSYSTEMS_AUTH_HEADER_VALUE")
        self.local_decision_fallback_enabled = _env_bool(
            "ENABLE_LOCAL_DECISION_FALLBACK",
            self.decision_integration_mode == "local",
        )
        self.threshold_approve_max = approve_max
        self.threshold_flag_min = flag_min
        self.threshold_flag_max = flag_max
        self.threshold_decline_min = decline_min
        self.threshold_rules_flagged_auto_decline = _env_bool("THRESHOLD_RULES_FLAGGED_AUTO_DECLINE", False)
        self.threshold_certainty_auto_decline_enabled = _env_bool("THRESHOLD_CERTAINTY_AUTO_DECLINE_ENABLED", False)
        self.threshold_certainty_decline_min_score = _env_int("THRESHOLD_CERTAINTY_DECLINE_MIN_SCORE", 70)
        self.threshold_certainty_decline_min_confidence = _env_float("THRESHOLD_CERTAINTY_DECLINE_MIN_CONFIDENCE", 0.9)
        self.threshold_high_confidence_approve = _env_float("THRESHOLD_HIGH_CONFIDENCE_APPROVE", 0.95)
        self.threshold_low_confidence_flag = _env_float("THRESHOLD_LOW_CONFIDENCE_FLAG", 0.6)
        self.threshold_high_value_amount = _env_float("THRESHOLD_HIGH_VALUE_AMOUNT", self.suspicious_amount_threshold)
        self.threshold_high_value_auto_flag = _env_bool("THRESHOLD_HIGH_VALUE_AUTO_FLAG", False)
        self.auto_approve_whitelist = _env_csv("AUTO_APPROVE_WHITELIST_CUSTOMERS", "")
        self.auto_decline_blacklist = _env_csv("AUTO_DECLINE_BLACKLIST_CUSTOMERS", "")
        self.require_manual_review_countries = [
            v.upper() for v in _env_csv("REQUIRE_MANUAL_REVIEW_COUNTRIES", _env("HIGH_RISK_COUNTRIES", "NG,RU,CN,PK"))
        ]


settings = Settings()
