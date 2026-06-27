"""
EmploySure — SMTP Email Sender
Sends emails via Gmail SMTP using App Passwords.
Includes anti-spam measures: randomized delays, human-like headers, unique content per email.
"""

from __future__ import annotations

import asyncio
import logging
import random
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from app.models import BulkEmailEntry, BulkEmailResult

logger = logging.getLogger(__name__)

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587


def _send_single_email(
    sender_email: str,
    sender_password: str,
    to_email: str,
    subject: str,
    body: str,
) -> None:
    """Send a single email via Gmail SMTP (synchronous)."""
    msg = MIMEMultipart("alternative")
    msg["From"] = sender_email
    msg["To"] = to_email
    msg["Subject"] = subject
    # Anti-spam: add common human headers
    msg["X-Mailer"] = "EmploySure/1.0"
    msg["Reply-To"] = sender_email

    # Plain text body
    msg.attach(MIMEText(body, "plain", "utf-8"))

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as server:
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(sender_email, sender_password)
        server.send_message(msg)

    logger.info("Email sent to %s", to_email)


async def send_bulk_emails(
    entries: list[BulkEmailEntry],
    sender_email: str,
    sender_password: str,
    delay_seconds: int = 30,
) -> list[BulkEmailResult]:
    """
    Process a list of approved email entries.
    'send' entries go first immediately, 'schedule' entries go after with delays.
    Anti-spam: adds 25-35 second random delay between scheduled emails.
    """
    results: list[BulkEmailResult] = []

    # Separate send-now vs schedule
    send_now = [e for e in entries if e.action == "send" and e.status == "approved"]
    schedule = [e for e in entries if e.action == "schedule" and e.status == "approved"]

    # Send immediate ones first (small random delay between each)
    for entry in send_now:
        result = await _process_entry(entry, sender_email, sender_password)
        results.append(result)
        if len(send_now) > 1:
            await asyncio.sleep(random.uniform(3, 8))

    # Then process scheduled ones with larger delays
    for i, entry in enumerate(schedule):
        if i > 0:
            jitter = random.uniform(delay_seconds - 5, delay_seconds + 5)
            logger.info("Waiting %.1f seconds before next email...", jitter)
            await asyncio.sleep(jitter)
        result = await _process_entry(entry, sender_email, sender_password)
        results.append(result)

    return results


async def _process_entry(
    entry: BulkEmailEntry,
    sender_email: str,
    sender_password: str,
) -> BulkEmailResult:
    """Process a single entry — send via SMTP in a thread pool."""
    try:
        await asyncio.get_event_loop().run_in_executor(
            None,
            _send_single_email,
            sender_email,
            sender_password,
            entry.recipient_email,
            entry.subject,
            entry.body,
        )
        return BulkEmailResult(id=entry.id, status="sent")
    except Exception as e:
        logger.error("Failed to send email to %s: %s", entry.recipient_email, e)
        return BulkEmailResult(id=entry.id, status="failed", error=str(e))
