from __future__ import annotations

import os
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText


# ── Internal helpers ──────────────────────────────────────────────────────────

def _header_html() -> str:
    return """
    <div style="background:linear-gradient(135deg,#1a56db,#0e3a8c);padding:20px;border-radius:12px 12px 0 0;text-align:center">
      <h2 style="color:#fff;margin:0">FTDS Banking</h2>
      <p style="color:rgba(255,255,255,.8);margin:4px 0 0">Fraud-protected transaction banking</p>
    </div>"""


def _wrap_html(body: str) -> str:
    return f"""
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      {_header_html()}
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:28px;border-radius:0 0 12px 12px">
        {body}
      </div>
    </div>"""


async def _send_sms(to_phone: str, body: str) -> None:
    """Send SMS via Twilio REST API. Falls back to console log if not configured."""
    account_sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
    auth_token  = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
    from_number = os.getenv("TWILIO_FROM_NUMBER", "").strip()
    if not account_sid or not auth_token or not from_number:
        print(f"[SMS DEV] To: {to_phone} | {body}", flush=True)
        return
    import httpx
    async with httpx.AsyncClient(timeout=10.0) as client:
        await client.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json",
            data={"From": from_number, "To": to_phone, "Body": body},
            auth=(account_sid, auth_token),
        )


async def _send_email(to_email: str, subject: str, html_body: str, sms_fallback: str) -> None:
    smtp_host     = os.getenv("SMTP_HOST", "").strip()
    smtp_user     = os.getenv("SMTP_USER", "").strip()
    smtp_password = os.getenv("SMTP_PASSWORD", "").strip()
    smtp_port     = int(os.getenv("SMTP_PORT", "587"))
    smtp_from     = os.getenv("SMTP_FROM", smtp_user or "noreply@ftds.local")

    if not smtp_host or not smtp_user:
        print(f"[NOTIFY DEV] Email to {to_email} | {sms_fallback}", flush=True)
        return
    import aiosmtplib
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = smtp_from
    msg["To"]      = to_email
    msg.attach(MIMEText(html_body, "html"))
    try:
        await aiosmtplib.send(
            msg, hostname=smtp_host, port=smtp_port,
            username=smtp_user, password=smtp_password, start_tls=True,
        )
    except Exception as exc:
        print(f"[NOTIFY] Email send failed: {exc}", flush=True)


async def _notify(
    to_email: str,
    to_phone: str | None,
    subject: str,
    html_body: str,
    sms_body: str,
) -> None:
    await _send_email(to_email, subject, _wrap_html(html_body), sms_body)
    if to_phone:
        try:
            await _send_sms(to_phone, sms_body)
        except Exception as exc:
            print(f"[NOTIFY] SMS send failed: {exc}", flush=True)


# ── Public notification functions ─────────────────────────────────────────────

async def send_transfer_notification(
    to_email: str,
    to_phone: str | None,
    to_name: str,
    from_name: str,
    currency: str,
    amount: float,
    transaction_id: str,
) -> None:
    """Notify the recipient of an approved P2P transfer."""
    amount_str = f"{currency} {amount:,.2f}"
    html = f"""
        <p style="color:#374151">Hi <strong>{to_name}</strong>,</p>
        <p style="color:#374151">You have received a transfer:</p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:20px;margin:16px 0;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#0e7f4e">{amount_str}</div>
          <div style="color:#6b7280;margin-top:6px">from <strong>{from_name}</strong></div>
        </div>
        <p style="color:#6b7280;font-size:14px">Transaction ID: <code>{transaction_id}</code></p>
        <p style="color:#9ca3af;font-size:12px">Log in to FTDS Banking to view details.</p>"""
    sms = (f"FTDS Banking: {from_name} transferred {amount_str} to you. "
           f"Txn ID: {transaction_id[:8]}. Log in to view details.")
    await _notify(to_email, to_phone, f"FTDS: You received {amount_str} from {from_name}", html, sms)


async def send_transaction_flagged_notification(
    to_email: str,
    to_phone: str | None,
    to_name: str,
    currency: str,
    amount: float,
    transaction_id: str,
) -> None:
    """Notify the customer that their transaction has been flagged for review."""
    amount_str = f"{currency} {amount:,.2f}"
    html = f"""
        <p style="color:#374151">Hi <strong>{to_name}</strong>,</p>
        <p style="color:#374151">Your transaction has been <strong style="color:#d97706">flagged for manual review</strong>:</p>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin:16px 0">
          <div style="font-size:20px;font-weight:700;color:#92400e">{amount_str}</div>
          <div style="color:#6b7280;font-size:13px;margin-top:4px">Transaction ID: <code>{transaction_id}</code></div>
        </div>
        <p style="color:#6b7280;font-size:14px">Our fraud analysis team is reviewing this transaction. You will be notified once a decision has been made.</p>
        <p style="color:#9ca3af;font-size:12px">If you did not initiate this transaction, please contact support immediately.</p>"""
    sms = (f"FTDS Banking: Your transaction of {amount_str} (ID: {transaction_id[:8]}) "
           f"has been flagged for review. We will notify you of the outcome.")
    await _notify(to_email, to_phone, f"FTDS: Your transaction of {amount_str} is under review", html, sms)


async def send_transaction_finalised_notification(
    to_email: str,
    to_phone: str | None,
    to_name: str,
    outcome: str,
    currency: str,
    amount: float,
    transaction_id: str,
    reason: str,
) -> None:
    """Notify the sender of a transaction's final outcome (APPROVED or REJECTED)."""
    amount_str = f"{currency} {amount:,.2f}"
    if outcome == "APPROVED":
        color, bg, label = "#0e7f4e", "#f0fdf4", "APPROVED"
        border = "#bbf7d0"
    else:
        color, bg, label = "#c0392b", "#fef2f2", "REJECTED"
        border = "#fecaca"
    html = f"""
        <p style="color:#374151">Hi <strong>{to_name}</strong>,</p>
        <p style="color:#374151">Your transaction has been <strong style="color:{color}">{label}</strong>:</p>
        <div style="background:{bg};border:1px solid {border};border-radius:8px;padding:16px;margin:16px 0">
          <div style="font-size:20px;font-weight:700;color:{color}">{amount_str}</div>
          <div style="color:#6b7280;font-size:13px;margin-top:4px">Transaction ID: <code>{transaction_id}</code></div>
        </div>
        <p style="color:#6b7280;font-size:14px"><strong>Reason:</strong> {reason}</p>
        <p style="color:#9ca3af;font-size:12px">Log in to FTDS Banking to view full details.</p>"""
    sms = (f"FTDS Banking: Your transaction of {amount_str} (ID: {transaction_id[:8]}) "
           f"was {label}. Reason: {reason}")
    await _notify(to_email, to_phone, f"FTDS: Transaction {label} — {amount_str}", html, sms)


async def send_transaction_reviewed_notification(
    to_email: str,
    to_phone: str | None,
    to_name: str,
    outcome: str,
    transaction_id: str,
    reason: str,
) -> None:
    """Notify the customer of the manual review outcome for a flagged transaction."""
    color = "#0e7f4e" if outcome == "APPROVED" else "#c0392b"
    html = f"""
        <p style="color:#374151">Hi <strong>{to_name}</strong>,</p>
        <p style="color:#374151">Your flagged transaction has been manually reviewed:</p>
        <div style="background:#f8faff;border:1px solid #e0e7ff;border-radius:8px;padding:16px;margin:16px 0">
          <div style="font-size:18px;font-weight:700;color:{color}">Outcome: {outcome}</div>
          <div style="color:#6b7280;font-size:13px;margin-top:4px">Transaction ID: <code>{transaction_id}</code></div>
        </div>
        <p style="color:#6b7280;font-size:14px"><strong>Reason:</strong> {reason}</p>
        <p style="color:#9ca3af;font-size:12px">Log in to FTDS Banking to view full details.</p>"""
    sms = (f"FTDS Banking: Your flagged transaction (ID: {transaction_id[:8]}) "
           f"was manually reviewed. Outcome: {outcome}. Reason: {reason}")
    await _notify(to_email, to_phone, f"FTDS: Manual Review Outcome — {outcome}", html, sms)


async def send_appeal_resolved_notification(
    to_email: str,
    to_phone: str | None,
    to_name: str,
    outcome: str,
    transaction_id: str,
    appeal_id: str,
    reason: str,
) -> None:
    """Notify the customer that their appeal has been resolved."""
    color = "#0e7f4e" if outcome == "APPROVED" else "#c0392b"
    html = f"""
        <p style="color:#374151">Hi <strong>{to_name}</strong>,</p>
        <p style="color:#374151">Your appeal has been resolved:</p>
        <div style="background:#f8faff;border:1px solid #e0e7ff;border-radius:8px;padding:16px;margin:16px 0">
          <div style="font-size:18px;font-weight:700;color:{color}">Outcome: {outcome}</div>
          <div style="color:#6b7280;font-size:13px;margin-top:4px">Appeal ID: <code>{appeal_id}</code></div>
          <div style="color:#6b7280;font-size:13px">Transaction ID: <code>{transaction_id}</code></div>
        </div>
        <p style="color:#6b7280;font-size:14px"><strong>Reason:</strong> {reason}</p>
        <p style="color:#9ca3af;font-size:12px">Log in to FTDS Banking to view full details.</p>"""
    sms = (f"FTDS Banking: Your appeal (ID: {appeal_id[:8]}) for transaction "
           f"{transaction_id[:8]} was resolved. Outcome: {outcome}. Reason: {reason}")
    await _notify(to_email, to_phone, f"FTDS: Appeal Resolved — {outcome}", html, sms)
