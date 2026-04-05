from __future__ import annotations

from typing import Any


class RuntimeState:
    def __init__(self) -> None:
        self.producer: Any = None
        self.consumer: Any = None
        self.consumer_task: Any = None
        self.http_client: Any = None
        self.velocity_store: Any = None
        self.fraud_detection_service: Any = None
        self.decision_publisher: Any = None
        self.processing_error: Exception | None = None

    @property
    def ready(self) -> bool:
        if self.processing_error is not None:
            return False
        if self.producer is None or self.consumer is None or self.consumer_task is None:
            return False
        return not self.consumer_task.done()


state = RuntimeState()
