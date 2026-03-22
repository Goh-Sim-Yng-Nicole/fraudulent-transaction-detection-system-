from __future__ import annotations

from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from services.detect_fraud.config import settings
from services.detect_fraud.decision_publisher import DecisionPublisher


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
