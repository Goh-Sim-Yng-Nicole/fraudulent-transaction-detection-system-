from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from services.detect_fraud.src.config.settings import settings

logger = logging.getLogger("detect_fraud.decision_publisher")

FLAGGED_EVENT_TYPE = "transaction.flagged"
FINALISED_EVENT_TYPE = "transaction.finalised"


def _header(name: str, value: str | None) -> tuple[str, bytes]:
    return (name, (value or "").encode("utf-8"))


class DecisionPublisher:
    def __init__(self, http_client: httpx.AsyncClient) -> None:
        self._http_client = http_client
        self.decision_version = "detect-fraud-local-fallback-1.0.0"

    def _outsystems_headers(self, correlation_id: str) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "X-Correlation-ID": correlation_id,
            "X-Service-Source": settings.service_name,
        }
        if settings.outsystems_auth_type == "bearer" and settings.outsystems_bearer_token:
            headers["Authorization"] = f"Bearer {settings.outsystems_bearer_token}"
        elif (
            settings.outsystems_auth_type == "header"
            and settings.outsystems_auth_header_name
            and settings.outsystems_auth_header_value
        ):
            headers[settings.outsystems_auth_header_name] = settings.outsystems_auth_header_value
        return headers

    async def process(
        self,
        *,
        producer: Any,
        transaction: dict[str, Any],
        fraud_analysis: dict[str, Any],
        correlation_id: str,
    ) -> None:
        if producer is None:
            raise RuntimeError("Kafka producer is required to publish decision events")

        if settings.outsystems_decision_url:
            externally_handled = await self._send_to_outsystems(
                producer=producer,
                transaction=transaction,
                fraud_analysis=fraud_analysis,
                correlation_id=correlation_id,
            )
            if externally_handled:
                return

        if not settings.local_decision_fallback_enabled:
            raise RuntimeError(
                f"Decision handoff failed for transaction {transaction['id']} and no local fallback is enabled"
            )

        decision_result = self._make_local_decision(fraud_analysis, transaction)
        await self._publish_decision_event(
            producer=producer,
            transaction=transaction,
            fraud_analysis=fraud_analysis,
            correlation_id=correlation_id,
            decision_result=decision_result,
            source="local-fallback" if settings.outsystems_decision_url else "local-default",
        )

    async def _send_to_outsystems(
        self,
        *,
        producer: Any,
        transaction: dict[str, Any],
        fraud_analysis: dict[str, Any],
        correlation_id: str,
    ) -> bool:
        try:
            response = await self._http_client.post(
                str(settings.outsystems_decision_url),
                json={
                    "eventType": "transaction.scored",
                    "transactionId": transaction["id"],
                    "customerId": transaction["customerId"],
                    "merchantId": transaction["merchantId"],
                    "correlationId": correlation_id,
                    "originalTransaction": transaction,
                    "fraudAnalysis": fraud_analysis,
                    "processedAt": datetime.now(timezone.utc).isoformat(),
                },
                timeout=settings.outsystems_decision_timeout_ms / 1000,
                headers=self._outsystems_headers(correlation_id),
            )
            if response.status_code < 200 or response.status_code >= 300:
                raise RuntimeError(f"OutSystems returned {response.status_code}")

            decision_result = self._normalize_external_decision(response.json())
            if decision_result is not None:
                await self._publish_decision_event(
                    producer=producer,
                    transaction=transaction,
                    fraud_analysis=fraud_analysis,
                    correlation_id=correlation_id,
                    decision_result=decision_result,
                    source="outsystems-sync",
                )
            else:
                logger.info(
                    "Fraud score forwarded to OutSystems decision endpoint",
                    extra={"transactionId": transaction["id"], "responseStatus": response.status_code},
                )
            return True
        except Exception as exc:
            logger.warning("OutSystems decision handoff failed for transaction %s: %s", transaction["id"], exc)
            return False

    def _normalize_external_decision(self, body: dict[str, Any]) -> dict[str, Any] | None:
        payload = body.get("data") if isinstance(body.get("data"), dict) else body
        raw_decision = str(payload.get("decision") or payload.get("outcome") or "").upper()
        decision = "DECLINED" if raw_decision == "REJECTED" else raw_decision
        if decision not in {"APPROVED", "DECLINED", "FLAGGED"}:
            return None
        return {
            "decision": decision,
            "decisionReason": payload.get("decisionReason") or payload.get("reason") or "Decision returned by OutSystems",
            "decisionFactors": payload.get("decisionFactors") or {"source": "OUTSYSTEMS"},
            "overrideApplied": bool(payload.get("overrideApplied")),
            "overrideReason": payload.get("overrideReason"),
            "overrideType": payload.get("overrideType") or "OUTSYSTEMS",
            "decisionVersion": payload.get("decisionVersion") or "outsystems",
        }

    def _make_local_decision(self, fraud_analysis: dict[str, Any], transaction: dict[str, Any]) -> dict[str, Any]:
        decision_factors: dict[str, Any] = {}
        reasons: list[str] = []
        override: dict[str, Any] | None = None

        list_override = self._check_lists(str(fraud_analysis["customerId"]))
        if list_override is not None:
            decision_factors["listOverride"] = True
            reasons.append(list_override["reason"])
            return self._build_decision_result(list_override["decision"], reasons, decision_factors, list_override)

        if settings.threshold_rules_flagged_auto_decline and fraud_analysis["ruleResults"].get("flagged"):
            decision_factors["rulesFlagged"] = True
            reasons.append("Rules engine flagged transaction")
            return self._build_decision_result("DECLINED", reasons, decision_factors, None)

        confidence_adjustment = self._apply_confidence_adjustment(
            int(fraud_analysis["riskScore"]), fraud_analysis["mlResults"].get("confidence")
        )
        adjusted_score = confidence_adjustment["adjustedScore"]
        decision_factors["confidenceAdjustment"] = confidence_adjustment

        certainty_auto_decline = self._check_certainty_auto_decline(
            adjusted_score, fraud_analysis["mlResults"].get("confidence")
        )
        if certainty_auto_decline is not None:
            reasons.append(certainty_auto_decline["reason"])
            decision_factors["certaintyAutoDecline"] = True
            decision_factors["adjustedScore"] = adjusted_score
            return self._build_decision_result("DECLINED", reasons, decision_factors, None)

        if adjusted_score >= settings.threshold_decline_min:
            decision_factors["thresholdBased"] = True
            decision_factors["adjustedScore"] = adjusted_score
            decision_factors["originalScore"] = fraud_analysis["riskScore"]
            reasons.append(
                f"Risk score {adjusted_score} exceeds decline threshold ({settings.threshold_decline_min})"
            )
            return self._build_decision_result("DECLINED", reasons, decision_factors, None)

        if adjusted_score <= settings.threshold_approve_max:
            decision_factors["thresholdBased"] = True
            decision_factors["adjustedScore"] = adjusted_score
            decision_factors["originalScore"] = fraud_analysis["riskScore"]
            reasons.append(
                f"Risk score {adjusted_score} below approval threshold ({settings.threshold_approve_max})"
            )
            return self._build_decision_result("APPROVED", reasons, decision_factors, None)

        high_value_override = self._check_high_value(transaction)
        if high_value_override is not None:
            reasons.append(high_value_override["reason"])
            decision_factors["highValue"] = True
            return self._build_decision_result(high_value_override["decision"], reasons, decision_factors, high_value_override)

        geography_override = self._check_geography(transaction)
        if geography_override is not None:
            reasons.append(geography_override["reason"])
            decision_factors["geographicRisk"] = True
            return self._build_decision_result(geography_override["decision"], reasons, decision_factors, geography_override)

        decision = "FLAGGED"
        reasons.append(
            f"Risk score {adjusted_score} in manual review range ({settings.threshold_flag_min}-{settings.threshold_flag_max})"
        )

        decision_factors["thresholdBased"] = True
        decision_factors["adjustedScore"] = adjusted_score
        return self._build_decision_result(decision, reasons, decision_factors, override)

    def _check_lists(self, customer_id: str) -> dict[str, str] | None:
        if customer_id in settings.auto_approve_whitelist:
            return {"decision": "APPROVED", "reason": "Customer on auto-approve whitelist", "type": "WHITELIST"}
        if customer_id in settings.auto_decline_blacklist:
            return {"decision": "DECLINED", "reason": "Customer on auto-decline blacklist", "type": "BLACKLIST"}
        return None

    def _check_certainty_auto_decline(self, adjusted_score: int, confidence: Any) -> dict[str, str] | None:
        if not settings.threshold_certainty_auto_decline_enabled:
            return None
        if not isinstance(confidence, (int, float)):
            return None
        if (adjusted_score >= settings.threshold_certainty_decline_min_score
                and float(confidence) >= settings.threshold_certainty_decline_min_confidence):
            return {
                "decision": "DECLINED",
                "reason": f"High-certainty fraud signal (score {adjusted_score}, confidence {float(confidence)}) auto-declined",
                "type": "CERTAINTY_AUTO_DECLINE",
            }
        return None

    def _check_high_value(self, transaction: dict[str, Any]) -> dict[str, str] | None:
        amount = float(transaction["amount"])
        if settings.threshold_high_value_auto_flag and amount >= settings.threshold_high_value_amount:
            return {"decision": "FLAGGED", "reason": f"High-value transaction (${amount:g}) requires manual review", "type": "HIGH_VALUE"}
        return None

    def _check_geography(self, transaction: dict[str, Any]) -> dict[str, str] | None:
        country = str((transaction.get("location") or {}).get("country", "")).upper()
        if country and country in settings.require_manual_review_countries:
            return {"decision": "FLAGGED", "reason": f"Transaction from high-risk country ({country}) requires manual review", "type": "GEOGRAPHIC_RISK"}
        return None

    def _apply_confidence_adjustment(self, risk_score: int, confidence: Any) -> dict[str, Any]:
        if not isinstance(confidence, (int, float)):
            return {"adjustedScore": risk_score, "confidenceUsed": False, "adjustment": 0}
        adjustment = 0
        numeric_confidence = float(confidence)
        if numeric_confidence >= settings.threshold_high_confidence_approve and risk_score <= 60:
            adjustment = -5
        if numeric_confidence < settings.threshold_low_confidence_flag and risk_score >= 40:
            adjustment = +10
        return {
            "adjustedScore": max(0, min(100, risk_score + adjustment)),
            "confidenceUsed": True,
            "adjustment": adjustment,
            "originalConfidence": numeric_confidence,
        }

    def _build_decision_result(
        self,
        decision: str,
        reasons: list[str],
        decision_factors: dict[str, Any],
        override: dict[str, Any] | None,
    ) -> dict[str, Any]:
        return {
            "decision": decision,
            "decisionReason": "; ".join(reasons),
            "decisionFactors": decision_factors,
            "overrideApplied": override is not None,
            "overrideReason": override["reason"] if override else None,
            "overrideType": override["type"] if override else None,
            "decisionVersion": self.decision_version,
        }

    async def _publish_decision_event(
        self,
        *,
        producer: Any,
        transaction: dict[str, Any],
        fraud_analysis: dict[str, Any],
        correlation_id: str,
        decision_result: dict[str, Any],
        source: str,
    ) -> None:
        is_flagged = decision_result["decision"] == "FLAGGED"
        event_type = FLAGGED_EVENT_TYPE if is_flagged else FINALISED_EVENT_TYPE
        topic = settings.kafka_flagged_topic if is_flagged else settings.kafka_finalised_topic
        processed_at = datetime.now(timezone.utc).isoformat()

        payload = {
            "event_type": f"{event_type}.v1",
            "trace_id": transaction["id"],
            "data": {
                "transaction_id": transaction["id"],
                "rules_score": fraud_analysis["riskScore"],
                "reason": decision_result["decisionReason"],
            } if is_flagged else {
                "transaction_id": transaction["id"],
                "outcome": "APPROVED" if decision_result["decision"] == "APPROVED" else "REJECTED",
                "rules_score": fraud_analysis["riskScore"],
                "reason": decision_result["decisionReason"],
            },
            "eventType": event_type,
            "transactionId": transaction["id"],
            "customerId": transaction["customerId"],
            "merchantId": transaction["merchantId"],
            "decision": decision_result["decision"],
            "decisionReason": decision_result["decisionReason"],
            "decisionFactors": decision_result["decisionFactors"],
            "originalTransaction": transaction,
            "fraudAnalysis": fraud_analysis,
            "processedAt": processed_at,
            "decidedAt": processed_at,
            "correlationId": correlation_id,
            "sourceService": settings.service_name,
            "decisionVersion": decision_result["decisionVersion"],
            "overrideApplied": decision_result["overrideApplied"],
            "overrideReason": decision_result["overrideReason"],
            "overrideType": decision_result["overrideType"],
            "decisionSource": source,
        }

        await producer.send_and_wait(
            topic,
            key=str(transaction["customerId"]).encode("utf-8"),
            value=payload,
            headers=[
                _header("content-type", "application/json"),
                _header("service-source", settings.service_name),
                _header("x-correlation-id", correlation_id),
                _header("x-decision", decision_result["decision"]),
                _header("x-decision-source", source),
            ],
        )

        logger.info(
            "Published transaction decision event",
            extra={"transactionId": transaction["id"], "topic": topic, "decision": decision_result["decision"]},
        )
