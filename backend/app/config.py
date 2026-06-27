"""
EmploySure — Application Configuration
Loads all settings from environment variables / .env file.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings

# ---------------------------------------------------------------------------
# Locate the .env that sits next to the `app/` package (i.e. backend/.env)
# ---------------------------------------------------------------------------
_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_ENV_PATH, override=False)


class Settings(BaseSettings):
    """Typed application settings – validated on startup."""

    # ── AI providers ──────────────────────────────────────────────────────
    gemini_api_key: str = Field(default="", alias="GEMINI_API_KEY")
    groq_api_key: str = Field(default="", alias="GROQ_API_KEY")
    ollama_base_url: str = Field(
        default="http://localhost:11434", alias="OLLAMA_BASE_URL"
    )
    ollama_model: str = Field(default="llama3.1", alias="OLLAMA_MODEL")

    # ── Database ──────────────────────────────────────────────────────────
    database_url: str = Field(
        default="sqlite+aiosqlite:///./employsure.db", alias="DATABASE_URL"
    )

    # ── Scheduler ─────────────────────────────────────────────────────────
    recrawl_interval_hours: float = Field(
        default=1.0, alias="RECRAWL_INTERVAL_HOURS"
    )
    verify_links_interval_hours: float = Field(
        default=6.0, alias="VERIFY_LINKS_INTERVAL_HOURS"
    )
    scheduler_initial_delay_seconds: int = Field(
        default=60, alias="SCHEDULER_INITIAL_DELAY_SECONDS"
    )

    # ── Server ────────────────────────────────────────────────────────────
    backend_host: str = Field(default="0.0.0.0", alias="BACKEND_HOST")
    backend_port: int = Field(default=8000, alias="BACKEND_PORT")
    frontend_url: str = Field(
        default="http://localhost:5173", alias="FRONTEND_URL"
    )

    # ── AI model names ────────────────────────────────────────────────────
    gemini_model: str = Field(
        default="gemini-2.5-flash", alias="GEMINI_MODEL"
    )
    groq_model: str = Field(
        default="llama-3.1-8b-instant", alias="GROQ_MODEL"
    )

    model_config = {
        "env_file": str(_ENV_PATH),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
        "populate_by_name": True,
    }

    # ── helpers ────────────────────────────────────────────────────────────
    @property
    def has_gemini(self) -> bool:
        return bool(self.gemini_api_key)

    @property
    def has_groq(self) -> bool:
        return bool(self.groq_api_key)

    @property
    def has_any_ai(self) -> bool:
        return self.has_gemini or self.has_groq  # Ollama is always "available"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached singleton of the application settings."""
    return Settings()
