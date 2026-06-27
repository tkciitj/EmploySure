/* ── FilterBar Component ────────────────────────────────────── */

import { useRef, useEffect, useCallback } from 'react';
import type { FilterState } from '../types';

interface FilterBarProps {
  filters: FilterState;
  updateFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
  clearFilters: () => void;
  activeFilterCount: number;
  locations: string[];
}

const EXPERIENCE_OPTIONS = [
  'All',
  'Fresher/Intern',
  '0-1 Years',
  '1-3 Years',
  '3-5 Years',
  '5+ Years',
];

export function FilterBar({
  filters,
  updateFilter,
  clearFilters,
  activeFilterCount,
  locations,
}: FilterBarProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Debounced search */
  const handleSearch = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        updateFilter('search', value);
      }, 200);
    },
    [updateFilter]
  );

  /* Cleanup debounce on unmount */
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="filter-bar">
      <input
        ref={searchRef}
        className="input"
        type="text"
        placeholder="🔍 Search job titles..."
        defaultValue={filters.search}
        onChange={(e) => handleSearch(e.target.value)}
        aria-label="Search jobs"
      />

      <select
        className="select"
        value={filters.experience}
        onChange={(e) => updateFilter('experience', e.target.value)}
        aria-label="Filter by experience"
      >
        {EXPERIENCE_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>
            {opt === 'All' ? '💼 Experience: All' : opt}
          </option>
        ))}
      </select>

      <select
        className="select"
        value={filters.location}
        onChange={(e) => updateFilter('location', e.target.value)}
        aria-label="Filter by location"
      >
        <option value="All">📍 Location: All</option>
        <option value="Remote">Remote</option>
        {locations.map((loc) => (
          <option key={loc} value={loc}>
            {loc}
          </option>
        ))}
      </select>

      <div className="filter-bar-separator" />

      <div className="filter-bar-right">
        <label className="toggle">
          <div
            className={`toggle-track ${filters.hideAgency ? 'toggle-track--active' : ''}`}
            role="switch"
            aria-checked={filters.hideAgency}
            tabIndex={0}
            onClick={() => updateFilter('hideAgency', !filters.hideAgency)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                updateFilter('hideAgency', !filters.hideAgency);
              }
            }}
          >
            <div className="toggle-knob" />
          </div>
          <span className="toggle-label">Hide Agency Posts</span>
        </label>

        {activeFilterCount > 0 && (
          <>
            <span className="filter-count">{activeFilterCount}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => {
              clearFilters();
              if (searchRef.current) searchRef.current.value = '';
            }}>
              ✕ Clear All
            </button>
          </>
        )}
      </div>
    </div>
  );
}
