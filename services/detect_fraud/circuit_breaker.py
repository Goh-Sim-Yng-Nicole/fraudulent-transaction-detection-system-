from __future__ import annotations

import time


class CircuitBreaker:
    def __init__(self, *, failure_threshold: int = 5, reset_timeout_ms: int = 30000) -> None:
        self.failure_threshold = failure_threshold
        self.reset_timeout_ms = reset_timeout_ms
        self.failure_count = 0
        self.opened_at_ms: float | None = None

    def is_open(self) -> bool:
        if self.opened_at_ms is None:
            return False

        elapsed_ms = (time.time() * 1000) - self.opened_at_ms
        if elapsed_ms >= self.reset_timeout_ms:
            self.failure_count = 0
            self.opened_at_ms = None
            return False

        return True

    def record_success(self) -> None:
        self.failure_count = 0
        self.opened_at_ms = None

    def record_failure(self) -> None:
        self.failure_count += 1
        if self.failure_count >= self.failure_threshold:
            self.opened_at_ms = time.time() * 1000
