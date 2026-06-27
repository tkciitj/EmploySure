"""
EmploySure — Pydantic v2 request / response schemas
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, HttpUrl, field_validator


# ═══════════════════════════════════════════════════════════════════════════════
# Source schemas
# ═══════════════════════════════════════════════════════════════════════════════
class SourceCreate(BaseModel):
    """POST /api/sources request body."""
    url: str = Field(..., min_length=5, description="URL to scrape")
    source_name: str = Field(..., min_length=1, max_length=255)
    criteria: str | None = Field(default=None, description="Optional filtering criteria for the AI")

    @field_validator("url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        v = v.strip()
        if not v.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        return v


class SourceResponse(BaseModel):
    id: int
    url: str
    source_name: str
    is_active: bool
    last_crawled_at: str | None = None
    status: str
    criteria: str | None = None


# ═══════════════════════════════════════════════════════════════════════════════
# Job schemas
# ═══════════════════════════════════════════════════════════════════════════════
class JobResponse(BaseModel):
    id: int
    source_id: int
    company_name: str
    job_title: str
    application_link: str
    experience_required: str = ""
    location: str = ""
    salary: str = ""
    search_label: str = ""
    is_relevant: bool = True
    is_agency: bool = False
    discovered_at: str | None = None
    last_verified_at: str | None = None
    link_alive: bool = True


class JobListResponse(BaseModel):
    jobs: list[JobResponse]
    total: int
    page: int
    per_page: int
    total_pages: int


class ExtractedJob(BaseModel):
    """Schema returned by the AI filter for a single job."""
    company_name: str = Field(default="Unknown")
    job_title: str = Field(default="Unknown")
    application_link: str = Field(default="")
    experience_required: str = Field(default="")
    location: str = Field(default="")
    salary: str = Field(default="")
    is_agency: bool = Field(default=False)

    @field_validator("application_link")
    @classmethod
    def normalise_link(cls, v: str) -> str:
        return v.strip()


# ═══════════════════════════════════════════════════════════════════════════════
# Scrape schemas
# ═══════════════════════════════════════════════════════════════════════════════
class ScrapeRequest(BaseModel):
    source_id: int


class ScrapeResponse(BaseModel):
    message: str
    source_id: int


class SearchRequest(BaseModel):
    """POST /api/search request body."""
    role: str = Field(..., min_length=2, description="Job role to search for")
    experience: str = Field(default="Any", description="Experience level filter")
    location: str = Field(default="", description="Location preference")


# ═══════════════════════════════════════════════════════════════════════════════
# Stats
# ═══════════════════════════════════════════════════════════════════════════════
class StatsResponse(BaseModel):
    total_jobs: int
    active_sources: int
    jobs_today: int
    last_crawl_time: str | None = None


# ═══════════════════════════════════════════════════════════════════════════════
# SSE events
# ═══════════════════════════════════════════════════════════════════════════════
class SSEEvent(BaseModel):
    type: Literal["new_job", "crawl_status", "crawl_complete", "search_progress", "error"]
    data: dict[str, Any]


# ═══════════════════════════════════════════════════════════════════════════════
# Resume analysis
# ═══════════════════════════════════════════════════════════════════════════════
class ResumeAnalysisResponse(BaseModel):
    """Response from POST /api/resume/analyze."""
    skills: list[str] = Field(default_factory=list)
    experience_level: str = Field(default="Any")
    suggested_roles: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    summary: str = Field(default="")
    provider: str = Field(default="none")


# ═══════════════════════════════════════════════════════════════════════════════
# Email generation
# ═══════════════════════════════════════════════════════════════════════════════
class GenerateEmailRequest(BaseModel):
    job_title: str
    company_name: str
    resume_text: str
    intent: str = Field(default="", description="User intent/tone/feedback for email customization")

class GenerateEmailResponse(BaseModel):
    subject: str
    body: str


class FindContactsRequest(BaseModel):
    company_name: str
    job_title: str

class ContactSuggestion(BaseModel):
    name: str = ""
    role: str = ""
    email: str = ""

class FindContactsResponse(BaseModel):
    contacts: list[ContactSuggestion]
    note: str = ""


# ═══════════════════════════════════════════════════════════════════════════════
# Bulk Email
# ═══════════════════════════════════════════════════════════════════════════════

class BulkEmailEntry(BaseModel):
    id: str
    recipient_email: str
    company_name: str
    job_title: str
    intent: str = ""
    resume_text: str = ""
    subject: str = ""
    body: str = ""
    status: str = "draft"  # draft | approved | sending | sent | failed
    action: str = "send"   # send | schedule
    error: str = ""

class BulkEmailRequest(BaseModel):
    entries: list[BulkEmailEntry]
    sender_email: str
    sender_app_password: str

class BulkEmailResult(BaseModel):
    id: str
    status: str  # sent | failed
    error: str = ""

class BulkEmailResponse(BaseModel):
    results: list[BulkEmailResult]
    total_sent: int = 0
    total_failed: int = 0
