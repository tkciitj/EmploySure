/* ── useJobs — Job Fetching + SSE Hook ──────────────────────── */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Job, FilterState, SortState, SortField } from '../types';
import { fetchJobs, subscribeSSE } from '../utils/api';

const DEFAULT_FILTERS: FilterState = {
  search: '',
  experience: 'All',
  location: 'All',
  hideAgency: false,
  page: 1,
  perPage: 100,
};

export function useJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [totalJobs, setTotalJobs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortState>({ field: 'discovered_at', direction: 'desc' });
  const [newRowIds, setNewRowIds] = useState<Set<number>>(new Set());

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  /* ── Fetch jobs from API ──────────────────────────────────── */
  const loadJobs = useCallback(async (f?: FilterState) => {
    const activeFilters = f ?? filtersRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJobs(activeFilters);
      setJobs(res.jobs);
      setTotalJobs(res.total);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch jobs';
      setError(msg);
      /* Don't clear existing jobs on error — keep stale data visible */
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── Initial load ─────────────────────────────────────────── */
  useEffect(() => {
    loadJobs(filters);
  }, [filters, loadJobs]);

  /* ── SSE subscription ─────────────────────────────────────── */
  useEffect(() => {
    const unsubscribe = subscribeSSE(
      /* onNewJob */ (job) => {
        setJobs((prev) => {
          /* Avoid duplicates */
          if (prev.some((j) => j.id === job.id)) return prev;
          setNewRowIds((ids) => new Set(ids).add(job.id));
          setTimeout(() => {
            setNewRowIds((ids) => {
              const next = new Set(ids);
              next.delete(job.id);
              return next;
            });
          }, 2000);
          setTotalJobs((t) => t + 1);
          return [job, ...prev];
        });
      },
      /* onCrawlStatus */  () => { /* handled by useSources */ },
      /* onCrawlComplete */ () => {
        /* Refresh jobs when a crawl finishes */
        loadJobs();
      },
    );

    return unsubscribe;
  }, [loadJobs]);

  /* ── Client-side sorting ──────────────────────────────────── */
  const sortedJobs = [...jobs].sort((a, b) => {
    const dir = sort.direction === 'asc' ? 1 : -1;
    const aVal = a[sort.field] ?? '';
    const bVal = b[sort.field] ?? '';
    if (aVal < bVal) return -1 * dir;
    if (aVal > bVal) return 1 * dir;
    return 0;
  });

  /* ── Sort toggle ──────────────────────────────────────────── */
  const toggleSort = useCallback((field: SortField) => {
    setSort((prev) => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  }, []);

  /* ── Filter updaters ──────────────────────────────────────── */
  const updateFilter = useCallback(<K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: key !== 'page' ? 1 : (value as number) }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  /* ── Computed values ──────────────────────────────────────── */
  const activeFilterCount =
    (filters.search ? 1 : 0) +
    (filters.experience !== 'All' ? 1 : 0) +
    (filters.location !== 'All' ? 1 : 0) +
    (filters.hideAgency ? 1 : 0);

  const totalPages = Math.max(1, Math.ceil(totalJobs / filters.perPage));

  /* ── Unique locations from jobs for filter dropdown ────────── */
  const locations = Array.from(
    new Set(jobs.map((j) => j.location).filter((l): l is string => !!l))
  ).sort();

  return {
    jobs: sortedJobs,
    totalJobs,
    loading,
    error,
    filters,
    sort,
    newRowIds,
    activeFilterCount,
    totalPages,
    locations,
    updateFilter,
    clearFilters,
    toggleSort,
    refetch: loadJobs,
  } as const;
}
