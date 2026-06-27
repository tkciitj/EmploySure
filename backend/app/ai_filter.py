"""
EmploySure — Multi-provider AI filter
Extracts structured job data from raw crawled markdown.

Provider cascade (Groq first for speed + quota):
  1. Groq Llama 3.3 70B       (groq SDK — fast, high quota)
  2. Google Gemini 2.0 Flash   (google-genai SDK)
  3. Ollama local              (httpx → localhost:11434)
  4. No-AI passthrough         (returns empty list + warning)
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

import httpx

from app.config import Settings, get_settings
from app.models import ExtractedJob, GenerateEmailRequest, GenerateEmailResponse

logger = logging.getLogger(__name__)

# ─── Shared prompt ────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are an expert job-listing extractor. You will receive raw markdown scraped from \
a webpage. Your task is to extract ONLY genuine job listings from the content.

RULES:
1. Extract these fields for each job: company_name, job_title, application_link, \
experience_required (e.g. "0-2 years", "Entry Level", "Senior", or "" if unknown), \
location (city/state/country or "Remote", or "" if unknown), \
salary (e.g. "$120K-$180K", "$50/hr", "₹15-25 LPA", or "" if not mentioned), \
is_agency (true if the listing appears to be from a staffing/recruitment agency, false otherwise).
2. DISCARD anything that is NOT a real job posting:
   - Course advertisements or boot-camp promotions
   - Resume-writing / career-coaching services
   - MLM / pyramid scheme opportunities
   - Recruitment agency landing pages with no specific role
   - Aggregator links that redirect to another job board without a specific role
3. For application_link: only include URLs that look like real application pages — \
e.g. Workday, Greenhouse, Lever, iCIMS, Google Forms, or company career pages. \
If a row has no direct application link, use the best link available or leave blank.
4. Flag any listing that appears to be from a staffing/temp agency with is_agency=true.
5. Return ONLY a JSON array of objects. No markdown fences, no explanation, no \
commentary — JUST the raw JSON array.

Example output:
[
  {
    "company_name": "Google",
    "job_title": "Software Engineer, New Grad",
    "application_link": "https://careers.google.com/jobs/12345",
    "experience_required": "Entry Level",
    "location": "Mountain View, CA",
    "salary": "$120K-$180K",
    "is_agency": false
  }
]

If there are NO valid job listings, return an empty array: []
"""


def _build_user_prompt(markdown: str, criteria: str | None = None) -> str:
    parts = ["Extract all valid job listings from the following page content.\n"]
    if criteria:
        parts.append(f"Additional filter criteria from the user: {criteria}\n")
    # Truncate very large pages to avoid token limits (≈120 000 chars ≈ 30k tokens)
    truncated = markdown[:120_000]
    parts.append(f"--- PAGE CONTENT ---\n{truncated}\n--- END ---")
    return "\n".join(parts)


def _parse_ai_response(raw: str) -> list[ExtractedJob]:
    """Parse the raw LLM response into a list of ExtractedJob objects."""
    # Strip markdown code fences if the model wrapped them
    cleaned = raw.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    cleaned = cleaned.strip()

    if not cleaned:
        return []

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        # Try to find the JSON array inside the text
        match = re.search(r"\[.*\]", cleaned, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group())
            except json.JSONDecodeError:
                logger.warning("AI response could not be parsed as JSON.")
                return []
        else:
            logger.warning("No JSON array found in AI response.")
            return []

    if not isinstance(data, list):
        data = [data]

    jobs: list[ExtractedJob] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        try:
            job = ExtractedJob(**item)
            # Skip entries with no useful data
            if not job.application_link and job.company_name == "Unknown":
                continue
            jobs.append(job)
        except Exception:
            logger.debug("Skipping un-parseable item: %s", item)
    return jobs


# ═══════════════════════════════════════════════════════════════════════════════
# Provider 1 — Groq (fast, high free-tier quota: 14,400 req/day)
# ═══════════════════════════════════════════════════════════════════════════════

async def _call_groq(
    markdown: str, criteria: str | None, settings: Settings
) -> list[ExtractedJob]:
    """Call Groq using the async client with a 30-second timeout."""
    from groq import AsyncGroq

    client = AsyncGroq(api_key=settings.groq_api_key)

    # Groq free tier: 6K TPM (cumulative per minute) — keep requests ~3K tokens each
    # System prompt ≈ 1.5K tokens, so content must be ≈ 1.5K tokens ≈ 6K chars
    user_prompt = _build_user_prompt(markdown[:6_000], criteria)

    async with asyncio.timeout(30):
        chat_completion = await client.chat.completions.create(
            model=settings.groq_model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
            max_tokens=4096,
        )
    raw_text = chat_completion.choices[0].message.content or ""
    logger.info("Groq returned %d chars", len(raw_text))
    return _parse_ai_response(raw_text)


# ═══════════════════════════════════════════════════════════════════════════════
# Provider 2 — Google Gemini (google-genai SDK)
# ═══════════════════════════════════════════════════════════════════════════════

async def _call_gemini(
    markdown: str, criteria: str | None, settings: Settings
) -> list[ExtractedJob]:
    """Call Gemini via the google-genai SDK with a 20-second timeout."""
    from google import genai

    client = genai.Client(api_key=settings.gemini_api_key)

    async with asyncio.timeout(20):
        response = await client.aio.models.generate_content(
            model=settings.gemini_model,
            contents=_build_user_prompt(markdown, criteria),
            config=genai.types.GenerateContentConfig(
                system_instruction=_SYSTEM_PROMPT,
                temperature=0.1,
                max_output_tokens=8192,
            ),
        )
    raw_text = response.text or ""
    logger.info("Gemini returned %d chars", len(raw_text))
    return _parse_ai_response(raw_text)


# ═══════════════════════════════════════════════════════════════════════════════
# Provider 3 — Ollama local (OpenAI-compatible API via httpx)
# ═══════════════════════════════════════════════════════════════════════════════

async def _call_ollama(
    markdown: str, criteria: str | None, settings: Settings
) -> list[ExtractedJob]:
    """Call Ollama via its OpenAI-compatible /v1/chat/completions endpoint."""
    base = settings.ollama_base_url.rstrip("/")
    url = f"{base}/v1/chat/completions"

    user_prompt = _build_user_prompt(markdown[:60_000], criteria)
    payload = {
        "model": settings.ollama_model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
        "stream": False,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()

    data = resp.json()
    raw_text = data["choices"][0]["message"]["content"]
    logger.info("Ollama returned %d chars", len(raw_text))
    return _parse_ai_response(raw_text)


# ═══════════════════════════════════════════════════════════════════════════════
# Public API — cascading call with fallback (Groq → Gemini → Ollama)
# ═══════════════════════════════════════════════════════════════════════════════

async def extract_jobs_with_ai(
    markdown: str,
    criteria: str | None = None,
) -> tuple[list[ExtractedJob], str]:
    """
    Run AI extraction with automatic provider fallback.
    Order: Groq (fast) → Gemini → Ollama → none.

    Returns
    -------
    (jobs, provider_used)
        A list of ExtractedJob objects and the name of the provider that
        succeeded (or "none" if all failed).
    """
    settings = get_settings()

    # ── 1. Groq (preferred — fast, high quota) ───────────────────────────
    if settings.has_groq:
        try:
            jobs = await _call_groq(markdown, criteria, settings)
            return jobs, "groq"
        except Exception as exc:
            logger.warning("Groq failed: %s — falling back to Gemini", exc)

    # ── 2. Gemini ─────────────────────────────────────────────────────────
    if settings.has_gemini:
        try:
            jobs = await _call_gemini(markdown, criteria, settings)
            return jobs, "gemini"
        except Exception as exc:
            logger.warning("Gemini failed: %s — falling back to Ollama", exc)

    # ── 3. Ollama ─────────────────────────────────────────────────────────
    try:
        jobs = await _call_ollama(markdown, criteria, settings)
        return jobs, "ollama"
    except Exception as exc:
        logger.warning("Ollama failed: %s — no AI providers available", exc)

    # ── 4. No AI available ────────────────────────────────────────────────
    logger.error(
        "All AI providers failed or are unconfigured. Returning empty results."
    )
    return [], "none"


# ═══════════════════════════════════════════════════════════════════════════════
# Email Generation
# ═══════════════════════════════════════════════════════════════════════════════

def _build_email_system_prompt(intent: str = "") -> str:
    """Build system prompt with optional intent priority block."""
    intent_block = ""
    if intent and intent.strip():
        intent_block = (
            "\n════════════════════════════════════════════\n"
            "PRIORITY #1 — USER INTENT (MANDATORY)\n"
            "════════════════════════════════════════════\n"
            "The user has given specific instructions. You MUST follow them precisely.\n"
            "These instructions OVERRIDE every default behaviour listed below.\n\n"
            f"USER INSTRUCTIONS: {intent.strip()}\n\n"
            "Interpretation rules:\n"
            "- If the user specifies a TONE (casual, formal, funny, witty, etc.), "
            "the ENTIRE email MUST use that tone.\n"
            "- If the user mentions specific SKILLS or topics, ONLY those should be prominent.\n"
            "- If the user requests a specific FORMAT or LENGTH, follow it exactly.\n"
            "- User intent ALWAYS wins over defaults.\n"
            "════════════════════════════════════════════\n"
        )

    return (
        "You are an expert career coach and professional email writer.\n"
        f"{intent_block}\n"
        "DEFAULT GUIDELINES (apply ONLY when they do not conflict with user intent above):\n"
        "- Draft a concise and persuasive cold email to a hiring manager\n"
        "- Open with a compelling, specific hook (NEVER use 'I am writing to express my interest')\n"
        "- Highlight 2-3 specific skills/achievements from the resume that match the role\n"
        "- Show genuine interest in the company — mention something specific about them\n"
        "- End with a clear call-to-action\n"
        "- Be under 200 words for the body\n"
        "- Sound human and authentic, not robotic or templated\n"
        "- Use the applicant's actual name if found in the resume\n\n"
        "Output a JSON object with strictly two keys: \"subject\" and \"body\".\n"
        "The subject should be attention-grabbing and specific.\n"
        "The body should use proper line breaks (\\n) for paragraphs."
    )


async def _generate_email_groq(system_prompt: str, user_prompt: str, settings: Settings) -> dict | None:
    """Try generating email via Groq. Returns dict with subject/body or None."""
    if not settings.has_groq:
        return None
    try:
        from groq import AsyncGroq
        client = AsyncGroq(api_key=settings.groq_api_key)
        async with asyncio.timeout(20):
            chat_completion = await client.chat.completions.create(
                model=settings.groq_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0.7,
            )
        raw_text = chat_completion.choices[0].message.content or "{}"
        return json.loads(raw_text)
    except Exception as e:
        logger.warning("Groq email generation failed: %s", e)
        return None


async def _generate_email_gemini(system_prompt: str, user_prompt: str, settings: Settings) -> dict | None:
    """Try generating email via Gemini. Returns dict with subject/body or None."""
    if not settings.has_gemini:
        return None
    try:
        from google import genai
        client = genai.Client(api_key=settings.gemini_api_key)
        async with asyncio.timeout(20):
            response = await client.aio.models.generate_content(
                model=settings.gemini_model,
                contents=user_prompt + "\n\nRespond with ONLY a JSON object with keys 'subject' and 'body'.",
                config=genai.types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=0.7,
                    max_output_tokens=2048,
                ),
            )
        raw_text = (response.text or "").strip()
        # Strip markdown fences if present
        raw_text = re.sub(r"^```(?:json)?\s*", "", raw_text)
        raw_text = re.sub(r"\s*```$", "", raw_text).strip()
        return json.loads(raw_text)
    except Exception as e:
        logger.warning("Gemini email generation failed: %s", e)
        return None


async def generate_cold_email(request: GenerateEmailRequest) -> GenerateEmailResponse:
    """Generate a cold email using Groq → Gemini → fallback cascade."""
    settings = get_settings()

    system_prompt = _build_email_system_prompt(request.intent)
    user_prompt = (
        f"Job Title: {request.job_title}\n"
        f"Company Name: {request.company_name}\n"
        f"Resume/Skills:\n{request.resume_text[:4000]}"
    )

    fallback_subject = f"Application for {request.job_title} at {request.company_name}"

    # Try Groq first, then Gemini
    data = await _generate_email_groq(system_prompt, user_prompt, settings)
    if not data:
        data = await _generate_email_gemini(system_prompt, user_prompt, settings)

    if data:
        return GenerateEmailResponse(
            subject=data.get("subject", fallback_subject),
            body=data.get("body", "")
        )

    # All providers failed — return a meaningful fallback
    logger.error("All AI providers failed for email generation")
    return GenerateEmailResponse(
        subject=fallback_subject,
        body=(
            f"Dear Hiring Team,\n\n"
            f"I am reaching out regarding the {request.job_title} opportunity at {request.company_name}.\n\n"
            f"[AI generation failed — please write your email manually or check your API keys]\n\n"
            f"Best regards"
        )
    )



def _infer_company_domain(company_name: str) -> str:
    """Deterministically infer a plausible company domain from the name."""
    name = company_name.strip()
    # Strip common corporate suffixes (case-insensitive)
    _SUFFIXES = [
        "Incorporated", "Inc", "Ltd", "Limited", "LLC", "LLP",
        "Corporation", "Corp", "Technologies", "Technology", "Tech",
        "Solutions", "Services", "Consulting", "Group", "Holdings",
        "Enterprises", "Co", "Pvt", "Private",
    ]
    for suffix in _SUFFIXES:
        # Match suffix at the end, optionally preceded/followed by punctuation
        pattern = rf"[\s,.-]*\b{re.escape(suffix)}\b[.,]*$"
        name = re.sub(pattern, "", name, flags=re.IGNORECASE)
    # Collapse to a clean domain slug
    name = name.strip().strip(",.")
    slug = re.sub(r"[^a-zA-Z0-9]+", "", name).lower()
    return f"{slug}.com" if slug else "example.com"


async def find_suggested_contacts(company_name: str, job_title: str) -> dict:
    """Generate standard department email patterns for a company (deterministic, no AI)."""
    domain = _infer_company_domain(company_name)

    contacts = [
        {"name": "Careers / Jobs Inbox", "role": "General Applications", "email": f"careers@{domain}"},
        {"name": "HR Department", "role": "Human Resources", "email": f"hr@{domain}"},
        {"name": "Jobs Inbox", "role": "Open Positions", "email": f"jobs@{domain}"},
        {"name": "Recruiting Team", "role": "Talent Acquisition", "email": f"recruiting@{domain}"},
        {"name": "Talent Team", "role": "Talent Management", "email": f"talent@{domain}"},
    ]

    return {
        "contacts": contacts,
        "note": (
            "These are standard department email patterns. "
            "For verified personal emails, check LinkedIn or the company careers page."
        ),
    }

