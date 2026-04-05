from __future__ import annotations

import os
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText


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

    if not smtp_host:
        print(f"[OTP DEV] \u2709  To: {to_email} | Code: {code} | Purpose: {purpose}", flush=True)
        return

    import aiosmtplib

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = smtp_from
    msg["To"] = to_email
    msg.attach(MIMEText(html_body, "html"))

    send_kwargs: dict = {
        "hostname": smtp_host,
        "port": smtp_port,
        "start_tls": smtp_starttls,
    }
    if smtp_user and smtp_password:
        send_kwargs["username"] = smtp_user
        send_kwargs["password"] = smtp_password

    await aiosmtplib.send(msg, **send_kwargs)
