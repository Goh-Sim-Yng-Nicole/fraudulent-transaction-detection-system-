from __future__ import annotations

import importlib
import sys
from datetime import datetime, timezone
from types import ModuleType, SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch


def _async_noop(*_args, **_kwargs):
    async def _inner():
        return None

    return _inner()


def _install_transaction_import_stubs() -> None:
    if "aiokafka" not in sys.modules:
        aiokafka_module = ModuleType("aiokafka")

        class DummyConsumer: ...

        class DummyProducer: ...

        aiokafka_module.AIOKafkaConsumer = DummyConsumer
        aiokafka_module.AIOKafkaProducer = DummyProducer
        sys.modules["aiokafka"] = aiokafka_module

    if "aiokafka.coordinator" not in sys.modules:
        sys.modules["aiokafka.coordinator"] = ModuleType("aiokafka.coordinator")
    if "aiokafka.coordinator.assignors" not in sys.modules:
        sys.modules["aiokafka.coordinator.assignors"] = ModuleType("aiokafka.coordinator.assignors")
    if "aiokafka.coordinator.assignors.roundrobin" not in sys.modules:
        roundrobin_module = ModuleType("aiokafka.coordinator.assignors.roundrobin")

        class RoundRobinPartitionAssignor: ...

        roundrobin_module.RoundRobinPartitionAssignor = RoundRobinPartitionAssignor
        sys.modules["aiokafka.coordinator.assignors.roundrobin"] = roundrobin_module

    if "services.transaction.db" not in sys.modules:
        db_module = ModuleType("services.transaction.db")
        db_module.create_engine = lambda *_args, **_kwargs: None
        db_module.create_sessionmaker = lambda *_args, **_kwargs: None
        db_module.init_db = _async_noop
        db_module.should_auto_create_tables = lambda: False
        db_module.wait_for_db = _async_noop
        sys.modules["services.transaction.db"] = db_module

    if "services.transaction.observability" not in sys.modules:
        observability_module = ModuleType("services.transaction.observability")
        observability_module.instrument_fastapi = lambda *_args, **_kwargs: None
        observability_module.instrument_sqlalchemy = lambda *_args, **_kwargs: None
        observability_module.shutdown_tracing = lambda: None
        sys.modules["services.transaction.observability"] = observability_module

    if "services.transaction.store" not in sys.modules:
        store_module = ModuleType("services.transaction.store")

        class TransactionStore: ...

        store_module.TransactionStore = TransactionStore
        sys.modules["services.transaction.store"] = store_module


_install_transaction_import_stubs()
transaction_app_module = importlib.import_module("services.transaction.app")


def make_record(**overrides):
    base = {
        "transaction_id": "txn-base-1",
        "customer_id": "customer-1",
        "merchant_id": "merchant-1",
        "amount": 44.25,
        "currency": "SGD",
        "card_type": "DEBIT",
        "country": "SG",
        "sender_name": "Alice",
        "recipient_customer_id": "customer-2",
        "recipient_name": "Bob",
        "hour_utc": 12,
        "status": "PENDING",
        "fraud_score": None,
        "outcome_reason": None,
        "created_at": datetime(2026, 3, 22, 1, 0, tzinfo=timezone.utc),
        "updated_at": datetime(2026, 3, 22, 1, 0, tzinfo=timezone.utc),
        "direction": None,
        "outbound_event_published_at": None,
        "outbound_event_publish_attempts": 0,
        "outbound_event_last_error": None,
        "correlation_id": "corr-existing-1",
        "request_id": "req-existing-1",
    }
    base.update(overrides)
    return base


class TransactionCreateTests(IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self._original_store = transaction_app_module.state.store

    def tearDown(self) -> None:
        transaction_app_module.state.store = self._original_store

    async def test_republishes_unpublished_idempotent_transaction_before_returning_it(self) -> None:
        existing = make_record(transaction_id="txn-replay-1")
        updated = make_record(
            transaction_id="txn-replay-1",
            outbound_event_published_at=datetime(2026, 3, 22, 1, 1, tzinfo=timezone.utc),
            updated_at=datetime(2026, 3, 22, 1, 1, tzinfo=timezone.utc),
        )
        fake_store = SimpleNamespace(
            find_by_idempotency_key=AsyncMock(return_value=existing),
            mark_outbound_event_published=AsyncMock(return_value=updated),
            mark_outbound_event_failed=AsyncMock(),
            find_by_id=AsyncMock(),
            create=AsyncMock(),
        )
        transaction_app_module.state.store = fake_store

        payload = transaction_app_module.TransactionCreateRequest(
            customer_id="customer-1",
            amount=44.25,
            currency="SGD",
            card_type="DEBIT",
            country="SG",
            merchant_id="merchant-1",
            sender_name="Alice",
            recipient_customer_id="customer-2",
            recipient_name="Bob",
            hour_utc=12,
        )
        request = SimpleNamespace(
            state=SimpleNamespace(
                idempotency_key="idem-1",
                correlation_id="corr-request-1",
                request_id="req-1",
            )
        )

        with patch.object(transaction_app_module, "_publish_transaction_created", AsyncMock()) as publish:
            result = await transaction_app_module.create_transaction(payload, request)

        publish.assert_awaited_once_with(existing, "corr-existing-1")
        fake_store.mark_outbound_event_published.assert_awaited_once_with("txn-replay-1")
        fake_store.mark_outbound_event_failed.assert_not_awaited()
        self.assertEqual(result["transaction_id"], "txn-replay-1")
        self.assertEqual(result["outbound_event_published_at"], datetime(2026, 3, 22, 1, 1, tzinfo=timezone.utc))

    async def test_marks_outbound_publish_failure_for_new_transactions(self) -> None:
        created = make_record(
            transaction_id="txn-create-1",
            customer_id="customer-3",
            merchant_id="FTDS_TRANSFER",
            amount=120.0,
            card_type="CREDIT",
            sender_name="Chris",
            recipient_customer_id="customer-4",
            recipient_name="Dana",
            hour_utc=3,
            created_at=datetime(2026, 3, 22, 2, 0, tzinfo=timezone.utc),
            updated_at=datetime(2026, 3, 22, 2, 0, tzinfo=timezone.utc),
        )
        fake_store = SimpleNamespace(
            find_by_idempotency_key=AsyncMock(return_value=None),
            create=AsyncMock(return_value=created),
            mark_outbound_event_failed=AsyncMock(),
            mark_outbound_event_published=AsyncMock(),
            find_by_id=AsyncMock(),
        )
        transaction_app_module.state.store = fake_store

        payload = transaction_app_module.TransactionCreateRequest(
            customer_id="customer-3",
            amount=120,
            country="SG",
            sender_name="Chris",
            recipient_customer_id="customer-4",
            recipient_name="Dana",
        )
        request = SimpleNamespace(
            state=SimpleNamespace(
                idempotency_key=None,
                correlation_id="corr-create-1",
                request_id="req-create-1",
            )
        )

        with patch.object(
            transaction_app_module,
            "_publish_transaction_created",
            AsyncMock(side_effect=RuntimeError("kafka unavailable")),
        ):
            with self.assertRaisesRegex(RuntimeError, "kafka unavailable"):
                await transaction_app_module.create_transaction(payload, request)

        fake_store.mark_outbound_event_failed.assert_awaited_once_with("txn-create-1", "kafka unavailable")
        fake_store.mark_outbound_event_published.assert_not_awaited()

    async def test_returns_canonical_row_for_already_published_idempotent_requests(self) -> None:
        canonical = make_record(
            transaction_id="txn-idempotent-1",
            status="FLAGGED",
            fraud_score=68,
            outbound_event_published_at=datetime(2026, 3, 22, 3, 0, tzinfo=timezone.utc),
            updated_at=datetime(2026, 3, 22, 3, 5, tzinfo=timezone.utc),
        )
        fake_store = SimpleNamespace(
            find_by_idempotency_key=AsyncMock(return_value=canonical),
            find_by_id=AsyncMock(return_value=canonical),
            mark_outbound_event_failed=AsyncMock(),
            mark_outbound_event_published=AsyncMock(),
            create=AsyncMock(),
        )
        transaction_app_module.state.store = fake_store

        payload = transaction_app_module.TransactionCreateRequest(
            customer_id="customer-5",
            amount=88,
            country="SG",
        )
        request = SimpleNamespace(
            state=SimpleNamespace(
                idempotency_key="idem-2",
                correlation_id="corr-idempotent-1",
                request_id="req-idempotent-1",
            )
        )

        with patch.object(transaction_app_module, "_publish_transaction_created", AsyncMock()) as publish:
            result = await transaction_app_module.create_transaction(payload, request)

        publish.assert_not_awaited()
        fake_store.mark_outbound_event_published.assert_not_awaited()
        self.assertEqual(result["transaction_id"], "txn-idempotent-1")
        self.assertEqual(result["status"], "FLAGGED")
        self.assertEqual(result["fraud_score"], 68)
