from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from services.customer.src.consumers import notification_consumer
from services.customer.src.db.connection import (
    create_engine,
    create_sessionmaker,
    init_db,
    should_auto_create_tables,
    wait_for_db,
)
from services.customer.src.routes.auth import router as auth_router
from services.customer.src.routes.health import router as health_router
from services.customer.src.routes.profile import router as profile_router
from services.customer.src.state import state
from services.customer.src.utils.observability import (
    instrument_fastapi,
    instrument_sqlalchemy,
    shutdown_tracing,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    database_url = os.getenv("DATABASE_URL", "").strip()
    state.engine = create_engine(database_url)
    instrument_sqlalchemy(state.engine)
    await wait_for_db(state.engine)
    if should_auto_create_tables():
        await init_db(state.engine)
    state.session_factory = create_sessionmaker(state.engine)
    await notification_consumer.start(state.session_factory)
    try:
        yield
    finally:
        await notification_consumer.stop()
        if state.engine is not None:
            await state.engine.dispose()
        shutdown_tracing()


app = FastAPI(title="FTDS Customer Service", version="0.2.0", lifespan=lifespan)
instrument_fastapi(app)

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(profile_router)
