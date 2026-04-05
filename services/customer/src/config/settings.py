from __future__ import annotations

import os

OTP_EXPIRY_MINUTES = 10


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def should_auto_create_tables() -> bool:
    return _env_bool("AUTO_CREATE_TABLES", False)
