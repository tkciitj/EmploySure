"""
EmploySure — Meta-Search Engine
Uses DuckDuckGo (ddgs) to discover job listing URLs automatically
from a role, experience level, and location.
"""

from __future__ import annotations

import asyncio
import logging
from urllib.parse import urlparse

from ddgs import DDGS

logger = logging.getLogger(__name__)

# ─── Domains to EXCLUDE (not job listings) ────────────────────────────────────
_BLOCKED_DOMAINS: set[str] = {
    "youtube.com",
    "reddit.com",
    "quora.com",
    "wikipedia.org",
    "facebook.com",
    "twitter.com",
    "instagram.com",
    "tiktok.com",
    "pinterest.com",
    "medium.com",
    "glassdoor.com",
}

# ─── High-priority ATS / job-board domains (sorted first) ────────────────────
_ATS_DOMAINS: set[str] = {
    "greenhouse.io",
    "lever.co",
    "myworkdayjobs.com",
    "icims.com",
    "smartrecruiters.com",
    "ashbyhq.com",
    "indeed.com",
    "wellfound.com",
    "remoteok.com",
    "weworkremotely.com",
    "angel.co",
}

# Substrings in the URL path that strongly hint at a careers / job page
_CAREER_PATH_HINTS: tuple[str, ...] = (
    "/careers",
    "/jobs",
    "/job/",
    "/positions",
    "/openings",
    "/apply",
    "/vacancy",
    "/vacancies",
    "/hiring",
)

# ─── Experience-level mapping ─────────────────────────────────────────────────
_EXPERIENCE_MAP: dict[str, str] = {
    "Intern/Fresher": "intern OR fresher OR new grad",
    "Entry Level (0-2 yrs)": "entry level OR junior OR new grad",
    "Mid Level (3-5 yrs)": "mid level OR 3+ years",
    "Senior (5+ yrs)": "senior OR lead OR staff",
}


def _experience_query_fragment(experience: str) -> str:
    """Return a search-query fragment for the given experience level."""
    if not experience or experience.strip().lower() == "any":
        return ""
    return _EXPERIENCE_MAP.get(experience, experience)


def _build_queries(role: str, experience: str, location: str) -> list[str]:
    """Generate 5-6 targeted search queries to maximise job-posting coverage."""
    exp_frag = _experience_query_fragment(experience)
    queries: list[str] = []

    # 1. General careers
    q1 = f'"{role}" apply now careers'
    if location:
        q1 = f'"{role}" "{location}" apply now careers'
    queries.append(q1)

    # 2. ATS-specific
    q2 = f'"{role}" site:greenhouse.io OR site:lever.co'
    if location:
        q2 = f'"{role}" "{location}" site:greenhouse.io OR site:lever.co'
    queries.append(q2)

    # 3. Broad job search
    q3 = f'"{role}" jobs apply'
    if location:
        q3 = f'"{role}" {location} jobs apply'
    if exp_frag:
        q3 += f" {exp_frag}"
    queries.append(q3)

    # 4. Recent openings
    q4 = f'"{role}" careers openings 2025 2026'
    if location:
        q4 = f'"{role}" "{location}" careers openings 2025 2026'
    queries.append(q4)

    # 5. Hiring urgency
    q5 = f'"{role}" hiring now'
    if location:
        q5 = f'"{role}" "{location}" hiring now'
    queries.append(q5)

    # 6. LinkedIn jobs
    q6 = f'site:linkedin.com/jobs "{role}"'
    if location:
        q6 += f' "{location}"'
    queries.append(q6)

    # 7. Indeed / Wellfound / Naukri
    q7 = f'"{role}" site:indeed.com OR site:wellfound.com'
    if location:
        q7 += f' "{location}"'
    queries.append(q7)

    # 8. Remote-specific (only when applicable)
    is_remote = (not location) or location.strip().lower() in ("remote", "")
    if is_remote:
        q8 = f'"{role}" remote apply site:remoteok.com OR site:weworkremotely.com'
        queries.append(q8)

    return queries


def _normalise_domain(url: str) -> str:
    """Return the effective domain without 'www.' prefix."""
    try:
        host = urlparse(url).hostname or ""
        return host.removeprefix("www.").lower()
    except Exception:
        return ""


def _is_blocked(url: str) -> bool:
    """Return True if the URL belongs to a blocked domain."""
    domain = _normalise_domain(url)
    return any(domain == bd or domain.endswith(f".{bd}") for bd in _BLOCKED_DOMAINS)


def _domain_path_key(url: str) -> str:
    """Return domain+path as a dedup key (ignoring query string / fragment)."""
    try:
        parsed = urlparse(url)
        return f"{(parsed.hostname or '').removeprefix('www.').lower()}{parsed.path.rstrip('/')}"
    except Exception:
        return url


def _relevance_score(url: str) -> int:
    """Lower score = higher relevance. ATS sites first, then career pages."""
    domain = _normalise_domain(url)
    path = urlparse(url).path.lower()

    # Tier 0 – ATS / major job boards
    if any(domain == ats or domain.endswith(f".{ats}") for ats in _ATS_DOMAINS):
        return 0
    # Tier 0.5 – LinkedIn jobs
    if "linkedin.com" in domain and "/jobs" in path:
        return 0
    # Tier 1 – career / jobs path on company sites
    if any(hint in path for hint in _CAREER_PATH_HINTS):
        return 1
    # Tier 1.5 – subdomain like careers.* or jobs.*
    if domain.startswith("careers.") or domain.startswith("jobs."):
        return 1
    # Tier 2 – everything else that passed the filter
    return 2


def _run_single_query_sync(query: str, max_results: int = 8) -> list[dict]:
    """Execute one DuckDuckGo text search synchronously."""
    try:
        ddgs = DDGS()
        results = ddgs.text(query, max_results=max_results)
        return results if results else []
    except Exception as exc:
        logger.warning("Search query failed (%s): %s", query[:80], exc)
        return []


async def _run_single_query(query: str, max_results: int = 8) -> list[dict]:
    """Run DuckDuckGo search in a thread to keep the event loop responsive."""
    try:
        async with asyncio.timeout(15):
            return await asyncio.to_thread(_run_single_query_sync, query, max_results)
    except Exception as exc:
        logger.warning("Search query timed out or failed (%s): %s", query[:80], exc)
        return []


async def discover_job_urls(
    role: str,
    experience: str,
    location: str,
    max_results: int = 30,
) -> list[dict]:
    """
    Discover job-listing URLs by running multiple targeted DuckDuckGo queries
    concurrently, then deduplicating, filtering, and ranking the results.

    Returns a list of dicts: [{url, title, snippet}], sorted by relevance.
    """
    queries = _build_queries(role, experience, location)
    logger.info(
        "Discovering job URLs for role=%r exp=%r loc=%r — %d queries",
        role, experience, location, len(queries),
    )

    # Run all queries concurrently (each in its own thread)
    all_results_nested = await asyncio.gather(
        *[_run_single_query(q) for q in queries],
        return_exceptions=True,
    )

    # Flatten + deduplicate
    seen_keys: set[str] = set()
    unique_results: list[dict] = []

    for batch in all_results_nested:
        if isinstance(batch, BaseException):
            logger.warning("Query returned exception: %s", batch)
            continue
        for item in batch:
            url = item.get("href") or item.get("url", "")
            if not url:
                continue
            # Filter blocked domains
            if _is_blocked(url):
                continue
            # Deduplicate by domain+path
            key = _domain_path_key(url)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            unique_results.append({
                "url": url,
                "title": item.get("title", ""),
                "snippet": item.get("body", item.get("snippet", "")),
            })

    # Sort by relevance tier
    unique_results.sort(key=lambda r: _relevance_score(r["url"]))

    # Cap to max_results
    unique_results = unique_results[:max_results]

    logger.info("Discovered %d unique job URLs (from %d queries)", len(unique_results), len(queries))
    return unique_results
