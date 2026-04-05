from __future__ import annotations

import os
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any


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
        "register": "Verify your FTDS account",
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
        print(f"[OTP DEV] \u2709  To: {to_email} | Code: {code} | Purpose: {purpose}", flush=True)
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
