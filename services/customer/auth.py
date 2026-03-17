from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

ALGORITHM = "HS256"

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _get_jwt_secret() -> str:
    # Prefer Docker secret file (production), fall back to env var (development)
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
    return secret


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(customer_id: str, expire_minutes: int = 60) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=expire_minutes)
    payload = {"sub": customer_id, "exp": expire}
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
