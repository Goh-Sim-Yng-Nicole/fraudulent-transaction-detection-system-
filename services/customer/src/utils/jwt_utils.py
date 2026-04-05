from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

ALGORITHM = "HS256"

INSECURE_SECRET_VALUES = {
    "change-me-use-a-long-random-secret-in-production",
    "ftds-dev-secret-change-in-production-32chars",
    "dev-secret-123",
}


def _strict_security_enabled() -> bool:
    return os.getenv("SECURITY_ENFORCE_STRICT_CONFIG", "").strip().lower() in {
        "1", "true", "yes", "on",
    } or os.getenv("NODE_ENV", "").strip().lower() == "production"


def _get_jwt_secret() -> str:
    secret_file = "/run/secrets/jwt_secret"
    try:
        with open(secret_file) as f:
            secret = f.read().strip()
            if secret:
                return secret
    except FileNotFoundError:
        pass
    secret = os.getenv("JWT_SECRET", "").strip()
    if not secret:
        raise RuntimeError(
            "JWT_SECRET is not configured. Set it via the JWT_SECRET env var "
            "or mount a Docker secret at /run/secrets/jwt_secret"
        )
    if _strict_security_enabled() and (secret in INSECURE_SECRET_VALUES or len(secret) < 32):
        raise RuntimeError(
            "JWT_SECRET must be a strong non-default secret when strict security is enabled"
        )
    return secret


def create_access_token(customer_id: str, expire_minutes: int = 60) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=expire_minutes)
    payload = {
        "sub": customer_id,
        "iss": "ftds-customer-service",
        "exp": expire,
    }
    return jwt.encode(payload, _get_jwt_secret(), algorithm=ALGORITHM)


def decode_access_token(token: str) -> str:
    """Returns customer_id (sub) from a valid token, raises ValueError on failure."""
    try:
        payload = jwt.decode(token, _get_jwt_secret(), algorithms=[ALGORITHM])
        customer_id: str | None = payload.get("sub")
        if not customer_id:
            raise ValueError("token missing sub claim")
        return customer_id
    except JWTError as exc:
        raise ValueError("invalid or expired token") from exc
