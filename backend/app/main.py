"""
EmploySure — FastAPI application entry-point
All API routes, SSE streaming, CORS, lifespan management.
"""

from __future__ import annotations

import asyncio
import logging
import math
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from typing import AsyncGenerator

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, or_, desc, asc
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import (
    JobListing,
    TargetSource,
    async_session_factory,
    get_db,
    init_db,
    seed_default_sources,
)
from app.models import (
    JobListResponse,
    JobResponse,
    ScrapeRequest,
    ScrapeResponse,
    SearchRequest,
    SourceCreate,
    SourceResponse,
    StatsResponse,
    GenerateEmailRequest,
    GenerateEmailResponse,
    FindContactsRequest,
    FindContactsResponse,
    BulkEmailRequest,
    BulkEmailResponse,
)
from app.agent import scrape_source, search_and_scrape, subscribe_sse, unsubscribe_sse
from app.ai_filter import generate_cold_email, find_suggested_contacts
from app.scheduler import start_scheduler, stop_scheduler

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)


# ─── Lifespan ─────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Startup / shutdown lifecycle hook."""
    logger.info("EmploySure backend starting up…")
    await init_db()
    await seed_default_sources()
    start_scheduler()
    yield
    stop_scheduler()
    logger.info("EmploySure backend shut down.")


# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="EmploySure API",
    version="1.0.0",
    description="AI-powered real-time job scraping backend",
    lifespan=lifespan,
)

settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.frontend_url,
        "https://www.employsure.publicvm.com",
        "https://employsure.publicvm.com",
        "https://employsure-app.onrender.com"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ═══════════════════════════════════════════════════════════════════════════════
# SOURCES
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/api/sources", response_model=SourceResponse, status_code=201)
async def add_source(
    body: SourceCreate,
    db: AsyncSession = Depends(get_db),
) -> SourceResponse:
    """Add a new scraping target."""
    # Check for duplicate URL
    existing = await db.execute(
        select(TargetSource).where(TargetSource.url == body.url)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Source URL already exists.")

    source = TargetSource(
        url=body.url,
        source_name=body.source_name,
        criteria=body.criteria,
    )
    db.add(source)
    await db.commit()
    await db.refresh(source)
    return SourceResponse(**source.to_dict())


@app.get("/api/sources", response_model=list[SourceResponse])
async def list_sources(
    db: AsyncSession = Depends(get_db),
) -> list[SourceResponse]:
    """List all scraping sources with their current status."""
    result = await db.execute(select(TargetSource).order_by(TargetSource.id))
    sources = result.scalars().all()
    return [SourceResponse(**s.to_dict()) for s in sources]


@app.delete("/api/sources/{source_id}", status_code=204)
async def delete_source(
    source_id: int,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Remove a source and its associated job listings."""
    result = await db.execute(
        select(TargetSource).where(TargetSource.id == source_id)
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found.")
    await db.delete(source)
    await db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# SCRAPE
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/api/scrape", response_model=ScrapeResponse)
async def trigger_scrape(
    body: ScrapeRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> ScrapeResponse:
    """Trigger a scrape for a specific source (runs in the background)."""
    result = await db.execute(
        select(TargetSource).where(TargetSource.id == body.source_id)
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found.")
    if source.status == "crawling":
        raise HTTPException(status_code=409, detail="Source is already being crawled.")

    background_tasks.add_task(scrape_source, body.source_id)
    return ScrapeResponse(
        message="Scrape started in background.",
        source_id=body.source_id,
    )


@app.post("/api/search", response_model=ScrapeResponse)
async def search_jobs(
    body: SearchRequest,
    background_tasks: BackgroundTasks,
) -> ScrapeResponse:
    """Search for jobs by role, experience, and location. Discovers URLs automatically."""
    background_tasks.add_task(
        search_and_scrape,
        role=body.role,
        experience=body.experience,
        location=body.location,
    )
    return ScrapeResponse(
        message=f"Search started for '{body.role}' jobs.",
        source_id=0,  # Will be assigned during execution
    )


# ═══════════════════════════════════════════════════════════════════════════════
# JOBS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/jobs", response_model=JobListResponse)
async def list_jobs(
    search: str | None = Query(default=None, description="Search company or title"),
    experience: str | None = Query(default=None),
    location: str | None = Query(default=None),
    hide_agency: bool = Query(default=False),
    sort_by: str = Query(default="discovered_at", description="Sort field"),
    sort_dir: str = Query(default='desc', description='Sort direction: asc or desc'),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> JobListResponse:
    """List jobs with filtering, search, and pagination."""
    query = select(JobListing).where(JobListing.is_relevant == True)  # noqa: E712

    # Filters
    if search:
        pattern = f"%{search}%"
        query = query.where(
            or_(
                JobListing.company_name.ilike(pattern),
                JobListing.job_title.ilike(pattern),
            )
        )
    if experience:
        query = query.where(JobListing.experience_required.ilike(f"%{experience}%"))
    if location:
        query = query.where(JobListing.location.ilike(f"%{location}%"))
    if hide_agency:
        query = query.where(JobListing.is_agency == False)  # noqa: E712

    # Count total before pagination
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    # Sorting
    sort_column = getattr(JobListing, sort_by, JobListing.discovered_at)
    if sort_dir == 'desc':
        query = query.order_by(desc(sort_column))
    else:
        query = query.order_by(asc(sort_column))

    # Pagination
    offset = (page - 1) * per_page
    query = query.offset(offset).limit(per_page)

    result = await db.execute(query)
    listings = result.scalars().all()

    return JobListResponse(
        jobs=[JobResponse(**j.to_dict()) for j in listings],
        total=total,
        page=page,
        per_page=per_page,
        total_pages=max(1, math.ceil(total / per_page)),
    )


@app.patch("/api/jobs/{job_id}/hide")
async def toggle_hide_job(
    job_id: int,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Toggle the is_relevant flag (hide / unhide a listing)."""
    result = await db.execute(
        select(JobListing).where(JobListing.id == job_id)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job listing not found.")
    job.is_relevant = not job.is_relevant
    await db.commit()
    await db.refresh(job)
    return {"id": job.id, "is_relevant": job.is_relevant}


@app.delete("/api/jobs")
async def clear_all_jobs(
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Delete all job listings and reset the table."""
    result = await db.execute(select(func.count(JobListing.id)))
    total = result.scalar_one()
    await db.execute(select(JobListing).execution_options(synchronize_session="fetch"))
    from sqlalchemy import delete
    await db.execute(delete(JobListing))
    await db.commit()
    return {"message": f"Cleared {total} job listings.", "deleted": total}


# ═══════════════════════════════════════════════════════════════════════════════
# SSE — real-time job stream
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/jobs/stream")
async def job_stream(request: Request) -> StreamingResponse:
    """SSE endpoint for real-time job updates during scraping."""

    async def _event_generator() -> AsyncGenerator[str, None]:
        queue = await subscribe_sse()
        try:
            # Send initial keep-alive
            yield "event: connected\ndata: {}\n\n"
            while True:
                # Check if client disconnected
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield msg
                except asyncio.TimeoutError:
                    # Send heartbeat to keep the connection alive
                    yield ": heartbeat\n\n"
        finally:
            await unsubscribe_sse(queue)

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ═══════════════════════════════════════════════════════════════════════════════
# STATS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/stats", response_model=StatsResponse)
async def get_stats(
    db: AsyncSession = Depends(get_db),
) -> StatsResponse:
    """Return dashboard statistics."""
    # Total jobs (alive & relevant)
    total_result = await db.execute(
        select(func.count(JobListing.id)).where(
            JobListing.link_alive == True,  # noqa: E712
            JobListing.is_relevant == True,  # noqa: E712
        )
    )
    total_jobs = total_result.scalar_one()

    # Active sources
    active_result = await db.execute(
        select(func.count(TargetSource.id)).where(
            TargetSource.is_active == True  # noqa: E712
        )
    )
    active_sources = active_result.scalar_one()

    # Jobs discovered today (UTC)
    today_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    today_result = await db.execute(
        select(func.count(JobListing.id)).where(
            JobListing.discovered_at >= today_start
        )
    )
    jobs_today = today_result.scalar_one()

    # Last crawl time across all sources
    last_crawl_result = await db.execute(
        select(func.max(TargetSource.last_crawled_at))
    )
    last_crawl = last_crawl_result.scalar_one()

    return StatsResponse(
        total_jobs=total_jobs,
        active_sources=active_sources,
        jobs_today=jobs_today,
        last_crawl_time=last_crawl.isoformat() if last_crawl else None,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# RESUME ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/api/resume/analyze")
async def analyze_resume_endpoint(
    file: UploadFile = File(...),
):
    """Upload a PDF resume and get AI-analyzed skills/roles."""
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    contents = await file.read()
    if len(contents) > 10_000_000:  # 10MB limit
        raise HTTPException(status_code=400, detail="File too large. Max 10MB.")

    from app.resume_parser import analyze_resume
    result = await analyze_resume(contents)
    return result


# ═══════════════════════════════════════════════════════════════════════════════
# EMAIL GENERATION
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/api/generate-email", response_model=GenerateEmailResponse)
async def api_generate_email(request: GenerateEmailRequest):
    try:
        return await generate_cold_email(request)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/find-contacts", response_model=FindContactsResponse)
async def api_find_contacts(request: FindContactsRequest):
    try:
        result = await find_suggested_contacts(request.company_name, request.job_title)
        return FindContactsResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/resume/extract-text")
async def extract_resume_text(file: UploadFile = File(...)):
    """Upload a PDF and return just the extracted text."""
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    contents = await file.read()
    if len(contents) > 10_000_000:
        raise HTTPException(status_code=400, detail="File too large. Max 10MB.")
    from app.resume_parser import extract_text_from_pdf
    text = await extract_text_from_pdf(contents)
    return {"text": text}


# ═══════════════════════════════════════════════════════════════════════════════
# BULK EMAIL
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/api/bulk-send", response_model=BulkEmailResponse)
async def api_bulk_send(request: BulkEmailRequest):
    """Send/schedule a batch of approved emails via Gmail SMTP."""
    from app.email_sender import send_bulk_emails
    try:
        approved = [e for e in request.entries if e.status == "approved"]
        if not approved:
            raise HTTPException(status_code=400, detail="No approved emails to send.")
        results = await send_bulk_emails(
            entries=approved,
            sender_email=request.sender_email,
            sender_password=request.sender_app_password,
        )
        sent = sum(1 for r in results if r.status == "sent")
        failed = sum(1 for r in results if r.status == "failed")
        return BulkEmailResponse(results=results, total_sent=sent, total_failed=failed)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════════════════════
# Health
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/health")
async def health() -> dict:
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "ai_providers": {
            "gemini": settings.has_gemini,
            "groq": settings.has_groq,
        },
    }


# ─── CLI entry-point ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.backend_host,
        port=settings.backend_port,
        reload=True,
    )
