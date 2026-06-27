"""
EmploySure — Resume Parser
Extracts text from PDF resumes and uses AI to identify key skills,
experience level, suggested job titles, and preferred locations.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
from typing import Any

import pdfplumber

from app.config import get_settings

logger = logging.getLogger(__name__)

RESUME_ANALYSIS_PROMPT = '''You are a professional resume analyzer. Analyze the following resume text and extract structured information.

Return a JSON object with these exact fields:
{
  "skills": ["list", "of", "key", "technical", "and", "soft", "skills"],
  "experience_level": "one of: Intern/Fresher, Entry Level (0-2 yrs), Mid Level (3-5 yrs), Senior (5+ yrs)",
  "suggested_roles": ["list", "of", "3-5", "job", "titles", "this", "person", "should", "apply", "for"],
  "locations": ["preferred", "locations", "mentioned", "or", "Remote"],
  "summary": "A 2-3 sentence professional summary of this candidate"
}

IMPORTANT:
- Extract REAL skills from the resume, not generic ones
- suggested_roles should be specific job titles (e.g., "Frontend React Developer" not just "Developer")
- If no location preference is mentioned, default to ["Remote"]
- experience_level should be based on years of experience and role seniority mentioned
- Return ONLY the JSON object, no markdown fences, no commentary

RESUME TEXT:
'''


async def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract all text from a PDF file."""
    text_parts: list[str] = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)
    full_text = "\n\n".join(text_parts)
    logger.info("Extracted %d chars from PDF (%d pages)", len(full_text), len(text_parts))
    return full_text


async def _try_gemini(prompt: str) -> str:
    """Call Gemini for resume analysis with a strict 15-second timeout."""
    from google import genai

    settings = get_settings()
    client = genai.Client(api_key=settings.gemini_api_key)

    async with asyncio.timeout(15):
        response = await client.aio.models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
            config=genai.types.GenerateContentConfig(
                temperature=0.1,
                max_output_tokens=4096,
            ),
        )
    return response.text or ""


async def _try_groq(prompt: str) -> str:
    """Call Groq for resume analysis with a strict 20-second timeout."""
    from groq import AsyncGroq

    settings = get_settings()
    client = AsyncGroq(api_key=settings.groq_api_key)

    async with asyncio.timeout(20):
        chat_completion = await client.chat.completions.create(
            model=settings.groq_model,
            messages=[
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            max_tokens=4096,
        )
    return chat_completion.choices[0].message.content or ""


async def analyze_resume(file_bytes: bytes) -> dict[str, Any]:
    """Extract text from PDF and analyze with AI to get structured profile data."""
    # Step 1: Extract text
    resume_text = await extract_text_from_pdf(file_bytes)
    if not resume_text.strip():
        raise ValueError("Could not extract any text from the PDF. Is it a scanned image?")

    # Step 2: AI analysis
    prompt = RESUME_ANALYSIS_PROMPT + resume_text[:30_000]  # Truncate for token limits

    settings = get_settings()
    result_json = None
    provider = "none"

    # Try Groq FIRST (much faster, higher quota)
    if settings.has_groq:
        try:
            raw = await _try_groq(prompt)
            result_json = _parse_json_response(raw)
            provider = "groq"
            logger.info("Resume analyzed via Groq (%d chars)", len(raw))
        except Exception as exc:
            logger.warning("Groq resume analysis failed: %s", exc)

    # Fallback to Gemini
    if result_json is None and settings.has_gemini:
        try:
            raw = await _try_gemini(prompt)
            result_json = _parse_json_response(raw)
            provider = "gemini"
            logger.info("Resume analyzed via Gemini (%d chars)", len(raw))
        except Exception as exc:
            logger.warning("Gemini resume analysis failed: %s", exc)

    if result_json is None:
        # Return basic extraction without AI
        return {
            "skills": [],
            "experience_level": "Any",
            "suggested_roles": [],
            "locations": ["Remote"],
            "summary": "AI analysis unavailable. Please try again later.",
            "provider": "none",
        }

    result_json["provider"] = provider
    return result_json


def _parse_json_response(raw: str) -> dict[str, Any] | None:
    """Parse JSON from AI response, handling markdown code fences."""
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to find JSON in the response
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end])
            except json.JSONDecodeError:
                pass
    return None
