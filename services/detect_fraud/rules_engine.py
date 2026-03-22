from __future__ import annotations

from datetime import datetime

from services.detect_fraud.config import settings
from services.detect_fraud.velocity_store import VelocityStore


class FraudRulesEngine:
    def __init__(self, velocity_store: VelocityStore) -> None:
        self._velocity_store = velocity_store

    @staticmethod
    def _transaction_metadata(transaction: dict[str, object]) -> dict[str, object]:
        metadata = transaction.get("metadata")
        return metadata if isinstance(metadata, dict) else {}

    @staticmethod
    def _merchant_is_high_risk(merchant_id: str) -> bool:
        normalized = merchant_id.strip().upper()
        if not normalized:
            return False
        if normalized in settings.high_risk_merchant_ids:
            return True
        return any(normalized.startswith(prefix) for prefix in settings.high_risk_merchant_prefixes)

    async def evaluate(self, transaction: dict[str, object]) -> dict[str, object]:
        reasons: list[str] = []
        risk_factors: dict[str, object] = {}
        flagged = False
        rule_score = 0

        amount = float(transaction["amount"])
        metadata = self._transaction_metadata(transaction)
        recipient_customer_id = str(metadata.get("recipientCustomerId") or "").strip() or None
        recipient_name = str(metadata.get("recipientName") or "").strip() or None
        merchant_id = str(transaction.get("merchantId") or "").strip()
        card_type = str(transaction.get("cardType") or "").upper()

        velocity = await self._velocity_store.record(
            str(transaction["customerId"]),
            amount,
            recipient_customer_id=recipient_customer_id,
            recipient_name=recipient_name,
            merchant_id=merchant_id or None,
        )
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
        if velocity["distinctRecipientsLastHour"] > settings.max_distinct_recipients_per_hour:
            flagged = True
            rule_score += 18
            reasons.append(
                "recipient burst exceeded"
                f" ({int(velocity['distinctRecipientsLastHour'])}/{settings.max_distinct_recipients_per_hour})"
            )
        if velocity["distinctMerchantsLastHour"] > settings.max_distinct_merchants_per_hour:
            flagged = True
            rule_score += 12
            reasons.append(
                "merchant switching exceeded"
                f" ({int(velocity['distinctMerchantsLastHour'])}/{settings.max_distinct_merchants_per_hour})"
            )

        recipient_reference = recipient_customer_id or recipient_name
        if (
            recipient_reference
            and not velocity["recipientSeenBefore"]
            and amount >= settings.first_time_recipient_review_amount
        ):
            flagged = True
            rule_score += 18
            reasons.append(
                "high-value payment to a recipient not seen in recent activity"
                f" ({recipient_reference})"
            )

        merchant_high_risk = self._merchant_is_high_risk(merchant_id)
        risk_factors["merchant"] = {
            "merchantId": merchant_id,
            "highRiskMerchant": merchant_high_risk,
            "merchantCountLastHour": velocity["merchantCountLastHour"],
            "merchantAmountLastHour": velocity["merchantAmountLastHour"],
        }
        if merchant_high_risk and amount >= settings.high_risk_merchant_review_amount:
            flagged = True
            rule_score += 20
            reasons.append(f"high-risk merchant pattern detected ({merchant_id})")

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

        risk_factors["card"] = {
            "cardType": card_type,
            "prepaidHighAmount": card_type == "PREPAID" and amount >= settings.prepaid_high_amount_threshold,
        }
        if card_type == "PREPAID" and amount >= settings.prepaid_high_amount_threshold:
            flagged = True
            rule_score += 15
            reasons.append(
                f"high-value prepaid transaction ({amount:g} >= {settings.prepaid_high_amount_threshold:g})"
            )

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
