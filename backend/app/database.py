"""
EmploySure — Database layer (async SQLAlchemy 2.0 + aiosqlite)
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import AsyncGenerator

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    select,
    func,
)
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, relationship

from app.config import get_settings

logger = logging.getLogger(__name__)

# ─── Engine & session factory ─────────────────────────────────────────────────
_settings = get_settings()

engine = create_async_engine(
    _settings.database_url,
    echo=False,
    connect_args={"check_same_thread": False} if "sqlite" in _settings.database_url else {},
)

async_session_factory = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


# ─── Base ─────────────────────────────────────────────────────────────────────
class Base(DeclarativeBase):
    pass


# ─── ORM models ──────────────────────────────────────────────────────────────
class TargetSource(Base):
    __tablename__ = "target_sources"

    id: int = Column(Integer, primary_key=True, autoincrement=True)
    url: str = Column(Text, unique=True, nullable=False)
    source_name: str = Column(String(255), nullable=False)
    is_active: bool = Column(Boolean, default=True, nullable=False)
    last_crawled_at: datetime | None = Column(DateTime(timezone=True), nullable=True)
    status: str = Column(String(50), default="idle", nullable=False)
    criteria: str | None = Column(Text, nullable=True)

    jobs = relationship("JobListing", back_populates="source", cascade="all, delete-orphan")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "url": self.url,
            "source_name": self.source_name,
            "is_active": self.is_active,
            "last_crawled_at": self.last_crawled_at.isoformat() if self.last_crawled_at else None,
            "status": self.status,
            "criteria": self.criteria,
        }


class JobListing(Base):
    __tablename__ = "job_listings"

    id: int = Column(Integer, primary_key=True, autoincrement=True)
    source_id: int = Column(Integer, ForeignKey("target_sources.id", ondelete="CASCADE"), nullable=False)
    company_name: str = Column(String(255), nullable=False)
    job_title: str = Column(String(255), nullable=False)
    application_link: str = Column(Text, unique=True, nullable=False)
    experience_required: str = Column(String(100), nullable=True, default="")
    location: str = Column(String(255), nullable=True, default="")
    salary: str = Column(String(255), nullable=True, default="")
    search_label: str = Column(String(255), nullable=True, default="")
    is_relevant: bool = Column(Boolean, default=True, nullable=False)
    is_agency: bool = Column(Boolean, default=False, nullable=False)
    discovered_at: datetime = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    last_verified_at: datetime = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    link_alive: bool = Column(Boolean, default=True, nullable=False)

    source = relationship("TargetSource", back_populates="jobs")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "source_id": self.source_id,
            "company_name": self.company_name,
            "job_title": self.job_title,
            "application_link": self.application_link,
            "experience_required": self.experience_required,
            "location": self.location,
            "salary": self.salary,
            "search_label": self.search_label or "",
            "is_relevant": self.is_relevant,
            "is_agency": self.is_agency,
            "discovered_at": self.discovered_at.isoformat() if self.discovered_at else None,
            "last_verified_at": self.last_verified_at.isoformat() if self.last_verified_at else None,
            "link_alive": self.link_alive,
        }


# ─── Pre-configured sources ──────────────────────────────────────────────────
DEFAULT_SOURCES = [
    {
        "url": "https://github.com/SimplifyJobs/New-Grad-Positions",
        "source_name": "SimplifyJobs - New Grad",
    },
    {
        "url": "https://github.com/SimplifyJobs/Summer2025-Internships",
        "source_name": "SimplifyJobs - Internships",
    },
    {
        "url": "https://github.com/pittcsc/Summer2025-Internships",
        "source_name": "PittCSC - Internships",
    },
    {
        "url": "https://remoteok.com/remote-dev-jobs",
        "source_name": "RemoteOK - Dev Jobs",
    },
]


# ─── Dependency helper ────────────────────────────────────────────────────────
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields an async session."""
    async with async_session_factory() as session:
        try:
            yield session
        finally:
            await session.close()


# ─── Initialisation ──────────────────────────────────────────────────────────
async def init_db() -> None:
    """Create all tables (if they don't exist)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables ensured.")


async def seed_default_sources() -> None:
    """Insert pre-configured sources if the table is empty."""
    async with async_session_factory() as session:
        result = await session.execute(select(func.count(TargetSource.id)))
        count = result.scalar_one()
        if count > 0:
            logger.info("Sources table already populated (%d rows) — skipping seed.", count)
            return

        for src in DEFAULT_SOURCES:
            session.add(TargetSource(url=src["url"], source_name=src["source_name"]))
        await session.commit()
        logger.info("Seeded %d default sources.", len(DEFAULT_SOURCES))
