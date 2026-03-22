from __future__ import annotations

import httpx

from services.detect_fraud.circuit_breaker import CircuitBreaker
from services.detect_fraud.config import settings


def _normalize_response(data: dict[str, object] | None, fallback_score: int) -> dict[str, object]:
    if not data:
        return {
            "score": fallback_score,
            "confidence": None,
            "modelVersion": "fallback-v1",
        }

    if isinstance(data.get("rules_score"), (int, float)):
        return {
            "score": int(data["rules_score"]),
            "confidence": data.get("confidence") if isinstance(data.get("confidence"), (int, float)) else None,
            "modelVersion": str(data.get("model_version") or "ftds-risk-model"),
        }

    payload = data.get("data")
    if data.get("success") and isinstance(payload, dict) and isinstance(payload.get("score"), (int, float)):
        return {
            "score": int(payload["score"]),
            "confidence": payload.get("confidence") if isinstance(payload.get("confidence"), (int, float)) else None,
            "modelVersion": str(payload.get("modelVersion") or payload.get("model_version") or "ftds-risk-model"),
        }

    return {
        "score": fallback_score,
        "confidence": None,
        "modelVersion": "fallback-v1",
    }


def _modern_url(url: str) -> str:
    if "/api/v1/" in url:
        return url
    if url.endswith("/score"):
        return url[: -len("/score")] + "/api/v1/score"
    return url.rstrip("/") + "/api/v1/score"


class MlScoringClient:
    def __init__(self, http_client: httpx.AsyncClient) -> None:
        self._http_client = http_client
        self._breaker = CircuitBreaker()

    async def score(self, transaction: dict[str, object], rule_results: dict[str, object]) -> dict[str, object]:
        fallback_score = min(95, round(float(rule_results["ruleScore"]) * 0.9) or 35)
        if self._breaker.is_open():
            return _normalize_response(None, fallback_score)

        url = settings.ml_scoring_url
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
            "ruleResults": rule_results,
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
            "hour_utc": rule_results["riskFactors"]["time"]["hourUtc"],
            "merchant_id": transaction["merchantId"],
            "velocity_txn_hour_raw": rule_results["riskFactors"]["velocity"]["countLastHour"],
            "geo_country_high_risk": rule_results["riskFactors"]["geography"]["highRiskCountry"],
        }

        try:
            legacy_response = await self._http_client.post(url, json=legacy_payload)
            legacy_response.raise_for_status()
            self._breaker.record_success()
            return _normalize_response(legacy_response.json(), fallback_score)
        except Exception:
            return _normalize_response(None, fallback_score)
