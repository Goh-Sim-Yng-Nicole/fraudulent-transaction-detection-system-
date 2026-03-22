from __future__ import annotations

from datetime import datetime, timezone

from services.detect_fraud.config import settings
from services.detect_fraud.ml_scoring_client import MlScoringClient
from services.detect_fraud.rules_engine import FraudRulesEngine


class FraudDetectionService:
    def __init__(self, rules_engine: FraudRulesEngine, ml_scoring_client: MlScoringClient) -> None:
        self._rules_engine = rules_engine
        self._ml_scoring_client = ml_scoring_client

    async def analyze_transaction(self, transaction: dict[str, object]) -> dict[str, object]:
        rule_results = await self._rules_engine.evaluate(transaction)
        ml_results = await self._ml_scoring_client.score(transaction, rule_results)

        risk_score = round(
            float(rule_results["ruleScore"]) * settings.rules_weight
            + float(ml_results["score"]) * settings.ml_weight
        )

        flagged = bool(rule_results["flagged"]) or float(ml_results["score"]) >= settings.ml_flag_threshold
        reasons = list(rule_results["reasons"])
        if float(ml_results["score"]) >= settings.ml_flag_threshold:
            reasons.append(f"ml score exceeded threshold ({int(ml_results['score'])}/{int(settings.ml_flag_threshold)})")

        return {
            "transactionId": transaction["id"],
            "customerId": transaction["customerId"],
            "merchantId": transaction["merchantId"],
            "amount": transaction["amount"],
            "currency": transaction["currency"],
            "riskScore": risk_score,
            "flagged": flagged,
            "reasons": reasons,
            "ruleResults": rule_results,
            "mlResults": ml_results,
            "analyzedAt": datetime.now(timezone.utc).isoformat(),
            "analysisVersion": "2.0.0",
        }
