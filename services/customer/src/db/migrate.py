from __future__ import annotations

import asyncio
import os

from services.customer.src.db.connection import create_engine, init_db, wait_for_db


async def main() -> None:
    database_url = os.getenv("DATABASE_URL", "").strip()
    engine = create_engine(database_url)
    try:
        await wait_for_db(engine, timeout_seconds=60)
        await init_db(engine)
        print("[customer-migrate] ok")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
