/* ── SourcePanel Component (Sidebar) ────────────────────────── */

import { useState, useCallback } from 'react';
import type { Source } from '../types';

interface SourcePanelProps {
  sources: Source[];
  loading: boolean;
  isOpen: boolean;
  onClose: () => void;
  onDelete: (id: number) => Promise<void>;
  onTriggerScrape: (id: number) => Promise<void>;
}

export function SourcePanel({
  sources,
  loading,
  isOpen,
  onClose,
  onDelete,
  onTriggerScrape,
}: SourcePanelProps) {
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [scrapingId, setScrapingId] = useState<number | null>(null);

  const handleDelete = useCallback(
    async (e: React.MouseEvent, id: number) => {
      e.stopPropagation();
      setDeletingId(id);
      try {
        await onDelete(id);
      } catch {
        /* error handled upstream */
      } finally {
        setDeletingId(null);
      }
    },
    [onDelete]
  );

  const handleScrape = useCallback(
    async (id: number) => {
      setScrapingId(id);
      try {
        await onTriggerScrape(id);
      } catch {
        /* error handled upstream */
      } finally {
        setScrapingId(null);
      }
    },
    [onTriggerScrape]
  );

  const getStatusDotClass = (status: Source['status']) => {
    switch (status) {
      case 'crawling': return 'status-dot status-dot--crawling';
      case 'done':     return 'status-dot status-dot--done';
      case 'failed':   return 'status-dot status-dot--failed';
      default:         return 'status-dot status-dot--idle';
    }
  };

  const getStatusLabel = (status: Source['status']) => {
    switch (status) {
      case 'crawling': return 'Crawling';
      case 'done':     return 'Active';
      case 'failed':   return 'Failed';
      default:         return 'Idle';
    }
  };

  const getDisplayName = (source: Source) => {
    if (source.source_name) return source.source_name;
    try {
      return new URL(source.url).hostname.replace('www.', '');
    } catch {
      return source.url;
    }
  };

  return (
    <>
      {/* Overlay for mobile */}
      <div
        className={`sidebar-overlay ${isOpen ? 'open' : ''}`}
        onClick={onClose}
      />

      <aside className={`source-panel ${isOpen ? 'open' : ''}`}>
        <div className="source-panel-header">
          <span className="source-panel-title">Sources</span>
          <span className="source-panel-count">{sources.length}</span>
        </div>

        <div className="source-list">
          {loading && sources.length === 0 && (
            <>
              {[1, 2, 3].map((i) => (
                <div key={i} className="source-item" style={{ cursor: 'default' }}>
                  <div
                    className="loading-shimmer"
                    style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0 }}
                  />
                  <div className="source-item-info">
                    <div
                      className="loading-shimmer"
                      style={{ height: 12, width: `${60 + i * 10}%`, marginBottom: 6 }}
                    />
                    <div
                      className="loading-shimmer"
                      style={{ height: 10, width: `${40 + i * 10}%` }}
                    />
                  </div>
                </div>
              ))}
            </>
          )}

          {!loading && sources.length === 0 && (
            <div className="empty-state" style={{ padding: '2rem 1rem' }}>
              <div className="empty-state-icon" style={{ fontSize: '2rem' }}>🔗</div>
              <div className="empty-state-desc" style={{ fontSize: 'var(--font-size-xs)' }}>
                No sources yet. Add a URL above to start discovering jobs.
              </div>
            </div>
          )}

          {sources.map((source, index) => (
            <div
              key={source.id}
              className="source-item"
              style={{ animationDelay: `${index * 0.05}s` }}
              onClick={() => handleScrape(source.id)}
              title={`Click to re-crawl · Status: ${getStatusLabel(source.status)}`}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleScrape(source.id);
                }
              }}
            >
              <div
                className={getStatusDotClass(source.status)}
                title={getStatusLabel(source.status)}
              />

              <div className="source-item-info">
                <div className="source-item-name">
                  {scrapingId === source.id ? '⏳ ' : ''}
                  {getDisplayName(source)}
                </div>
                <div className="source-item-url" title={source.url}>
                  {source.url}
                </div>
              </div>

              <button
                className="source-item-delete"
                onClick={(e) => handleDelete(e, source.id)}
                disabled={deletingId === source.id}
                aria-label={`Delete source: ${getDisplayName(source)}`}
                title="Delete source"
              >
                {deletingId === source.id ? '⏳' : '🗑️'}
              </button>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
