from __future__ import annotations

import logging
import time
from collections import defaultdict

from services.detect_fraud.config import settings

try:
    from redis.asyncio import Redis
except ImportError:  # pragma: no cover - dependency is installed in Docker/runtime
    Redis = None

logger = logging.getLogger("detect_fraud.velocity")


class VelocityStore:
    def __init__(self) -> None:
        self._memory_window: dict[str, list[dict[str, float]]] = defaultdict(list)
        self._redis_client: Redis | None = None

    def _prune_memory(self, customer_id: str, now_ms: float) -> list[dict[str, float]]:
        current = self._memory_window.get(customer_id, [])
        one_hour_ago = now_ms - 60 * 60 * 1000
        kept = [entry for entry in current if entry["timestamp"] >= one_hour_ago]
        self._memory_window[customer_id] = kept
        return kept

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

    async def record(self, customer_id: str, amount: float, now_ms: float | None = None) -> dict[str, float]:
        current_ms = now_ms or (time.time() * 1000)
        redis_client = await self._get_client()

        if redis_client is None:
            entries = self._prune_memory(customer_id, current_ms)
            entries.append({"timestamp": current_ms, "amount": amount})
            self._memory_window[customer_id] = entries
            return {
                "countLastHour": len(entries),
                "amountLastHour": float(sum(entry["amount"] for entry in entries)),
            }

        key = f"fraud:velocity:{customer_id}"
        amount_key = f"fraud:velocity:amount:{customer_id}"
        one_hour_ago = current_ms - 60 * 60 * 1000

        await redis_client.zremrangebyscore(key, 0, one_hour_ago)
        await redis_client.zadd(key, {f"{current_ms}:{time.time_ns()}": current_ms})
        await redis_client.expire(key, 3600)

        current_amount = float(await redis_client.get(amount_key) or 0)
        next_amount = current_amount + amount
        await redis_client.set(amount_key, str(next_amount), ex=3600)

        return {
            "countLastHour": float(await redis_client.zcard(key)),
            "amountLastHour": next_amount,
        }

    async def close(self) -> None:
        if self._redis_client is None:
            return

        try:
            await self._redis_client.aclose()
        finally:
            self._redis_client = None
