from __future__ import annotations

import os
import random
import string
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from jose import JWTError, jwt
from passlib.context import CryptContext

ALGORITHM = "HS256"

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


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
    return secret


# ── Password helpers ──────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


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


async def send_otp_email(to_email: str, full_name: str, code: str, purpose: str = "login") -> None:
    """
    Send OTP via SMTP. Falls back to console logging when SMTP is not configured
    (useful for local development without an email service).
    """
    smtp_host = os.getenv("SMTP_HOST", "").strip()
    smtp_user = os.getenv("SMTP_USER", "").strip()
    smtp_password = os.getenv("SMTP_PASSWORD", "").strip()
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_from = os.getenv("SMTP_FROM", smtp_user or "noreply@ftds.local")
    smtp_starttls = os.getenv("SMTP_STARTTLS", "true").strip().lower() in {"1", "true", "yes", "on"}

    subject_map = {
        "login": "Your FTDS login verification code",
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

    if not smtp_host:
        # Dev mode — print to container logs
        print(f"[OTP DEV] ✉  To: {to_email} | Code: {code} | Purpose: {purpose}", flush=True)
        return

    import aiosmtplib

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = smtp_from
    msg["To"] = to_email
    msg.attach(MIMEText(html_body, "html"))

    send_kwargs = {
        "hostname": smtp_host,
        "port": smtp_port,
        "start_tls": smtp_starttls,
    }
    if smtp_user and smtp_password:
        send_kwargs["username"] = smtp_user
        send_kwargs["password"] = smtp_password

    await aiosmtplib.send(msg, **send_kwargs)


from ftds.notifications import send_transfer_notification  # noqa: F401  (re-exported for callers)
