"""
EmploySure — APScheduler background jobs
  Job 1: Re-crawl all active sources every RECRAWL_INTERVAL_HOURS
  Job 2: Verify links (HEAD request) every VERIFY_LINKS_INTERVAL_HOURS
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.config import get_settings

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


def get_scheduler() -> AsyncIOScheduler:
    """Return the singleton scheduler (created lazily)."""
    global _scheduler
    if _scheduler is None:
        _scheduler = AsyncIOScheduler(timezone="UTC")
    return _scheduler


async def _run_recrawl() -> None:
    """Wrapper imported at call-time to avoid circular imports."""
    from app.agent import scrape_all_active_sources

    logger.info("Scheduler: starting scheduled re-crawl…")
    try:
        await scrape_all_active_sources()
    except Exception:
        logger.exception("Scheduler: re-crawl job failed")


async def _run_link_verification() -> None:
    """Wrapper imported at call-time to avoid circular imports."""
    from app.agent import verify_all_links

    logger.info("Scheduler: starting link verification…")
    try:
        await verify_all_links()
    except Exception:
        logger.exception("Scheduler: link verification job failed")


def start_scheduler() -> None:
    """Configure and start the APScheduler background jobs."""
    settings = get_settings()
    scheduler = get_scheduler()

    if scheduler.running:
        logger.info("Scheduler already running — skipping start.")
        return

    delay_seconds = settings.scheduler_initial_delay_seconds
    now = datetime.now(timezone.utc)
    first_run = now + timedelta(seconds=delay_seconds)

    # Job 1: Re-crawl active sources
    scheduler.add_job(
        _run_recrawl,
        trigger=IntervalTrigger(hours=settings.recrawl_interval_hours),
        id="recrawl_all",
        name="Re-crawl all active sources",
        replace_existing=True,
        next_run_time=first_run,
    )

    # Job 2: Link verification DISABLED — many sites reject HEAD requests
    # which causes false positives that drop valid listings.
    # scheduler.add_job(
    #     _run_link_verification,
    #     trigger=IntervalTrigger(hours=settings.verify_links_interval_hours),
    #     id="verify_links",
    #     name="Verify job application links",
    #     replace_existing=True,
    #     next_run_time=first_run + timedelta(seconds=30),
    # )

    scheduler.start()
    logger.info(
        "Scheduler started — recrawl every %.1fh, link verify every %.1fh "
        "(initial delay %ds)",
        settings.recrawl_interval_hours,
        settings.verify_links_interval_hours,
        delay_seconds,
    )


def stop_scheduler() -> None:
    """Gracefully shut down the scheduler."""
    scheduler = get_scheduler()
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped.")
