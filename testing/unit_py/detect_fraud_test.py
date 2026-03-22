from __future__ import annotations

from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from services.detect_fraud.config import settings
from services.detect_fraud.decision_publisher import DecisionPublisher
from services.detect_fraud.rules_engine import FraudRulesEngine
from services.detect_fraud.velocity_store import VelocityStore


class DecisionPublisherTests(IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self._settings_snapshot = settings.__dict__.copy()

    def tearDown(self) -> None:
        settings.__dict__.clear()
        settings.__dict__.update(self._settings_snapshot)

    async def test_auto_approves_whitelisted_customers(self) -> None:
        settings.outsystems_decision_url = None
        settings.local_decision_fallback_enabled = True
        settings.auto_approve_whitelist = ["vip-customer"]
        settings.auto_decline_blacklist = []
        settings.require_manual_review_countries = []

        producer = SimpleNamespace(send_and_wait=AsyncMock())
        publisher = DecisionPublisher(SimpleNamespace())

        await publisher.process(
            producer=producer,
            transaction={
                "id": "txn-whitelist-1",
                "customerId": "vip-customer",
                "merchantId": "merchant-1",
                "amount": 8500,
                "location": {"country": "SG"},
            },
            fraud_analysis={
                "customerId": "vip-customer",
                "riskScore": 92,
                "ruleResults": {"flagged": False},
                "mlResults": {"confidence": 0.99},
            },
            correlation_id="corr-whitelist-1",
        )

        producer.send_and_wait.assert_awaited_once()
        self.assertEqual(producer.send_and_wait.await_args.args[0], settings.kafka_finalised_topic)

        payload = producer.send_and_wait.await_args.kwargs["value"]
        self.assertEqual(payload["decision"], "APPROVED")
        self.assertEqual(payload["decisionSource"], "local-default")
        self.assertTrue(payload["overrideApplied"])
        self.assertEqual(payload["overrideType"], "WHITELIST")
        self.assertEqual(payload["data"]["outcome"], "APPROVED")

    async def test_flags_borderline_transactions_when_low_confidence_adds_risk(self) -> None:
        settings.outsystems_decision_url = None
        settings.local_decision_fallback_enabled = True
        settings.auto_approve_whitelist = []
        settings.auto_decline_blacklist = []
        settings.require_manual_review_countries = []

        producer = SimpleNamespace(send_and_wait=AsyncMock())
        publisher = DecisionPublisher(SimpleNamespace())

        await publisher.process(
            producer=producer,
            transaction={
                "id": "txn-confidence-1",
                "customerId": "customer-123",
                "merchantId": "merchant-2",
                "amount": 120,
                "location": {"country": "SG"},
            },
            fraud_analysis={
                "customerId": "customer-123",
                "riskScore": 45,
                "ruleResults": {"flagged": False},
                "mlResults": {"confidence": 0.5},
            },
            correlation_id="corr-confidence-1",
        )

        producer.send_and_wait.assert_awaited_once()
        self.assertEqual(producer.send_and_wait.await_args.args[0], settings.kafka_flagged_topic)

        payload = producer.send_and_wait.await_args.kwargs["value"]
        self.assertEqual(payload["decision"], "FLAGGED")
        self.assertEqual(payload["decisionFactors"]["confidenceAdjustment"]["adjustment"], 10)
        self.assertEqual(payload["decisionFactors"]["adjustedScore"], 55)

    async def test_fails_closed_when_external_handoff_fails_and_fallback_is_disabled(self) -> None:
        settings.outsystems_decision_url = "http://outsystems.example.local/decision"
        settings.local_decision_fallback_enabled = False

        producer = SimpleNamespace(send_and_wait=AsyncMock())
        publisher = DecisionPublisher(SimpleNamespace())

        with patch.object(publisher, "_send_to_outsystems", AsyncMock(return_value=False)):
            with self.assertRaisesRegex(
                RuntimeError,
                "Decision handoff failed for transaction txn-no-fallback-1",
            ):
                await publisher.process(
                    producer=producer,
                    transaction={
                        "id": "txn-no-fallback-1",
                        "customerId": "customer-456",
                        "merchantId": "merchant-3",
                        "amount": 250,
                        "location": {"country": "SG"},
                    },
                    fraud_analysis={
                        "customerId": "customer-456",
                        "riskScore": 61,
                        "ruleResults": {"flagged": False},
                        "mlResults": {"confidence": 0.91},
                    },
                    correlation_id="corr-no-fallback-1",
                )

        producer.send_and_wait.assert_not_awaited()

    async def test_sends_bearer_auth_when_calling_outsystems(self) -> None:
        settings.outsystems_decision_url = "https://outsystems.example.com/decision"
        settings.outsystems_auth_type = "bearer"
        settings.outsystems_bearer_token = "test-token"
        settings.local_decision_fallback_enabled = False

        http_client = AsyncMock()
        http_client.post.return_value = SimpleNamespace(
            status_code=200,
            json=lambda: {
                "decision": "APPROVED",
                "decisionReason": "Approved by OutSystems",
                "decisionFactors": {"source": "OUTSYSTEMS"},
                "decisionVersion": "outsystems-live",
            },
        )
        producer = SimpleNamespace(send_and_wait=AsyncMock())
        publisher = DecisionPublisher(http_client)

        await publisher.process(
            producer=producer,
            transaction={
                "id": "txn-outs-auth-1",
                "customerId": "customer-789",
                "merchantId": "merchant-live-1",
                "amount": 125,
                "location": {"country": "SG"},
            },
            fraud_analysis={
                "customerId": "customer-789",
                "riskScore": 33,
                "ruleResults": {"flagged": False},
                "mlResults": {"confidence": 0.97},
            },
            correlation_id="corr-outs-auth-1",
        )

        http_client.post.assert_awaited_once()
        self.assertEqual(
            http_client.post.await_args.kwargs["headers"]["Authorization"],
            "Bearer test-token",
        )
        producer.send_and_wait.assert_awaited_once()
        self.assertEqual(producer.send_and_wait.await_args.args[0], settings.kafka_finalised_topic)


class FraudRulesEngineTests(IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self._settings_snapshot = settings.__dict__.copy()

    def tearDown(self) -> None:
        settings.__dict__.clear()
        settings.__dict__.update(self._settings_snapshot)

    async def test_flags_high_value_first_time_recipient_activity(self) -> None:
        settings.max_txn_per_hour = 99
        settings.max_amount_per_hour = 1_000_000
        settings.max_distinct_recipients_per_hour = 99
        settings.max_distinct_merchants_per_hour = 99
        settings.high_risk_countries = []
        settings.high_risk_merchant_ids = []
        settings.high_risk_merchant_prefixes = []
        settings.high_amount_threshold = 9_999_999
        settings.suspicious_amount_threshold = 9_999_999
        settings.prepaid_high_amount_threshold = 9_999_999
        settings.first_time_recipient_review_amount = 1_000

        engine = FraudRulesEngine(VelocityStore())
        result = await engine.evaluate(
            {
                "id": "txn-new-recipient",
                "customerId": "customer-1",
                "merchantId": "FTDS_TRANSFER",
                "amount": 2200,
                "currency": "SGD",
                "cardType": "DEBIT",
                "createdAt": "2026-03-22T14:30:00+00:00",
                "location": {"country": "SG"},
                "metadata": {
                    "recipientCustomerId": "recipient-1",
                    "recipientName": "Demo Recipient",
                },
            }
        )

        self.assertTrue(result["flagged"])
        self.assertIn(
            "high-value payment to a recipient not seen in recent activity (recipient-1)",
            result["reasons"],
        )
        self.assertEqual(result["riskFactors"]["velocity"]["recipientSeenBefore"], False)

    async def test_flags_high_risk_merchant_and_prepaid_combo(self) -> None:
        settings.max_txn_per_hour = 99
        settings.max_amount_per_hour = 1_000_000
        settings.max_distinct_recipients_per_hour = 99
        settings.max_distinct_merchants_per_hour = 99
        settings.high_risk_countries = []
        settings.high_risk_merchant_ids = []
        settings.high_risk_merchant_prefixes = ["CRYPTO_"]
        settings.high_risk_merchant_review_amount = 300
        settings.high_amount_threshold = 9_999_999
        settings.suspicious_amount_threshold = 9_999_999
        settings.prepaid_high_amount_threshold = 2_000
        settings.first_time_recipient_review_amount = 9_999_999

        engine = FraudRulesEngine(VelocityStore())
        result = await engine.evaluate(
            {
                "id": "txn-risky-merchant",
                "customerId": "customer-2",
                "merchantId": "CRYPTO_EXCHANGE_01",
                "amount": 3200,
                "currency": "USD",
                "cardType": "PREPAID",
                "createdAt": "2026-03-22T14:30:00+00:00",
                "location": {"country": "SG"},
                "metadata": {},
            }
        )

        self.assertTrue(result["flagged"])
        self.assertIn("high-risk merchant pattern detected (CRYPTO_EXCHANGE_01)", result["reasons"])
        self.assertIn(
            "high-value prepaid transaction (3200 >= 2000)",
            result["reasons"],
        )
        self.assertEqual(result["riskFactors"]["merchant"]["highRiskMerchant"], True)
        self.assertEqual(result["riskFactors"]["card"]["prepaidHighAmount"], True)
