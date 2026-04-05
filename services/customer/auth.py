from __future__ import annotations

import os
import random
import string
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext
from passlib.exc import UnknownHashError

from ftds.notifications import send_transfer_notification

ALGORITHM = "HS256"

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

INSECURE_SECRET_VALUES = {
    "change-me-use-a-long-random-secret-in-production",
    "ftds-dev-secret-change-in-production-32chars",
    "dev-secret-123",
}

__all__ = [
    "create_access_token",
    "decode_access_token",
    "generate_otp_code",
    "has_local_password",
    "hash_password",
    "send_otp_email",
    "send_transfer_notification",
    "verify_password",
]


def _strict_security_enabled() -> bool:
    return os.getenv("SECURITY_ENFORCE_STRICT_CONFIG", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
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


# ── Password helpers ──────────────────────────────────────────────────────────

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


# ── JWT helpers ───────────────────────────────────────────────────────────────

def create_access_token(customer_id: str, expire_minutes: int = 60) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=expire_minutes)
    payload = {
        "sub": customer_id,
        "iss": "ftds-customer-service",   # Kong JWT plugin uses this to look up the credential
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


# ── OTP helpers ───────────────────────────────────────────────────────────────

def generate_otp_code() -> str:
    """Generate a 6-digit numeric OTP."""
    return "".join(random.choices(string.digits, k=6))


def _read_smtp_config(prefix: str) -> dict[str, Any] | None:
    host = os.getenv(f"{prefix}_HOST", "").strip()
    if not host:
        return None

    user = os.getenv(f"{prefix}_USER", "").strip()
    password = os.getenv(f"{prefix}_PASSWORD", "").strip()
    port = int(os.getenv(f"{prefix}_PORT", "587"))
    from_address = os.getenv(f"{prefix}_FROM", user or "noreply@ftds.local").strip()
    starttls_raw = os.getenv(f"{prefix}_STARTTLS")

    if starttls_raw is None:
        # Default to STARTTLS for typical external SMTP relays while keeping local demo sinks simple.
        start_tls = host not in {"mailpit", "localhost", "127.0.0.1"} and port == 587
    else:
        start_tls = starttls_raw.strip().lower() in {"1", "true", "yes", "on"}

    return {
        "host": host,
        "port": port,
        "user": user,
        "password": password,
        "from": from_address,
        "start_tls": start_tls,
    }


def _same_smtp_target(left: dict[str, Any], right: dict[str, Any]) -> bool:
    return (
        left["host"] == right["host"]
        and left["port"] == right["port"]
        and left["user"] == right["user"]
        and left["from"] == right["from"]
        and left["start_tls"] == right["start_tls"]
    )


async def _send_message_via_smtp(message: MIMEMultipart, smtp_config: dict[str, Any]) -> None:
    import aiosmtplib

    send_kwargs = {
        "hostname": smtp_config["host"],
        "port": smtp_config["port"],
        "start_tls": smtp_config["start_tls"],
    }
    if smtp_config["user"] and smtp_config["password"]:
        send_kwargs["username"] = smtp_config["user"]
        send_kwargs["password"] = smtp_config["password"]

    await aiosmtplib.send(message, **send_kwargs)


async def send_otp_email(to_email: str, full_name: str, code: str, purpose: str = "login") -> None:
    """
    Send OTP via the configured customer SMTP path and optionally mirror the same
    message into Mailpit for demo visibility.
    """
    primary_smtp = _read_smtp_config("SMTP")
    mirror_smtp = _read_smtp_config("SMTP_MIRROR")

    subject_map = {
        "login": "Your FTDS login verification code",
        "register": "Verify your FTDS account email",
        "set_password": "Set your FTDS account password",
        "change_password": "Confirm your FTDS password change",
        "delete_account": "Confirm your FTDS account deletion",
    }
    subject = subject_map.get(purpose, "Your FTDS verification code")

    html_body = f"""
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <div style="background:linear-gradient(135deg,#1a56db,#0e3a8c);padding:20px;border-radius:12px 12px 0 0;text-align:center">
        <h2 style="color:#fff;margin:0">FTDS Banking</h2>
        <p style="color:rgba(255,255,255,.8);margin:4px 0 0">Fraud-protected transaction banking</p>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:28px;border-radius:0 0 12px 12px">
        <p style="color:#374151">Hi <strong>{full_name}</strong>,</p>
        <p style="color:#6b7280">Your one-time verification code is:</p>
        <div style="background:#f3f4f6;border-radius:8px;padding:20px;text-align:center;margin:20px 0">
          <span style="font-size:36px;font-weight:700;letter-spacing:12px;color:#1a56db">{code}</span>
        </div>
        <p style="color:#6b7280;font-size:14px">This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
        <p style="color:#9ca3af;font-size:12px">If you did not request this, please ignore this email.</p>
      </div>
    </div>
    """

    text_body = (
        f"Hi {full_name},\n\n"
        f"Your one-time verification code is {code}.\n\n"
        "This code expires in 10 minutes. Do not share it with anyone.\n"
        "If you did not request this, please ignore this email.\n"
    )

    smtp_targets = []
    if primary_smtp is not None:
        smtp_targets.append(primary_smtp)
    if mirror_smtp is not None and all(not _same_smtp_target(mirror_smtp, existing) for existing in smtp_targets):
        smtp_targets.append(mirror_smtp)

    if not smtp_targets:
        # Dev mode — print to container logs
        print(f"[OTP DEV] ✉  To: {to_email} | Code: {code} | Purpose: {purpose}", flush=True)
        return

    delivery_failures: list[str] = []
    successful_deliveries = 0

    for smtp_config in smtp_targets:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = smtp_config["from"]
        msg["To"] = to_email
        msg.attach(MIMEText(text_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))

        try:
            await _send_message_via_smtp(msg, smtp_config)
            successful_deliveries += 1
        except Exception as exc:  # pragma: no cover - exercised by integration/runtime checks
            delivery_failures.append(f"{smtp_config['host']}:{smtp_config['port']} -> {exc}")

    if successful_deliveries == 0 and delivery_failures:
        raise RuntimeError(
            "Unable to deliver OTP email via any configured SMTP transport: "
            + "; ".join(delivery_failures)
        )

    if delivery_failures:
        print(
            "[OTP WARN] Some OTP delivery mirrors failed but at least one send succeeded: "
            + "; ".join(delivery_failures),
            flush=True,
        )

