/* ── EmploySure Type Definitions ─────────────────────────────── */

export interface Source {
  id: number;
  url: string;
  source_name: string | null;
  is_active: boolean;
  last_crawled_at: string | null;
  status: 'idle' | 'crawling' | 'done' | 'failed';
  criteria: string | null;
}

export interface Job {
  id: number;
  source_id: number;
  company_name: string;
  job_title: string;
  application_link: string;
  experience_required: string | null;
  location: string | null;
  salary: string | null;
  search_label: string;
  is_relevant: boolean;
  is_agency: boolean;
  discovered_at: string;
  last_verified_at: string;
  link_alive: boolean;
}

export interface Stats {
  total_jobs: number;
  active_sources: number;
  jobs_today: number;
  last_crawl_time: string | null;
}

export interface JobsResponse {
  jobs: Job[];
  total: number;
}

export interface FilterState {
  search: string;
  experience: string;
  location: string;
  hideAgency: boolean;
  page: number;
  perPage: number;
}

export type SortField = 'company_name' | 'job_title' | 'experience_required' | 'location' | 'salary' | 'discovered_at';
export type SortDirection = 'asc' | 'desc';

export interface SortState {
  field: SortField;
  direction: SortDirection;
}

export interface SSENewJobEvent {
  type: 'new_job';
  data: Job;
}

export interface SSECrawlStatusEvent {
  type: 'crawl_status';
  data: {
    source_id: number;
    status: Source['status'];
  };
}

export interface SSECrawlCompleteEvent {
  type: 'crawl_complete';
  data: {
    source_id: number;
    jobs_found: number;
  };
}

export type SSEEvent = SSENewJobEvent | SSECrawlStatusEvent | SSECrawlCompleteEvent;

export interface AddSourcePayload {
  url: string;
  source_name?: string;
  criteria?: string;
}

export interface SearchPayload {
  role: string;
  experience: string;
  location: string;
}

export interface SSESearchProgressEvent {
  type: 'search_progress';
  data: {
    source_id: number;
    urls_total: number;
    urls_crawled: number;
    jobs_found_so_far: number;
  };
}
