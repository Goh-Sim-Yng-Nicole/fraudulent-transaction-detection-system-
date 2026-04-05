from __future__ import annotations

from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

import httpx

from services.detect_fraud.src.config.settings import decision_mode_uses_local_decisioning, settings
from services.detect_fraud.src.controllers.decision_publisher import DecisionPublisher
from services.detect_fraud.src.controllers.ml_scoring_client import MlScoringClient
from services.detect_fraud.src.controllers.rules_engine import FraudRulesEngine
from services.detect_fraud.src.utils.velocity_store import VelocityStore


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

    async def test_flags_high_risk_country_and_unusual_time_activity(self) -> None:
        settings.max_txn_per_hour = 99
        settings.max_amount_per_hour = 1_000_000
        settings.max_txn_per_day = 99
        settings.high_risk_countries = ["NG"]
        settings.high_amount_threshold = 5_000
        settings.suspicious_amount_threshold = 9_999_999

        engine = FraudRulesEngine(VelocityStore())
        result = await engine.evaluate(
            {
                "id": "txn-risk-country",
                "customerId": "customer-1",
                "merchantId": "FTDS_TRANSFER",
                "amount": 7800,
                "currency": "SGD",
                "cardType": "DEBIT",
                "createdAt": "2026-03-22T03:15:00+00:00",
                "location": {"country": "NG"},
                "metadata": {},
            }
        )

        self.assertTrue(result["flagged"])
        self.assertIn("Transaction originates from high-risk country: NG", result["reasons"])
        self.assertEqual(result["riskFactors"]["geography"]["highRiskCountry"], True)
        self.assertEqual(result["riskFactors"]["amount"]["highAmount"], True)
        self.assertEqual(result["riskFactors"]["time"]["unusualTime"], True)

    async def test_flags_daily_velocity_and_bin_blacklist(self) -> None:
        settings.max_txn_per_hour = 99
        settings.max_amount_per_hour = 1_000_000
        settings.max_txn_per_day = 2
        settings.high_risk_countries = []
        settings.high_amount_threshold = 9_999_999
        settings.suspicious_amount_threshold = 9_999_999
        settings.bin_blacklist = ["411111"]

        engine = FraudRulesEngine(VelocityStore())
        await engine.evaluate(
            {
                "id": "txn-velocity-1",
                "customerId": "customer-2",
                "merchantId": "FTDS_CARD_TEST",
                "amount": 100,
                "currency": "USD",
                "cardType": "PREPAID",
                "createdAt": "2026-03-22T12:00:00+00:00",
                "location": {"country": "SG"},
                "metadata": {"cardBin": "411111"},
            }
        )
        await engine.evaluate(
            {
                "id": "txn-velocity-2",
                "customerId": "customer-2",
                "merchantId": "FTDS_CARD_TEST",
                "amount": 150,
                "currency": "USD",
                "cardType": "PREPAID",
                "createdAt": "2026-03-22T13:00:00+00:00",
                "location": {"country": "SG"},
                "metadata": {"cardBin": "411111"},
            }
        )
        result = await engine.evaluate(
            {
                "id": "txn-velocity-3",
                "customerId": "customer-2",
                "merchantId": "FTDS_CARD_TEST",
                "amount": 200,
                "currency": "USD",
                "cardType": "PREPAID",
                "createdAt": "2026-03-22T14:00:00+00:00",
                "location": {"country": "SG"},
                "metadata": {"cardBin": "411111"},
            }
        )

        self.assertTrue(result["flagged"])
        self.assertIn("Exceeded daily transaction count (3/2)", result["reasons"])
        self.assertIn("Card BIN 411111 is on the blacklist", result["reasons"])
        self.assertEqual(result["riskFactors"]["velocity"]["customerTransactionsLastDay"], 3)
        self.assertEqual(result["riskFactors"]["card"]["binBlacklisted"], True)


class DetectFraudIntegrationModeTests(IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self._settings_snapshot = settings.__dict__.copy()

    def tearDown(self) -> None:
        settings.__dict__.clear()
        settings.__dict__.update(self._settings_snapshot)

    async def test_outsystems_kafka_mode_defers_local_decision_publication(self) -> None:
        settings.decision_integration_mode = "outsystems_kafka"
        self.assertFalse(decision_mode_uses_local_decisioning(settings.decision_integration_mode))

    async def test_local_and_http_modes_publish_local_decisions(self) -> None:
        settings.decision_integration_mode = "local"
        self.assertTrue(decision_mode_uses_local_decisioning(settings.decision_integration_mode))

        settings.decision_integration_mode = "outsystems_http"
        self.assertTrue(decision_mode_uses_local_decisioning(settings.decision_integration_mode))


class MlScoringClientTests(IsolatedAsyncioTestCase):
    async def test_uses_slimmed_modern_payload_for_new_rule_factor_shape(self) -> None:
        http_client = AsyncMock()
        http_client.post.return_value = SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {
                "success": True,
                "data": {
                    "score": 61,
                    "confidence": 0.88,
                    "modelVersion": "model-v1",
                    "features": {"f_geo_high_risk": 1},
                },
            },
        )
        client = MlScoringClient(http_client)

        result = await client.score(
            transaction={
                "id": "txn-modern",
                "customerId": "customer-1",
                "merchantId": "merchant-1",
                "amount": 3200,
                "currency": "USD",
                "cardType": "PREPAID",
                "location": {"country": "NG"},
                "createdAt": "2026-04-03T14:00:00+00:00",
                "metadata": {},
            },
            rule_results={
                "flagged": True,
                "reasons": ["risk detected"],
                "riskFactors": {
                    "velocity": {
                        "countLastHour": 2,
                        "customerTransactionsLastHour": 2,
                    },
                    "geography": {"highRiskCountry": True},
                    "time": {"transactionHourUTC": 14},
                    "amount": {"highAmount": True},
                },
            },
        )

        self.assertEqual(result["score"], 61)
        modern_payload = http_client.post.await_args.kwargs["json"]
        self.assertEqual(modern_payload["ruleResults"]["riskFactors"]["velocity"]["countLastHour"], 2)
        self.assertEqual(modern_payload["ruleResults"]["riskFactors"]["geography"]["highRiskCountry"], True)
        self.assertNotIn("time", modern_payload["ruleResults"]["riskFactors"])

    async def test_legacy_fallback_accepts_transaction_hour_utc_shape(self) -> None:
        http_client = AsyncMock()
        http_client.post.side_effect = [
            httpx.HTTPStatusError(
                "bad modern request",
                request=SimpleNamespace(),
                response=SimpleNamespace(status_code=400),
            ),
            SimpleNamespace(
                raise_for_status=lambda: None,
                json=lambda: {
                    "rules_score": 73,
                    "model_version": "legacy-model",
                    "confidence": 0.77,
                },
            ),
        ]
        client = MlScoringClient(http_client)

        result = await client.score(
            transaction={
                "id": "txn-legacy",
                "customerId": "customer-2",
                "merchantId": "merchant-2",
                "amount": 3300,
                "currency": "USD",
                "cardType": "PREPAID",
                "location": {"country": "NG"},
                "createdAt": "2026-04-03T03:15:00+00:00",
                "metadata": {},
            },
            rule_results={
                "flagged": True,
                "reasons": ["high-risk country"],
                "riskFactors": {
                    "velocity": {"customerTransactionsLastHour": 4},
                    "geography": {"highRiskCountry": True},
                    "time": {"transactionHourUTC": 3},
                },
            },
        )

        self.assertEqual(result["score"], 73)
        legacy_payload = http_client.post.await_args_list[1].kwargs["json"]
        self.assertEqual(legacy_payload["hour_utc"], 3)
        self.assertEqual(legacy_payload["velocity_txn_hour_raw"], 4)
        self.assertEqual(legacy_payload["geo_country_high_risk"], True)
