from __future__ import annotations

from datetime import datetime

from services.detect_fraud.config import settings
from services.detect_fraud.velocity_store import VelocityStore


class FraudRulesEngine:
    def __init__(self, velocity_store: VelocityStore) -> None:
        self._velocity_store = velocity_store

    async def evaluate(self, transaction: dict[str, object]) -> dict[str, object]:
        risk_factors: dict[str, object] = {}
        reasons: list[str] = []
        total_rule_score = 0.0
        flagged = False

        velocity_result = await self._check_velocity(transaction)
        geography_result = self._check_geography(transaction)
        amount_result = self._check_amount(transaction)
        card_result = self._check_card(transaction)
        time_result = self._check_time(transaction)

        for name, result in (
            ("velocity", velocity_result),
            ("geography", geography_result),
            ("amount", amount_result),
            ("card", card_result),
            ("time", time_result),
        ):
            if result["flagged"]:
                flagged = True
                reasons.extend(result["reasons"])
            if result["factors"]:
                risk_factors[name] = result["factors"]
            total_rule_score += float(result["score"])

        return {
            "flagged": flagged,
            "ruleScore": min(100, round(total_rule_score)),
            "reasons": reasons,
            "riskFactors": risk_factors,
        }

    @staticmethod
    def _transaction_metadata(transaction: dict[str, object]) -> dict[str, object]:
        metadata = transaction.get("metadata")
        return metadata if isinstance(metadata, dict) else {}

    async def _check_velocity(self, transaction: dict[str, object]) -> dict[str, object]:
        metadata = self._transaction_metadata(transaction)
        velocity = await self._velocity_store.record(
            str(transaction["customerId"]),
            float(transaction["amount"]),
            recipient_customer_id=str(metadata.get("recipientCustomerId") or "").strip() or None,
            recipient_name=str(metadata.get("recipientName") or "").strip() or None,
            merchant_id=str(transaction.get("merchantId") or "").strip() or None,
        )

        reasons: list[str] = []
        flagged = False
        score = 0.0

        customer_hour_count = int(velocity.get("customerTransactionsLastHour", 0))
        customer_hour_amount = float(velocity.get("customerAmountLastHour", 0))
        customer_day_count = int(velocity.get("customerTransactionsLastDay", 0))

        if customer_hour_count > settings.max_txn_per_hour:
            flagged = True
            score += settings.scoring_velocity_count_hour
            overage = (customer_hour_count - settings.max_txn_per_hour) / settings.max_txn_per_hour
            score += min(settings.scoring_velocity_count_hour * overage, settings.scoring_velocity_count_hour)
            reasons.append(
                f"Exceeded hourly transaction count ({customer_hour_count}/{settings.max_txn_per_hour})"
            )

        if customer_hour_amount > settings.max_amount_per_hour:
            flagged = True
            score += settings.scoring_velocity_amount_hour
            reasons.append(
                f"Exceeded hourly spend limit (${customer_hour_amount:.2f}/${settings.max_amount_per_hour:g})"
            )

        if customer_day_count > settings.max_txn_per_day:
            flagged = True
            score += settings.scoring_velocity_count_day
            reasons.append(
                f"Exceeded daily transaction count ({customer_day_count}/{settings.max_txn_per_day})"
            )

        factors = {
            "customerTransactionsLastHour": customer_hour_count,
            "customerAmountLastHour": customer_hour_amount,
            "customerTransactionsLastDay": customer_day_count,
            "countLastHour": velocity.get("countLastHour", customer_hour_count),
            "amountLastHour": velocity.get("amountLastHour", customer_hour_amount),
            "distinctRecipientsLastHour": velocity.get("distinctRecipientsLastHour", 0),
            "distinctMerchantsLastHour": velocity.get("distinctMerchantsLastHour", 0),
            "recipientSeenBefore": velocity.get("recipientSeenBefore", False),
            "merchantSeenBefore": velocity.get("merchantSeenBefore", False),
            "merchantCountLastHour": velocity.get("merchantCountLastHour", 0),
            "merchantAmountLastHour": velocity.get("merchantAmountLastHour", 0),
        }

        return {
            "flagged": flagged,
            "score": score,
            "reasons": reasons,
            "factors": factors,
        }

    def _check_geography(self, transaction: dict[str, object]) -> dict[str, object]:
        location = transaction.get("location") or {}
        country = str(location.get("country") or "").upper()
        reasons: list[str] = []
        flagged = False
        score = 0.0
        factors = {"country": country} if country else {}

        if country and country in settings.high_risk_countries:
            flagged = True
            score += settings.scoring_high_risk_country
            reasons.append(f"Transaction originates from high-risk country: {country}")
            factors["highRiskCountry"] = True
        elif country:
            factors["highRiskCountry"] = False

        return {
            "flagged": flagged,
            "score": score,
            "reasons": reasons,
            "factors": factors,
        }

    def _check_amount(self, transaction: dict[str, object]) -> dict[str, object]:
        amount = float(transaction["amount"])
        currency = str(transaction.get("currency") or "")
        reasons: list[str] = []
        flagged = False
        score = 0.0
        factors: dict[str, object] = {
            "amount": amount,
            "currency": currency,
        }

        if amount >= settings.suspicious_amount_threshold:
            flagged = True
            score += settings.scoring_suspicious_amount
            reasons.append(
                f"Amount ${amount:g} exceeds suspicious threshold (${settings.suspicious_amount_threshold:g})"
            )
            factors["suspicious"] = True
        elif amount >= settings.high_amount_threshold:
            score += settings.scoring_high_amount
            factors["highAmount"] = True

        if amount >= 100 and abs(amount - round(amount)) < 1e-9:
            score += settings.scoring_round_amount
            factors["roundAmount"] = True

        return {
            "flagged": flagged,
            "score": score,
            "reasons": reasons,
            "factors": factors,
        }

    def _check_card(self, transaction: dict[str, object]) -> dict[str, object]:
        metadata = self._transaction_metadata(transaction)
        card_bin = str(metadata.get("cardBin") or metadata.get("card_bin") or "").strip()
        card_last_four = str(
            metadata.get("cardLastFour") or metadata.get("card_last_four") or ""
        ).strip()
        card_type = str(transaction.get("cardType") or transaction.get("card_type") or "").strip()

        reasons: list[str] = []
        flagged = False
        score = 0.0
        factors: dict[str, object] = {
            "cardLastFour": card_last_four or None,
            "cardType": card_type or None,
        }

        if settings.bin_blacklist:
            factors["binCheckApplied"] = True
            if card_bin and card_bin in settings.bin_blacklist:
                flagged = True
                score += settings.scoring_bin_blacklist
                reasons.append(f"Card BIN {card_bin} is on the blacklist")
                factors["binBlacklisted"] = True

        return {
            "flagged": flagged,
            "score": score,
            "reasons": reasons,
            "factors": factors,
        }

    def _check_time(self, transaction: dict[str, object]) -> dict[str, object]:
        created_at = str(transaction.get("createdAt") or "")
        hour = 0
        if created_at:
            hour = datetime.fromisoformat(created_at.replace("Z", "+00:00")).hour

        factors: dict[str, object] = {"transactionHourUTC": hour}
        reasons: list[str] = []
        score = 0.0

        if 2 <= hour < 5:
            score += settings.scoring_unusual_time
            factors["unusualTime"] = True

        return {
            "flagged": False,
            "score": score,
            "reasons": reasons,
            "factors": factors,
        }
