from __future__ import annotations

from datetime import datetime

import httpx

from services.detect_fraud.circuit_breaker import CircuitBreaker
from services.detect_fraud.config import settings


def _normalize_response(data: dict[str, object] | None, fallback_score: int) -> dict[str, object]:
    if not data:
        return {
            "score": fallback_score,
            "confidence": None,
            "modelVersion": "fallback-v1",
            "features": {
                "fallbackReason": "service_unavailable",
                "derivedFromRules": True,
            },
        }

    if isinstance(data.get("rules_score"), (int, float)):
        return {
            "score": int(data["rules_score"]),
            "confidence": data.get("confidence") if isinstance(data.get("confidence"), (int, float)) else None,
            "modelVersion": str(data.get("model_version") or "ftds-risk-model"),
            "features": data.get("features") if isinstance(data.get("features"), dict) else {},
        }

    payload = data.get("data")
    if data.get("success") and isinstance(payload, dict) and isinstance(payload.get("score"), (int, float)):
        return {
            "score": int(payload["score"]),
            "confidence": payload.get("confidence") if isinstance(payload.get("confidence"), (int, float)) else None,
            "modelVersion": str(payload.get("modelVersion") or payload.get("model_version") or "ftds-risk-model"),
            "features": payload.get("features") if isinstance(payload.get("features"), dict) else {},
        }

    return {
        "score": fallback_score,
        "confidence": None,
        "modelVersion": "fallback-v1",
        "features": {
            "fallbackReason": "invalid_response",
            "derivedFromRules": True,
        },
    }


def _modern_url(url: str) -> str:
    if "/api/v1/" in url:
        return url
    if url.endswith("/score"):
        return url[: -len("/score")] + "/api/v1/score"
    return url.rstrip("/") + "/api/v1/score"


def _risk_factors(rule_results: dict[str, object]) -> dict[str, object]:
    risk_factors = rule_results.get("riskFactors")
    return risk_factors if isinstance(risk_factors, dict) else {}


def _velocity_count_last_hour(rule_results: dict[str, object]) -> int:
    velocity = _risk_factors(rule_results).get("velocity")
    if isinstance(velocity, dict):
        for key in ("countLastHour", "customerTransactionsLastHour"):
            value = velocity.get(key)
            if isinstance(value, (int, float)):
                return int(value)
    return 0


def _high_risk_country(rule_results: dict[str, object]) -> bool:
    geography = _risk_factors(rule_results).get("geography")
    if isinstance(geography, dict):
        return bool(geography.get("highRiskCountry"))
    return False


def _hour_utc(transaction: dict[str, object], rule_results: dict[str, object]) -> int:
    time_factors = _risk_factors(rule_results).get("time")
    if isinstance(time_factors, dict):
        for key in ("hourUtc", "transactionHourUTC"):
            value = time_factors.get(key)
            if isinstance(value, (int, float)):
                return int(value)

    metadata = transaction.get("metadata")
    if isinstance(metadata, dict):
        value = metadata.get("hourUtc") or metadata.get("hour_utc")
        if isinstance(value, (int, float)):
            return int(value)

    created_at = str(transaction.get("createdAt") or "").strip()
    if created_at:
        return datetime.fromisoformat(created_at.replace("Z", "+00:00")).hour

    return 0


class MlScoringClient:
    def __init__(self, http_client: httpx.AsyncClient) -> None:
        self._http_client = http_client
        self._breaker = CircuitBreaker()

    async def score(self, transaction: dict[str, object], rule_results: dict[str, object]) -> dict[str, object]:
        fallback_score = 30
        if bool(rule_results.get("flagged")):
            fallback_score += 40
        fallback_score += min(len(rule_results.get("reasons") or []) * 5, 20)
        if bool(((rule_results.get("riskFactors") or {}).get("amount") or {}).get("highAmount")):
            fallback_score += 5
        fallback_score = min(95, fallback_score)
        if self._breaker.is_open():
            return _normalize_response(None, fallback_score)

        url = settings.ml_scoring_url
        count_last_hour = _velocity_count_last_hour(rule_results)
        high_risk_country = _high_risk_country(rule_results)
        modern_payload = {
            "transaction": {
                "id": transaction["id"],
                "customerId": transaction["customerId"],
                "merchantId": transaction["merchantId"],
                "amount": transaction["amount"],
                "currency": transaction["currency"],
                "cardType": transaction["cardType"],
                "location": transaction.get("location") or {},
                "metadata": transaction.get("metadata") or {},
                "createdAt": transaction["createdAt"],
            },
            "ruleResults": {
                "riskFactors": {
                    "velocity": {
                        "countLastHour": count_last_hour,
                    },
                    "geography": {
                        "highRiskCountry": high_risk_country,
                    },
                },
            },
        }

        try:
            response = await self._http_client.post(_modern_url(url), json=modern_payload)
            response.raise_for_status()
            self._breaker.record_success()
            return _normalize_response(response.json(), fallback_score)
        except Exception:
            self._breaker.record_failure()

        legacy_payload = {
            "amount": transaction["amount"],
            "currency": transaction["currency"],
            "card_type": transaction["cardType"],
            "country": (transaction.get("location") or {}).get("country", "SG"),
            "hour_utc": _hour_utc(transaction, rule_results),
            "merchant_id": transaction["merchantId"],
            "velocity_txn_hour_raw": count_last_hour,
            "geo_country_high_risk": high_risk_country,
        }

        try:
            legacy_response = await self._http_client.post(url, json=legacy_payload)
            legacy_response.raise_for_status()
            self._breaker.record_success()
            return _normalize_response(legacy_response.json(), fallback_score)
        except Exception:
            return _normalize_response(None, fallback_score)
