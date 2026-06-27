/* ── useSources — Source CRUD + Real-Time Status Hook ────────── */

import { useState, useEffect, useCallback } from 'react';
import type { Source, AddSourcePayload } from '../types';
import {
  fetchSources,
  createSource,
  deleteSource as apiDeleteSource,
  triggerScrape as apiTriggerScrape,
  subscribeSSE,
} from '../utils/api';

export function useSources() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ── Load sources ─────────────────────────────────────────── */
  const loadSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSources();
      setSources(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sources');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  /* ── SSE for real-time crawl status updates ───────────────── */
  useEffect(() => {
    const unsubscribe = subscribeSSE(
      /* onNewJob */      () => {},
      /* onCrawlStatus */ (data) => {
        setSources((prev) =>
          prev.map((s) =>
            s.id === data.source_id ? { ...s, status: data.status } : s
          )
        );
      },
      /* onCrawlComplete */ (data) => {
        setSources((prev) =>
          prev.map((s) =>
            s.id === data.source_id
              ? { ...s, status: 'done' as const, last_crawled_at: new Date().toISOString() }
              : s
          )
        );
      },
    );

    return unsubscribe;
  }, []);

  /* ── Add source ───────────────────────────────────────────── */
  const addSource = useCallback(async (payload: AddSourcePayload) => {
    const newSource = await createSource(payload);
    setSources((prev) => [newSource, ...prev]);
    return newSource;
  }, []);

  /* ── Delete source ────────────────────────────────────────── */
  const deleteSourceById = useCallback(async (id: number) => {
    await apiDeleteSource(id);
    setSources((prev) => prev.filter((s) => s.id !== id));
  }, []);

  /* ── Trigger scrape ───────────────────────────────────────── */
  const triggerScrape = useCallback(async (sourceId: number) => {
    setSources((prev) =>
      prev.map((s) =>
        s.id === sourceId ? { ...s, status: 'crawling' as const } : s
      )
    );
    try {
      await apiTriggerScrape(sourceId);
    } catch {
      /* Revert optimistic update on error */
      setSources((prev) =>
        prev.map((s) =>
          s.id === sourceId ? { ...s, status: 'idle' as const } : s
        )
      );
      throw new Error('Failed to start crawl');
    }
  }, []);

  /* ── Computed ──────────────────────────────────────────────── */
  const activeSources = sources.filter((s) => s.is_active).length;

  return {
    sources,
    loading,
    error,
    activeSources,
    addSource,
    deleteSource: deleteSourceById,
    triggerScrape,
    refetch: loadSources,
  } as const;
}
