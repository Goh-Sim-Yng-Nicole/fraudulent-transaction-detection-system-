from __future__ import annotations

from typing import Any, Optional, TypeVar

from pydantic import BaseModel

from ftds.schemas import EventEnvelope

DataT = TypeVar("DataT", bound=BaseModel)


def envelope(*, event_type: str, data: DataT, trace_id: Optional[str] = None) -> dict[str, Any]:
    return EventEnvelope[DataT](event_type=event_type, trace_id=trace_id, data=data).model_dump(mode="json")


def get_event_type(message_value: Any) -> Optional[str]:
    if not isinstance(message_value, dict):
        return None
    value = message_value.get("event_type")
    return value if isinstance(value, str) else None
