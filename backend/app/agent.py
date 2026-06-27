"""
EmploySure — Scraping Agent
Uses crawl4ai to crawl target URLs, passes the markdown through the AI
filter, deduplicates against the DB, inserts new listings, and broadcasts
events via SSE.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_filter import extract_jobs_with_ai
from app.database import JobListing, TargetSource, async_session_factory
from app.models import ExtractedJob, SSEEvent

logger = logging.getLogger(__name__)

# ─── SSE event bus ────────────────────────────────────────────────────────────
# A set of asyncio.Queue instances — one per connected SSE client.

_sse_subscribers: set[asyncio.Queue[str]] = set()
_sse_lock = asyncio.Lock()


async def subscribe_sse() -> asyncio.Queue[str]:
    """Register a new SSE client and return its queue."""
    q: asyncio.Queue[str] = asyncio.Queue(maxsize=256)
    async with _sse_lock:
        _sse_subscribers.add(q)
    return q


async def unsubscribe_sse(q: asyncio.Queue[str]) -> None:
    """Unregister an SSE client."""
    async with _sse_lock:
        _sse_subscribers.discard(q)


async def _broadcast(event: SSEEvent) -> None:
    """Send an event to every connected SSE client."""
    payload = f"event: {event.type}\ndata: {json.dumps(event.data)}\n\n"
    async with _sse_lock:
        dead: list[asyncio.Queue[str]] = []
        for q in _sse_subscribers:
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            _sse_subscribers.discard(q)


# ─── Source status helpers ────────────────────────────────────────────────────

async def _set_source_status(
    session: AsyncSession, source_id: int, status: str
) -> None:
    """Update the status column and broadcast."""
    result = await session.execute(
        select(TargetSource).where(TargetSource.id == source_id)
    )
    source = result.scalar_one_or_none()
    if source:
        source.status = status
        if status in ("done", "failed"):
            source.last_crawled_at = datetime.now(timezone.utc)
        await session.commit()
    await _broadcast(SSEEvent(type="crawl_status", data={"source_id": source_id, "status": status}))


# ─── Crawl + filter pipeline ─────────────────────────────────────────────────

async def _fast_fetch_url(url: str) -> str:
    """Fetch a URL using httpx (fast) and convert HTML to readable text."""
    import httpx
    from bs4 import BeautifulSoup

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    async with httpx.AsyncClient(
        timeout=15.0,
        follow_redirects=True,
        headers=headers,
    ) as client:
        resp = await client.get(url)
        resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")

    # Remove noise
    for tag in soup(["script", "style", "nav", "footer", "header", "noscript", "svg", "img"]):
        tag.decompose()

    text = soup.get_text(separator="\n", strip=True)

    # Truncate to fit within Groq free-tier token limits
    if len(text) > 12_000:
        text = text[:12_000]

    logger.info("Fast-fetched %s — got %d chars", url, len(text))
    return text


async def _crawl_url(url: str) -> str:
    """Fetch a URL using fast httpx. Skip browser fallback for speed."""
    text = await _fast_fetch_url(url)
    if len(text.strip()) > 100:
        return text
    raise RuntimeError(f"Insufficient content from {url} ({len(text.strip())} chars)")


async def _deduplicate_and_insert(
    session: AsyncSession,
    source_id: int,
    extracted: list[ExtractedJob],
    search_label: str = "",
) -> list[dict[str, Any]]:
    """
    Filter out jobs whose application_link already exists in the DB,
    insert the new ones, and return them as dicts.
    """
    if not extracted:
        return []

    # Gather all existing links for this source
    links = [j.application_link for j in extracted if j.application_link]
    if not links:
        return []

    result = await session.execute(
        select(JobListing.application_link).where(
            JobListing.application_link.in_(links)
        )
    )
    existing_links: set[str] = {row[0] for row in result.all()}

    new_jobs: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc)

    for job in extracted:
        if not job.application_link or job.application_link in existing_links:
            continue
        listing = JobListing(
            source_id=source_id,
            company_name=job.company_name,
            job_title=job.job_title,
            application_link=job.application_link,
            experience_required=job.experience_required,
            location=job.location,
            salary=getattr(job, 'salary', '') or '',
            search_label=search_label,
            is_agency=job.is_agency,
            discovered_at=now,
            last_verified_at=now,
        )
        session.add(listing)
        existing_links.add(job.application_link)  # prevent duplicates within batch
        new_jobs.append({
            "company_name": job.company_name,
            "job_title": job.job_title,
            "application_link": job.application_link,
            "experience_required": job.experience_required,
            "location": job.location,
            "salary": getattr(job, 'salary', '') or '',
            "search_label": search_label,
            "is_agency": job.is_agency,
        })

    if new_jobs:
        await session.commit()
    return new_jobs


# ─── Public API ───────────────────────────────────────────────────────────────

async def scrape_source(source_id: int) -> None:
    """
    Full scrape pipeline for a single source:
      1. Mark source as crawling
      2. Crawl URL
      3. AI extraction
      4. Deduplicate + insert
      5. Broadcast new jobs via SSE
      6. Mark source as done / failed
    """
    async with async_session_factory() as session:
        # Fetch the source
        result = await session.execute(
            select(TargetSource).where(TargetSource.id == source_id)
        )
        source = result.scalar_one_or_none()
        if source is None:
            logger.error("Source %d not found — aborting scrape.", source_id)
            return

        url = source.url
        criteria = source.criteria

    try:
        # Step 1: Status → crawling
        async with async_session_factory() as session:
            await _set_source_status(session, source_id, "crawling")

        # Step 2: Crawl
        markdown = await _crawl_url(url)

        if not markdown.strip():
            logger.warning("No content returned for %s", url)
            async with async_session_factory() as session:
                await _set_source_status(session, source_id, "done")
            await _broadcast(SSEEvent(
                type="crawl_complete",
                data={"source_id": source_id, "jobs_found": 0, "provider": "n/a"},
            ))
            return

        # Step 3: AI filter
        extracted, provider = await extract_jobs_with_ai(markdown, criteria)
        logger.info(
            "AI (%s) extracted %d jobs from source %d",
            provider, len(extracted), source_id,
        )

        # Step 4: Deduplicate + insert
        async with async_session_factory() as session:
            new_jobs = await _deduplicate_and_insert(session, source_id, extracted)

        # Step 5: Broadcast each new job
        for job in new_jobs:
            await _broadcast(SSEEvent(
                type="new_job",
                data={"source_id": source_id, **job},
            ))

        # Step 6: Status → done
        async with async_session_factory() as session:
            await _set_source_status(session, source_id, "done")

        await _broadcast(SSEEvent(
            type="crawl_complete",
            data={
                "source_id": source_id,
                "jobs_found": len(new_jobs),
                "total_extracted": len(extracted),
                "provider": provider,
            },
        ))
        logger.info(
            "Scrape complete for source %d: %d new / %d total extracted (via %s)",
            source_id, len(new_jobs), len(extracted), provider,
        )

    except Exception as exc:
        logger.exception("Scrape failed for source %d: %s", source_id, exc)
        try:
            async with async_session_factory() as session:
                await _set_source_status(session, source_id, "failed")
        except Exception:
            pass
        await _broadcast(SSEEvent(
            type="error",
            data={"source_id": source_id, "error": str(exc)},
        ))


async def scrape_all_active_sources() -> None:
    """Scrape every source marked as active. Used by the scheduler."""
    async with async_session_factory() as session:
        result = await session.execute(
            select(TargetSource.id).where(TargetSource.is_active == True)  # noqa: E712
        )
        source_ids = [row[0] for row in result.all()]

    logger.info("Scheduled re-crawl: %d active sources", len(source_ids))
    for sid in source_ids:
        await scrape_source(sid)


async def verify_all_links() -> None:
    """HEAD-request every link_alive job listing; archive dead links."""
    async with async_session_factory() as session:
        result = await session.execute(
            select(JobListing).where(JobListing.link_alive == True)  # noqa: E712
        )
        listings = result.scalars().all()

    if not listings:
        logger.info("No alive links to verify.")
        return

    logger.info("Verifying %d job links…", len(listings))

    dead_ids: list[int] = []


    import httpx  # local import so top-level stays clean

    async with asyncio.TaskGroup() as tg:

        async def _check(listing_id: int, url: str) -> None:
            try:
                async with httpx.AsyncClient(
                    timeout=15.0, follow_redirects=True
                ) as client:
                    resp = await client.head(url)
                    if resp.status_code >= 400:
                        dead_ids.append(listing_id)
            except Exception:
                dead_ids.append(listing_id)

        for listing in listings:
            tg.create_task(_check(listing.id, listing.application_link))

    if dead_ids:
        async with async_session_factory() as session:
            result = await session.execute(
                select(JobListing).where(JobListing.id.in_(dead_ids))
            )
            for listing in result.scalars().all():
                listing.link_alive = False
                listing.last_verified_at = datetime.now(timezone.utc)
            await session.commit()
        logger.info("Marked %d links as dead.", len(dead_ids))
    else:
        logger.info("All %d links are still alive.", len(listings))


# ─── Meta-Search: discover URLs + scrape ──────────────────────────────────────

async def search_and_scrape(
    role: str,
    experience: str = "Any",
    location: str = "",
) -> None:
    """
    Meta-search pipeline:
      1. Create a virtual source in the DB
      2. Discover job-listing URLs via DuckDuckGo
      3. Crawl top URLs in parallel (semaphore-limited)
      4. AI-extract jobs from each page
      5. Deduplicate + insert + broadcast SSE events
    """
    from app.search_engine import discover_job_urls

    # ── Step 1: Create a search source in the database ────────────────────────
    loc_suffix = f" in {location}" if location else ""
    source_name = f"Search: {role}{loc_suffix}"
    virtual_url = f"search://{role}/{location}"
    criteria = (
        f"Extract all job listings related to '{role}' or similar roles "
        f"(including variations like senior/junior/lead/intern versions). "
        f"Preferred experience: {experience}. "
        f"Preferred location: {location or 'Any'}. "
        f"Include all software/tech jobs you find on this page."
    )

    async with async_session_factory() as session:
        source = TargetSource(
            url=virtual_url,
            source_name=source_name,
            criteria=criteria,
            status="crawling",
            is_active=False,  # virtual source — not for scheduled re-crawl
        )
        session.add(source)
        await session.commit()
        await session.refresh(source)
        source_id: int = source.id

    logger.info("Created search source %d: %s", source_id, source_name)

    await _broadcast(SSEEvent(
        type="crawl_status",
        data={"source_id": source_id, "status": "crawling"},
    ))

    try:
        # ── Step 2: Discover URLs ─────────────────────────────────────────────
        discovered = await discover_job_urls(role, experience, location)

        if not discovered:
            logger.warning("No URLs discovered for search: %s", source_name)
            async with async_session_factory() as session:
                await _set_source_status(session, source_id, "done")
            await _broadcast(SSEEvent(
                type="crawl_complete",
                data={"source_id": source_id, "jobs_found": 0, "provider": "n/a"},
            ))
            return

        # Take top 12 URLs for broader coverage
        urls_to_crawl = discovered[:12]
        urls_total = len(urls_to_crawl)

        await _broadcast(SSEEvent(
            type="search_progress",
            data={
                "source_id": source_id,
                "urls_total": urls_total,
                "urls_crawled": 0,
                "jobs_found_so_far": 0,
            },
        ))

        # ── Step 3-5: Crawl + extract (semaphore=2 for moderate parallelism)
        sem = asyncio.Semaphore(2)
        urls_crawled = 0
        total_new_jobs = 0
        total_extracted = 0
        provider_used = "n/a"

        async def _process_url(url_info: dict) -> None:
            nonlocal urls_crawled, total_new_jobs, total_extracted, provider_used

            url = url_info["url"]
            title = url_info.get("title", "")
            snippet = url_info.get("snippet", "")
            async with sem:
                try:
                    extracted: list[ExtractedJob] = []
                    provider = "none"

                    # Try AI extraction first
                    try:
                        markdown = await _crawl_url(url)

                        if markdown.strip():
                            url_criteria = (
                                f"{criteria}\n"
                                f"Source page URL: {url}\n"
                                f"Page title: {title}\n"
                                f"If a job has no direct application link, use '{url}' as the application_link."
                            )
                            extracted, provider = await extract_jobs_with_ai(markdown, url_criteria)
                            provider_used = provider

                            # Fix empty application_links
                            for job in extracted:
                                if not job.application_link.strip():
                                    job.application_link = url
                    except Exception as ai_exc:
                        logger.warning("AI extraction failed for %s: %s", url, ai_exc)

                    # Fallback: if AI returned nothing, create a listing from the search metadata
                    if not extracted and title:
                        # Parse company name from title (e.g. "Software Engineer at Google" -> "Google")
                        company = "Unknown"
                        for sep in [" at ", " - ", " | ", " — ", " · "]:
                            if sep in title:
                                parts = title.split(sep)
                                company = parts[-1].strip()[:60]
                                break

                        # Parse location from snippet
                        loc = location or ""

                        fallback_job = ExtractedJob(
                            company_name=company,
                            job_title=title[:120],
                            application_link=url,
                            experience_required=experience if experience != "Any" else "",
                            location=loc,
                            is_agency=False,
                        )
                        extracted = [fallback_job]
                        provider = "fallback"
                        provider_used = "fallback"

                    total_extracted += len(extracted)
                    logger.info(
                        "(%s) got %d jobs from %s",
                        provider, len(extracted), url,
                    )


                    # Deduplicate + insert
                    async with async_session_factory() as session:
                        new_jobs = await _deduplicate_and_insert(
                            session, source_id, extracted, search_label=source_name,
                        )

                    # Broadcast each new job
                    for job in new_jobs:
                        await _broadcast(SSEEvent(
                            type="new_job",
                            data={"source_id": source_id, **job},
                        ))

                    total_new_jobs += len(new_jobs)

                except Exception as exc:
                    logger.warning("Failed to process %s: %s", url, exc)

                finally:
                    urls_crawled += 1
                    # Progress event
                    await _broadcast(SSEEvent(
                        type="search_progress",
                        data={
                            "source_id": source_id,
                            "urls_total": urls_total,
                            "urls_crawled": urls_crawled,
                            "jobs_found_so_far": total_new_jobs,
                        },
                    ))

        # Launch all tasks with a 90s global timeout (12 URLs, sequential)
        try:
            async with asyncio.timeout(90):
                tasks = [asyncio.create_task(_process_url(u)) for u in urls_to_crawl]
                await asyncio.gather(*tasks, return_exceptions=True)
        except TimeoutError:
            logger.warning("Search timed out after 90s for source %d", source_id)

        # ── Step 6: Finalise ──────────────────────────────────────────────────
        async with async_session_factory() as session:
            await _set_source_status(session, source_id, "done")

        await _broadcast(SSEEvent(
            type="crawl_complete",
            data={
                "source_id": source_id,
                "jobs_found": total_new_jobs,
                "total_extracted": total_extracted,
                "provider": provider_used,
            },
        ))
        logger.info(
            "Search complete for source %d (%s): %d new / %d extracted from %d URLs",
            source_id, source_name, total_new_jobs, total_extracted, urls_crawled,
        )

        # ── LRU eviction: keep max 100 jobs, delete oldest ────────────────────
        async with async_session_factory() as session:
            count_result = await session.execute(select(func.count(JobListing.id)))
            total_count = count_result.scalar_one()
            if total_count > 100:
                excess = total_count - 100
                oldest = await session.execute(
                    select(JobListing.id)
                    .order_by(JobListing.discovered_at.asc())
                    .limit(excess)
                )
                old_ids = [row[0] for row in oldest.all()]
                if old_ids:
                    from sqlalchemy import delete as sa_delete
                    await session.execute(
                        sa_delete(JobListing).where(JobListing.id.in_(old_ids))
                    )
                    await session.commit()
                    logger.info("LRU eviction: removed %d oldest jobs (total was %d)", len(old_ids), total_count)

    except Exception as exc:
        logger.exception("Search failed for source %d: %s", source_id, exc)
        try:
            async with async_session_factory() as session:
                await _set_source_status(session, source_id, "failed")
        except Exception:
            pass
        await _broadcast(SSEEvent(
            type="error",
            data={"source_id": source_id, "error": str(exc)},
        ))
