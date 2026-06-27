/* ── SearchForm Component ─────────────────────────────────── */

import { useState } from 'react';
import type { SearchPayload } from '../types';

interface SearchFormProps {
  onSearch: (payload: SearchPayload) => Promise<void>;
  isSearching: boolean;
  searchProgress: { urls_total: number; urls_crawled: number; jobs_found_so_far: number } | null;
}

const EXPERIENCE_OPTIONS = [
  'Any',
  'Intern/Fresher',
  'Entry Level (0-2 yrs)',
  'Mid Level (3-5 yrs)',
  'Senior (5+ yrs)',
];

export function SearchForm({ onSearch, isSearching, searchProgress }: SearchFormProps) {
  const [role, setRole] = useState('');
  const [experience, setExperience] = useState('Any');
  const [location, setLocation] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!role.trim() || isSearching) return;
    await onSearch({ role: role.trim(), experience, location: location.trim() });
  };

  return (
    <div className="search-form-container glass">
      <div className="search-form-header">
        <div className="search-form-icon">🔍</div>
        <div>
          <h2 className="search-form-title">Find Jobs Instantly</h2>
          <p className="search-form-subtitle">
            Enter a role and let AI scan the entire web for real-time openings
          </p>
        </div>
      </div>

      <form className="search-form" onSubmit={handleSubmit}>
        <div className="search-form-fields">
          <div className="search-field search-field--role">
            <label htmlFor="search-role" className="search-label">Role / Title</label>
            <input
              id="search-role"
              type="text"
              className="input"
              placeholder="e.g. Software Engineer, Data Scientist, Product Manager..."
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={isSearching}
              required
              autoFocus
            />
          </div>

          <div className="search-field search-field--exp">
            <label htmlFor="search-exp" className="search-label">Experience</label>
            <select
              id="search-exp"
              className="select"
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
              disabled={isSearching}
            >
              {EXPERIENCE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>

          <div className="search-field search-field--loc">
            <label htmlFor="search-loc" className="search-label">Location</label>
            <input
              id="search-loc"
              type="text"
              className="input"
              placeholder="e.g. Remote, Bangalore, New York..."
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              disabled={isSearching}
            />
          </div>

          <div className="search-field search-field--btn">
            <label className="search-label">&nbsp;</label>
            <button
              type="submit"
              className="btn btn-primary btn-lg search-submit-btn"
              disabled={!role.trim() || isSearching}
            >
              {isSearching ? (
                <span className="search-btn-loading">
                  <span className="spinner" />
                  Searching...
                </span>
              ) : (
                <>🔍 Search Jobs</>
              )}
            </button>
          </div>
        </div>

        {/* Progress indicator during search */}
        {isSearching && searchProgress && (
          <div className="search-progress">
            <div className="search-progress-bar">
              <div
                className="search-progress-fill"
                style={{
                  width: searchProgress.urls_total > 0
                    ? `${(searchProgress.urls_crawled / searchProgress.urls_total) * 100}%`
                    : '10%',
                }}
              />
            </div>
            <div className="search-progress-text">
              Scanning {searchProgress.urls_crawled} of {searchProgress.urls_total} sources
              {searchProgress.jobs_found_so_far > 0 && (
                <> · <strong>{searchProgress.jobs_found_so_far} jobs</strong> found so far</>
              )}
            </div>
          </div>
        )}

        {isSearching && !searchProgress && (
          <div className="search-progress">
            <div className="search-progress-bar">
              <div className="search-progress-fill search-progress-fill--indeterminate" />
            </div>
            <div className="search-progress-text">
              Discovering job listings across the web...
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
