from __future__ import annotations

from datetime import datetime

from services.detect_fraud.config import settings
from services.detect_fraud.velocity_store import VelocityStore


class FraudRulesEngine:
    def __init__(self, velocity_store: VelocityStore) -> None:
        self._velocity_store = velocity_store

    async def evaluate(self, transaction: dict[str, object]) -> dict[str, object]:
        reasons: list[str] = []
        risk_factors: dict[str, object] = {}
        flagged = False
        rule_score = 0

        amount = float(transaction["amount"])
        velocity = await self._velocity_store.record(str(transaction["customerId"]), amount)
        risk_factors["velocity"] = velocity
        if velocity["countLastHour"] > settings.max_txn_per_hour:
            flagged = True
            rule_score += 20
            reasons.append(
                f"velocity count exceeded ({int(velocity['countLastHour'])}/{settings.max_txn_per_hour})"
            )
        if velocity["amountLastHour"] > settings.max_amount_per_hour:
            flagged = True
            rule_score += 20
            reasons.append(
                f"velocity amount exceeded ({int(velocity['amountLastHour'])}/{int(settings.max_amount_per_hour)})"
            )

        country = str((transaction.get("location") or {}).get("country", "")).upper()
        high_risk_country = country in settings.high_risk_countries
        risk_factors["geography"] = {
            "country": country,
            "highRiskCountry": high_risk_country,
        }
        if high_risk_country:
            flagged = True
            rule_score += 25
            reasons.append(f"high-risk geography ({country})")

        if amount >= settings.suspicious_amount_threshold:
            flagged = True
            rule_score += 35
            reasons.append(f"suspicious amount ({amount:g})")
        elif amount >= settings.high_amount_threshold:
            rule_score += 15
            reasons.append(f"high amount ({amount:g})")

        hour_utc = datetime.fromisoformat(str(transaction["createdAt"]).replace("Z", "+00:00")).hour
        risk_factors["time"] = {"hourUtc": hour_utc}
        if hour_utc <= 5 or hour_utc >= 23:
            rule_score += 5
            reasons.append("unusual transaction time")

        if abs(amount - round(amount)) < 1e-9:
            rule_score += 5
            reasons.append("round amount pattern")

        return {
            "flagged": flagged,
            "ruleScore": min(100, round(rule_score)),
            "reasons": reasons,
            "riskFactors": risk_factors,
        }
