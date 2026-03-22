from __future__ import annotations

import json
import logging
import time
from collections import defaultdict
from typing import Any

from services.detect_fraud.config import settings

try:
    from redis.asyncio import Redis
except ImportError:  # pragma: no cover - dependency is installed in Docker/runtime
    Redis = None

logger = logging.getLogger("detect_fraud.velocity")


class VelocityStore:
    def __init__(self) -> None:
        self._memory_window: dict[str, list[dict[str, object]]] = defaultdict(list)
        self._redis_client: Redis | None = None

    def _prune_memory(self, customer_id: str, now_ms: float) -> list[dict[str, object]]:
        current = self._memory_window.get(customer_id, [])
        one_hour_ago = now_ms - 60 * 60 * 1000
        kept = [entry for entry in current if entry["timestamp"] >= one_hour_ago]
        self._memory_window[customer_id] = kept
        return kept

    @staticmethod
    def _normalize_text(value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized.lower() if normalized else None

    def _summarize_window(
        self,
        *,
        entries: list[dict[str, object]],
        recipient_key: str | None,
        merchant_key: str | None,
    ) -> dict[str, float | bool]:
        distinct_recipients = {
            str(entry["recipient"])
            for entry in entries
            if entry.get("recipient")
        }
        distinct_merchants = {
            str(entry["merchant"])
            for entry in entries
            if entry.get("merchant")
        }
        merchant_entries = [
            entry
            for entry in entries
            if merchant_key and entry.get("merchant") == merchant_key
        ]
        recipient_seen_before = bool(
            recipient_key
            and any(entry.get("recipient") == recipient_key for entry in entries[:-1])
        )
        merchant_seen_before = bool(
            merchant_key
            and any(entry.get("merchant") == merchant_key for entry in entries[:-1])
        )

        return {
            "countLastHour": float(len(entries)),
            "amountLastHour": float(sum(float(entry["amount"]) for entry in entries)),
            "distinctRecipientsLastHour": float(len(distinct_recipients)),
            "distinctMerchantsLastHour": float(len(distinct_merchants)),
            "recipientSeenBefore": recipient_seen_before,
            "merchantSeenBefore": merchant_seen_before,
            "merchantCountLastHour": float(len(merchant_entries)),
            "merchantAmountLastHour": float(
                sum(float(entry["amount"]) for entry in merchant_entries)
            ),
        }

    async def _get_client(self) -> Redis | None:
        if settings.redis_disabled or not settings.redis_host or Redis is None:
            return None

        if self._redis_client is not None:
            return self._redis_client

        client = Redis(
            host=settings.redis_host,
            port=settings.redis_port,
            password=settings.redis_password or None,
            db=settings.redis_db,
            decode_responses=True,
        )
        try:
            await client.ping()
            self._redis_client = client
            return self._redis_client
        except Exception as exc:  # pragma: no cover - depends on optional Redis availability
            logger.warning("Failed to connect fraud detection Redis; using in-memory fallback: %s", exc)
            try:
                await client.aclose()
            except Exception:
                pass
            return None

    async def record(
        self,
        customer_id: str,
        amount: float,
        *,
        recipient_customer_id: str | None = None,
        recipient_name: str | None = None,
        merchant_id: str | None = None,
        now_ms: float | None = None,
    ) -> dict[str, float | bool]:
        current_ms = now_ms or (time.time() * 1000)
        redis_client = await self._get_client()
        recipient_key = self._normalize_text(recipient_customer_id) or self._normalize_text(recipient_name)
        merchant_key = self._normalize_text(merchant_id)
        entry: dict[str, Any] = {
            "timestamp": current_ms,
            "amount": float(amount),
            "recipient": recipient_key,
            "merchant": merchant_key,
            "nonce": time.time_ns(),
        }

        if redis_client is None:
            entries = self._prune_memory(customer_id, current_ms)
            entries.append(entry)
            self._memory_window[customer_id] = entries
            return self._summarize_window(
                entries=entries,
                recipient_key=recipient_key,
                merchant_key=merchant_key,
            )

        key = f"fraud:velocity:{customer_id}"
        one_hour_ago = current_ms - 60 * 60 * 1000

        await redis_client.zremrangebyscore(key, 0, one_hour_ago)
        serialized_entry = json.dumps(entry, separators=(",", ":"), sort_keys=True)
        await redis_client.zadd(key, {serialized_entry: current_ms})
        await redis_client.expire(key, 3600)
        raw_entries = await redis_client.zrangebyscore(key, one_hour_ago, "+inf")
        entries = [json.loads(raw_entry) for raw_entry in raw_entries]
        return self._summarize_window(
            entries=entries,
            recipient_key=recipient_key,
            merchant_key=merchant_key,
        )

    async def close(self) -> None:
        if self._redis_client is None:
            return

        try:
            await self._redis_client.aclose()
        finally:
            self._redis_client = None
