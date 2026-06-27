/* ── EmploySure API Client ───────────────────────────────────── */

import type { Source, Job, Stats, JobsResponse, AddSourcePayload, FilterState, SearchPayload } from '../types';

const API_BASE = 'https://employsure-backend.onrender.com';

/* ── Generic fetch wrapper ──────────────────────────────────── */

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/* ── Sources ────────────────────────────────────────────────── */

export async function fetchSources(): Promise<Source[]> {
  return request<Source[]>('/api/sources');
}

export async function createSource(payload: AddSourcePayload): Promise<Source> {
  return request<Source>('/api/sources', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteSource(id: number): Promise<void> {
  await request<unknown>(`/api/sources/${id}`, { method: 'DELETE' });
}

export async function triggerScrape(sourceId: number): Promise<{ status: string }> {
  return request<{ status: string }>('/api/scrape', {
    method: 'POST',
    body: JSON.stringify({ source_id: sourceId }),
  });
}

export async function searchJobs(payload: SearchPayload): Promise<{ message: string; source_id: number }> {
  return request<{ message: string; source_id: number }>('/api/search', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/* ── Jobs ───────────────────────────────────────────────────── */

export async function fetchJobs(filters: Partial<FilterState> = {}): Promise<JobsResponse> {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.experience && filters.experience !== 'All') params.set('experience', filters.experience);
  if (filters.location && filters.location !== 'All') params.set('location', filters.location);
  if (filters.hideAgency) params.set('hide_agency', 'true');
  params.set('page', String(filters.page ?? 1));
  params.set('per_page', String(filters.perPage ?? 50));
  return request<JobsResponse>(`/api/jobs?${params.toString()}`);
}

export async function hideJob(id: number): Promise<void> {
  await request<unknown>(`/api/jobs/${id}/hide`, { method: 'PATCH' });
}

export async function clearAllJobs(): Promise<{ message: string; deleted: number }> {
  return request<{ message: string; deleted: number }>('/api/jobs', {
    method: 'DELETE',
  });
}

/* ── Stats ──────────────────────────────────────────────────── */

export async function fetchStats(): Promise<Stats> {
  return request<Stats>('/api/stats');
}

/* ── SSE ────────────────────────────────────────────────────── */

export function subscribeSSE(
  onNewJob: (job: Job) => void,
  onCrawlStatus: (data: { source_id: number; status: Source['status'] }) => void,
  onCrawlComplete: (data: { source_id: number; jobs_found: number }) => void,
  onSearchProgress?: (data: { source_id: number; urls_total: number; urls_crawled: number; jobs_found_so_far: number }) => void,
): () => void {
  let es: EventSource | null = null;

  try {
    es = new EventSource(`${API_BASE}/api/jobs/stream`);

    es.addEventListener('new_job', (e) => {
      try { onNewJob(JSON.parse(e.data)); } catch { /* ignore parse errors */ }
    });

    es.addEventListener('crawl_status', (e) => {
      try { onCrawlStatus(JSON.parse(e.data)); } catch { /* ignore */ }
    });

    es.addEventListener('crawl_complete', (e) => {
      try { onCrawlComplete(JSON.parse(e.data)); } catch { /* ignore */ }
    });

    es.addEventListener('search_progress', (e) => {
      try { if (onSearchProgress) onSearchProgress(JSON.parse(e.data)); } catch { /* ignore */ }
    });

    es.onerror = () => {
      /* EventSource auto-reconnects; we just swallow the error */
    };
  } catch {
    /* SSE not available — degrade gracefully */
  }

  return () => {
    es?.close();
  };
}

/* ── AI Features ────────────────────────────────────────────── */

export async function generateColdEmail(payload: {
  job_title: string;
  company_name: string;
  resume_text: string;
  intent?: string;
}) {
  return request<{ subject: string; body: string }>('/api/generate-email', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function findContacts(payload: { company_name: string; job_title: string }) {
  return request<{
    contacts: { name: string; role: string; email: string }[];
    note: string;
  }>('/api/find-contacts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function uploadResumeForText(file: File): Promise<{ text: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const url = `${API_BASE}/api/resume/extract-text`;
  const res = await fetch(url, { method: 'POST', body: formData });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

/* ── Bulk Email ─────────────────────────────────────────────── */

export async function sendBulkEmails(payload: {
  entries: any[];
  sender_email: string;
  sender_app_password: string;
}) {
  return request<{
    results: { id: string; status: string; error: string }[];
    total_sent: number;
    total_failed: number;
  }>('/api/bulk-send', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
