from __future__ import annotations

from passlib.context import CryptContext
from passlib.exc import UnknownHashError

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def has_local_password(hashed: str | None) -> bool:
    return bool(hashed and str(hashed).strip())


def verify_password(plain: str, hashed: str) -> bool:
    if not has_local_password(hashed):
        return False
    try:
        return pwd_context.verify(plain, hashed)
    except UnknownHashError:
        return False
