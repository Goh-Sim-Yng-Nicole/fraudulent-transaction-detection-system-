from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

from aiokafka import AIOKafkaConsumer
from sqlalchemy import select

from services.customer.src.models.customer import Customer

logger = logging.getLogger("customer.notifications")

_BROKERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
_GROUP_ID = os.getenv("KAFKA_NOTIFICATION_GROUP_ID", "customer-notification-group")
_TOPIC_TXN_FINALISED = os.getenv("KAFKA_INPUT_TOPIC_TXN_FINALISED", "transaction.finalised")
_TOPIC_APPEAL_RESOLVED = os.getenv("KAFKA_INPUT_TOPIC_APPEAL_RESOLVED", "appeal.resolved")

_consumer: AIOKafkaConsumer | None = None
_task: asyncio.Task | None = None


async def _send_transaction_notification(payload: dict[str, Any], session_factory: Any) -> None:
    customer_id = payload.get("customerId") or payload.get("customer_id")
    status = str(payload.get("status") or payload.get("finalDecision") or "").upper()
    transaction_id = payload.get("transactionId") or payload.get("transaction_id") or "-"
    amount = payload.get("amount")
    currency = payload.get("currency", "SGD")

    if not customer_id:
        return

    async with session_factory() as db:
        result = await db.execute(
            select(Customer).where(Customer.customer_id == customer_id, Customer.is_active == True)  # noqa: E712
        )
        customer = result.scalar_one_or_none()

    if customer is None:
        return

    amount_str = f"{currency} {float(amount):,.2f}" if amount is not None else "N/A"

    if status in {"APPROVED"}:
        subject = "Transaction approved"
        body_line = f"Your transaction of <strong>{amount_str}</strong> has been <strong style='color:#16a34a'>approved</strong>."
    elif status in {"REJECTED", "DECLINED"}:
        subject = "Transaction declined"
        body_line = f"Your transaction of <strong>{amount_str}</strong> was <strong style='color:#dc2626'>declined</strong> due to a fraud risk assessment."
    elif status in {"FLAGGED", "PENDING_REVIEW"}:
        subject = "Transaction under review"
        body_line = f"Your transaction of <strong>{amount_str}</strong> has been flagged for manual review. We will notify you once a decision is made."
    else:
        return  # Unknown status — skip notification

    html_body = f"""
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <div style="background:linear-gradient(135deg,#1a56db,#0e3a8c);padding:20px;border-radius:12px 12px 0 0;text-align:center">
        <h2 style="color:#fff;margin:0">FTDS Banking</h2>
        <p style="color:rgba(255,255,255,.8);margin:4px 0 0">Transaction update</p>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:28px;border-radius:0 0 12px 12px">
        <p style="color:#374151">Hi <strong>{customer.full_name}</strong>,</p>
        <p style="color:#6b7280">{body_line}</p>
        <p style="color:#9ca3af;font-size:12px">Transaction ID: {transaction_id}</p>
        <p style="color:#9ca3af;font-size:12px">If you did not initiate this transaction, please contact support immediately.</p>
      </div>
    </div>
    """

    smtp_host = os.getenv("SMTP_HOST", "").strip()
    if not smtp_host:
        logger.info("[NOTIFY DEV] To: %s | Subject: %s | Txn: %s", customer.email, subject, transaction_id)
        return

    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    import aiosmtplib

    smtp_user = os.getenv("SMTP_USER", "").strip()
    smtp_password = os.getenv("SMTP_PASSWORD", "").strip()
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_from = os.getenv("SMTP_FROM", smtp_user or "noreply@ftds.local")
    smtp_starttls = os.getenv("SMTP_STARTTLS", "true").strip().lower() in {"1", "true", "yes", "on"}

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = smtp_from
    msg["To"] = customer.email
    msg.attach(MIMEText(html_body, "html"))

    send_kwargs: dict = {"hostname": smtp_host, "port": smtp_port, "start_tls": smtp_starttls}
    if smtp_user and smtp_password:
        send_kwargs["username"] = smtp_user
        send_kwargs["password"] = smtp_password
    await aiosmtplib.send(msg, **send_kwargs)


async def _send_appeal_notification(payload: dict[str, Any], session_factory: Any) -> None:
    customer_id = payload.get("customerId") or payload.get("customer_id")
    resolution = str(payload.get("resolution") or "").upper()
    appeal_id = payload.get("appealId") or payload.get("appeal_id") or "-"
    transaction_id = payload.get("transactionId") or payload.get("transaction_id") or "-"

    if not customer_id or not resolution:
        return

    async with session_factory() as db:
        result = await db.execute(
            select(Customer).where(Customer.customer_id == customer_id, Customer.is_active == True)  # noqa: E712
        )
        customer = result.scalar_one_or_none()

    if customer is None:
        return

    if resolution == "REVERSE":
        outcome = "<strong style='color:#16a34a'>approved</strong>"
        detail = "The original decision has been reversed in your favour."
    elif resolution == "UPHOLD":
        outcome = "<strong style='color:#dc2626'>denied</strong>"
        detail = "After review, the original decision has been upheld."
    else:
        return

    html_body = f"""
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <div style="background:linear-gradient(135deg,#1a56db,#0e3a8c);padding:20px;border-radius:12px 12px 0 0;text-align:center">
        <h2 style="color:#fff;margin:0">FTDS Banking</h2>
        <p style="color:rgba(255,255,255,.8);margin:4px 0 0">Appeal decision</p>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:28px;border-radius:0 0 12px 12px">
        <p style="color:#374151">Hi <strong>{customer.full_name}</strong>,</p>
        <p style="color:#6b7280">Your appeal has been {outcome}. {detail}</p>
        <p style="color:#9ca3af;font-size:12px">Appeal ID: {appeal_id}</p>
        <p style="color:#9ca3af;font-size:12px">Transaction ID: {transaction_id}</p>
        <p style="color:#9ca3af;font-size:12px">If you have further questions, please contact support.</p>
      </div>
    </div>
    """

    smtp_host = os.getenv("SMTP_HOST", "").strip()
    if not smtp_host:
        logger.info("[NOTIFY DEV] To: %s | Appeal: %s | Resolution: %s", customer.email, appeal_id, resolution)
        return

    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    import aiosmtplib

    smtp_user = os.getenv("SMTP_USER", "").strip()
    smtp_password = os.getenv("SMTP_PASSWORD", "").strip()
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_from = os.getenv("SMTP_FROM", smtp_user or "noreply@ftds.local")
    smtp_starttls = os.getenv("SMTP_STARTTLS", "true").strip().lower() in {"1", "true", "yes", "on"}

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Appeal decision — FTDS Banking"
    msg["From"] = smtp_from
    msg["To"] = customer.email
    msg.attach(MIMEText(html_body, "html"))

    send_kwargs: dict = {"hostname": smtp_host, "port": smtp_port, "start_tls": smtp_starttls}
    if smtp_user and smtp_password:
        send_kwargs["username"] = smtp_user
        send_kwargs["password"] = smtp_password
    await aiosmtplib.send(msg, **send_kwargs)


async def _consume(session_factory: Any) -> None:
    assert _consumer is not None
    try:
        async for message in _consumer:
            raw = message.value
            if not raw:
                continue
            try:
                payload = json.loads(raw.decode("utf-8", errors="replace"))
            except json.JSONDecodeError:
                logger.warning("Skipping malformed notification message on %s", message.topic)
                continue

            try:
                if message.topic == _TOPIC_TXN_FINALISED:
                    await _send_transaction_notification(payload, session_factory)
                elif message.topic == _TOPIC_APPEAL_RESOLVED:
                    await _send_appeal_notification(payload, session_factory)
            except Exception as exc:
                logger.error("Failed to send notification: %s", exc)
            finally:
                await _consumer.commit()
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.exception("Notification consumer error: %s", exc)
        raise


async def start(session_factory: Any) -> None:
    global _consumer, _task
    _consumer = AIOKafkaConsumer(
        _TOPIC_TXN_FINALISED,
        _TOPIC_APPEAL_RESOLVED,
        bootstrap_servers=_BROKERS,
        group_id=_GROUP_ID,
        auto_offset_reset="latest",
        enable_auto_commit=False,
        client_id="customer-notification-consumer",
    )
    await _consumer.start()
    _task = asyncio.create_task(_consume(session_factory))
    logger.info("Notification consumer started (topics: %s, %s)", _TOPIC_TXN_FINALISED, _TOPIC_APPEAL_RESOLVED)


async def stop() -> None:
    global _consumer, _task
    if _task is not None:
        _task.cancel()
        import contextlib
        with contextlib.suppress(asyncio.CancelledError):
            await _task
        _task = None
    if _consumer is not None:
        await _consumer.stop()
        _consumer = None
