/* ── StatsBar Component ─────────────────────────────────────── */

import { useEffect, useState } from 'react';
import type { Stats } from '../types';
import { fetchStats } from '../utils/api';

interface StatsBarProps {
  totalJobs: number;
}

export function StatsBar({ totalJobs }: StatsBarProps) {
  const [stats, setStats] = useState<Stats>({
    total_jobs: 0,
    active_sources: 0,
    jobs_today: 0,
    last_crawl_time: null,
  });

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchStats()
        .then((data) => {
          if (!cancelled) setStats(data);
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [totalJobs]);

  const formatTime = (iso: string | null) => {
    if (!iso) return 'Never';
    try {
      const d = new Date(iso);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return 'Just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return `${diffHr}h ago`;
      const diffDays = Math.floor(diffHr / 24);
      if (diffDays < 7) return `${diffDays}d ago`;
      return d.toLocaleDateString();
    } catch {
      return 'Unknown';
    }
  };

  return (
    <div className="stats-bar">
      <div className="stat-card">
        <div className="stat-icon stat-icon--primary">💼</div>
        <div className="stat-content">
          <div className="stat-value">{totalJobs.toLocaleString()}</div>
          <div className="stat-label">Jobs Found</div>
        </div>
      </div>
      <div className="stat-card">
        <div className="stat-icon stat-icon--warning">🕐</div>
        <div className="stat-content">
          <div className="stat-value">{formatTime(stats.last_crawl_time)}</div>
          <div className="stat-label">Last Crawl</div>
        </div>
      </div>
    </div>
  );
}
