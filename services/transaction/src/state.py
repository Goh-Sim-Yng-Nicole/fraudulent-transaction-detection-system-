from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker


class AppState:
    def __init__(self) -> None:
        self.engine: AsyncEngine | None = None
        self.session_factory: async_sessionmaker[AsyncSession] | None = None
        self.store: Any = None
        self.producer: Any = None
        self.consumer: Any = None
        self.consumer_task: Any = None


state = AppState()
