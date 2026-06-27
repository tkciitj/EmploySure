/* ── JobTable Component ─────────────────────────────────────── */

import { useState, useMemo } from 'react';
import type { Job, SortState, SortField } from '../types';
import { clearAllJobs } from '../utils/api';

interface JobTableProps {
  jobs: Job[];
  totalJobs: number;
  loading: boolean;
  error: string | null;
  sort: SortState;
  toggleSort: (field: SortField) => void;
  newRowIds: Set<number>;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onReset?: () => void;
}

const COLUMNS: { key: SortField; label: string; className: string }[] = [
  { key: 'company_name', label: 'Company', className: 'col-company' },
  { key: 'job_title', label: 'Job Title', className: 'col-title' },
  { key: 'salary', label: 'Salary', className: 'col-salary' },
  { key: 'experience_required', label: 'Experience', className: 'col-exp' },
  { key: 'location', label: 'Location', className: 'col-location' },
  { key: 'discovered_at', label: 'Discovered', className: 'col-time' },
];

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'discovered_at', label: '\u{1F552} Most Recent' },
  { value: 'company_name', label: '\u{1F3E2} Company A-Z' },
  { value: 'job_title', label: '\u{1F4BC} Job Title A-Z' },
  { value: 'salary', label: '\u{1F4B0} Salary' },
  { value: 'location', label: '\u{1F4CD} Location A-Z' },
  { value: 'experience_required', label: '\u{1F4CA} Experience' },
];

function formatTimeAgo(iso: string): string {
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
    return iso;
  }
}

function getInitials(name: string): string {
  return name
    .split(/[\s&,.-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

interface SearchGroup {
  label: string;
  jobs: Job[];
  latestTime: number;
}

/* ── Helper: read applied set from localStorage ── */
function getAppliedLinks(): Set<string> {
  try {
    const arr = JSON.parse(localStorage.getItem('appliedJobs') || '[]');
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function saveAppliedLinks(links: Set<string>) {
  localStorage.setItem('appliedJobs', JSON.stringify([...links]));
}

function JobRow({
  job,
  isNew,
  isApplied,
  onToggleApplied,
}: {
  job: Job;
  isNew: boolean;
  isApplied: boolean;
  onToggleApplied: (link: string) => void;
}) {
  return (
    <tr className={`${isNew ? 'new-row' : ''} ${isApplied ? 'applied-row' : ''}`}>
      <td className="col-company">
        <div className="job-company">
          <div className="job-company-avatar">{getInitials(job.company_name)}</div>
          <span className="job-company-name">
            {job.company_name}
            {job.is_agency && <span className="agency-badge">Agency</span>}
          </span>
        </div>
      </td>
      <td className="col-title" title={job.job_title}>{job.job_title}</td>
      <td className="col-salary">{job.salary || '\u2014'}</td>
      <td className="col-exp">{job.experience_required || '\u2014'}</td>
      <td className="col-location">{job.location || '\u2014'}</td>
      <td className="col-time">
        <span className="job-time">{formatTimeAgo(job.discovered_at)}</span>
      </td>
      <td className="col-action">
        <div className="action-btns">
          <button 
            className={`btn btn-ghost btn-sm apply-toggle-btn ${isApplied ? 'applied' : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggleApplied(job.application_link); }}
            title={isApplied ? "Remove from Applied" : "Mark as Applied"}
          >
            {isApplied ? '✅ Applied' : '◻️ Mark'}
          </button>
          <a
            href={job.application_link}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-accent btn-sm"
            onClick={(e) => e.stopPropagation()}
          >
            Apply ↗
          </a>
          <button
            className="btn btn-ghost btn-sm auto-apply-btn"
            onClick={(e) => {
              e.stopPropagation();
              const btn = e.currentTarget;
              btn.classList.add('auto-apply-btn--clicked');
              setTimeout(() => btn.classList.remove('auto-apply-btn--clicked'), 2500);
            }}
            title="Auto Apply with your resume — Coming Soon!"
          >
            <span className="auto-apply-icon">🚀</span>
            <span className="auto-apply-label">Auto Apply</span>
            <span className="auto-apply-soon">Don't Worry! Coming soon</span>
          </button>
        </div>
      </td>
    </tr>
  );
}

export function JobTable({
  jobs,
  totalJobs,
  loading,
  error,
  sort,
  toggleSort,
  newRowIds,
  page,
  totalPages,
  onPageChange,
  onReset,
}: JobTableProps) {
  const [resetting, setResetting] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [appliedLinks, setAppliedLinks] = useState<Set<string>>(getAppliedLinks);
  const [showApplied, setShowApplied] = useState(false);

  const handleToggleApplied = (link: string) => {
    setAppliedLinks((prev) => {
      const next = new Set(prev);
      if (next.has(link)) {
        next.delete(link);
      } else {
        next.add(link);
      }
      saveAppliedLinks(next);
      return next;
    });
  };

  const handleReset = async () => {
    if (!confirm('Are you sure you want to clear ALL job listings? This cannot be undone.')) return;
    setResetting(true);
    try {
      await clearAllJobs();
      onReset?.();
    } catch (err) {
      console.error('Reset failed:', err);
    } finally {
      setResetting(false);
    }
  };

  // Split jobs: applied vs unapplied
  const unappliedJobs = useMemo(() => jobs.filter((j) => !appliedLinks.has(j.application_link)), [jobs, appliedLinks]);
  const appliedJobs = useMemo(() => jobs.filter((j) => appliedLinks.has(j.application_link)), [jobs, appliedLinks]);

  // Group ONLY unapplied jobs by search_label
  const groups: SearchGroup[] = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const job of unappliedJobs) {
      const label = job.search_label || 'Other Results';
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(job);
    }
    const result: SearchGroup[] = [];
    for (const [label, groupJobs] of map) {
      const latestTime = Math.max(...groupJobs.map((j) => new Date(j.discovered_at).getTime()));
      result.push({ label, jobs: groupJobs, latestTime });
    }
    result.sort((a, b) => b.latestTime - a.latestTime);
    return result;
  }, [unappliedJobs]);

  const toggleGroup = (label: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  /* ── Error state ──────────────────────────────────────────── */
  if (error && jobs.length === 0) {
    return (
      <div className="table-container">
        <div className="empty-state">
          <div className="empty-state-icon">{'\u26A0\uFE0F'}</div>
          <div className="empty-state-title">Connection Error</div>
          <div className="empty-state-desc">
            {error.includes('API')
              ? "Couldn't connect to the backend. Make sure the server is running on localhost:8000."
              : error}
          </div>
        </div>
      </div>
    );
  }

  /* ── Loading skeleton ─────────────────────────────────────── */
  if (loading && jobs.length === 0) {
    return (
      <div className="table-container">
        <div className="table-header">
          <span className="table-title">Job Listings</span>
          <span className="table-count">Loading...</span>
        </div>
        <div className="table-scroll">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton-row">
              <div className="skeleton-cell" style={{ width: '18%' }} />
              <div className="skeleton-cell" style={{ width: '25%' }} />
              <div className="skeleton-cell" style={{ width: '10%' }} />
              <div className="skeleton-cell" style={{ width: '10%' }} />
              <div className="skeleton-cell" style={{ width: '12%' }} />
              <div className="skeleton-cell" style={{ width: '10%' }} />
              <div className="skeleton-cell" style={{ width: '8%' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ── Empty state ──────────────────────────────────────────── */
  if (jobs.length === 0) {
    return (
      <div className="table-container">
        <div className="empty-state">
          <div className="empty-state-icon">{'\u{1F50E}'}</div>
          <div className="empty-state-title">No jobs found yet</div>
          <div className="empty-state-desc">
            Search for a role above to get started! EmploySure will crawl the web and discover jobs for you automatically.
          </div>
        </div>
      </div>
    );
  }

  const renderTableHead = () => (
    <thead>
      <tr>
        {COLUMNS.map((col) => (
          <th
            key={col.key}
            className={`${col.className} ${sort.field === col.key ? 'sorted' : ''}`}
            onClick={() => toggleSort(col.key)}
          >
            {col.label}
            <span
              className={`sort-arrow ${sort.field === col.key ? 'sort-arrow--active' : ''} ${sort.field === col.key && sort.direction === 'desc' ? 'sort-arrow--desc' : ''}`}
            >
              {'\u25B2'}
            </span>
          </th>
        ))}
        <th className="col-action" style={{ cursor: 'default' }}>Action</th>
      </tr>
    </thead>
  );

  /* ── Main table with groups ──────────────────────────────── */
  return (
    <div className="table-container">
      <div className="table-header">
        <span className="table-title">Job Listings</span>
        <div className="table-header-controls">
          <div className="table-sort-control">
            <label htmlFor="sort-select" className="table-sort-label">Sort by:</label>
            <select
              id="sort-select"
              className="select select--sm"
              value={sort.field}
              onChange={(e) => toggleSort(e.target.value as SortField)}
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button
              className="btn btn-ghost btn-sm table-sort-dir-btn"
              onClick={() => toggleSort(sort.field)}
              title={sort.direction === 'asc' ? 'Ascending' : 'Descending'}
            >
              {sort.direction === 'asc' ? '\u25B2' : '\u25BC'}
            </button>
          </div>
          <span className="table-count">
            {unappliedJobs.length.toLocaleString()} active{' · '}
            {appliedJobs.length} applied
            {loading && ' · Refreshing...'}
          </span>
          <button
            className="btn btn-danger btn-sm table-reset-btn"
            onClick={handleReset}
            disabled={resetting || totalJobs === 0}
            title="Clear all job listings"
          >
            {resetting ? '\u23F3 Clearing...' : '\u{1F5D1}\uFE0F Reset All'}
          </button>
        </div>
      </div>

      {/* ── Active (unapplied) search groups ── */}
      {groups.map((group, idx) => {
        const isLatest = idx === 0;
        const isCollapsed = collapsedGroups.has(group.label);
        const showJobs = isLatest ? !isCollapsed : collapsedGroups.has('__expanded_' + group.label);

        return (
          <div key={group.label} className={`search-group ${isLatest ? 'search-group--active' : 'search-group--previous'}`}>
            <button
              className="search-group-header"
              onClick={() => {
                if (isLatest) {
                  toggleGroup(group.label);
                } else {
                  toggleGroup('__expanded_' + group.label);
                }
              }}
            >
              <span className="search-group-chevron">{(isLatest ? !isCollapsed : showJobs) ? '\u25BC' : '\u25B6'}</span>
              <span className="search-group-label">
                {isLatest && <span className="search-group-badge">Active</span>}
                {group.label.replace('Search: ', '')}
              </span>
              <span className="search-group-count">{group.jobs.length} job{group.jobs.length !== 1 ? 's' : ''}</span>
            </button>

            {(isLatest ? !isCollapsed : showJobs) && (
              <div className="table-scroll">
                <table className="job-table">
                  {renderTableHead()}
                  <tbody>
                    {group.jobs.map((job) => (
                      <JobRow
                        key={job.id}
                        job={job}
                        isNew={newRowIds.has(job.id)}
                        isApplied={false}
                        onToggleApplied={handleToggleApplied}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {/* ── Applied Jobs Section ── */}
      {appliedJobs.length > 0 && (
        <div className="search-group search-group--applied">
          <button
            className="search-group-header search-group-header--applied"
            onClick={() => setShowApplied((v) => !v)}
          >
            <span className="search-group-chevron">{showApplied ? '\u25BC' : '\u25B6'}</span>
            <span className="search-group-label">
              <span className="search-group-badge search-group-badge--applied">✅</span>
              Applied Jobs
            </span>
            <span className="search-group-count">{appliedJobs.length} job{appliedJobs.length !== 1 ? 's' : ''}</span>
          </button>

          {showApplied && (
            <div className="table-scroll">
              <table className="job-table">
                {renderTableHead()}
                <tbody>
                  {appliedJobs.map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      isNew={false}
                      isApplied={true}
                      onToggleApplied={handleToggleApplied}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn-secondary btn-sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
            {'\u2190'} Previous
          </button>
          <span className="pagination-info">Page {page} of {totalPages}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
            Next {'\u2192'}
          </button>
        </div>
      )}
    </div>
  );
}
