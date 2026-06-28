/* ── App.tsx — Main Layout Composition ──────────────────────── */

import { useState, useEffect, useCallback } from 'react';
import { useTheme } from './hooks/useTheme';
import { useJobs } from './hooks/useJobs';
import { Header } from './components/Header';
import { StatsBar } from './components/StatsBar';
import { FilterBar } from './components/FilterBar';
import { JobTable } from './components/JobTable';
import { SearchForm } from './components/SearchForm';
import { ResumeUpload } from './components/ResumeUpload';
import { AccountSidebar } from './components/AccountSidebar';
import { ColdEmailTab } from './components/ColdEmailTab';
import { BulkEmailTab } from './components/BulkEmailTab';
import { searchJobs } from './utils/api';
import type { SearchPayload } from './types';

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<'search' | 'email' | 'bulk'>('search');
  const [accountOpen, setAccountOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState<{
    urls_total: number;
    urls_crawled: number;
    jobs_found_so_far: number;
  } | null>(null);

  const {
    jobs,
    totalJobs,
    loading: jobsLoading,
    error: jobsError,
    filters,
    sort,
    newRowIds,
    activeFilterCount,
    totalPages,
    locations,
    updateFilter,
    clearFilters,
    toggleSort,
    refetch,
  } = useJobs();

  /* ── Handle search submission ──────────────────────────────── */
  const handleSearch = useCallback(async (payload: SearchPayload) => {
    setIsSearching(true);
    setSearchProgress(null);
    try {
      await searchJobs(payload);
    } catch (err) {
      console.error('Search failed:', err);
      setIsSearching(false);
    }
  }, []);

  /* ── SSE listener for search progress & completion ─────────── */
  useEffect(() => {
    const es = new EventSource('https://employsure-backend.onrender.com/api/jobs/stream');

    es.addEventListener('search_progress', (e) => {
      try {
        setSearchProgress(JSON.parse(e.data));
      } catch { /* ignore */ }
    });

    es.addEventListener('crawl_complete', () => {
      setIsSearching(false);
      setSearchProgress(null);
      refetch();
    });

    es.onerror = () => { /* auto-reconnects */ };

    return () => es.close();
  }, [refetch]);

  return (
    <div className="app-layout">
      {/* Header */}
      <Header
        theme={theme}
        toggleTheme={toggleTheme}
        stats={{
          total_jobs: totalJobs,
          active_sources: 0,
          jobs_today: 0,
          last_crawl_time: null,
        }}
        onAccountClick={() => setAccountOpen(true)}
      />

      {/* Main Content — Full Width, Centered */}
      <main className="main-content-area">
        <div className="tabs-nav">
          <button 
            className={`tab-btn ${activeTab === 'search' ? 'active' : ''}`}
            onClick={() => setActiveTab('search')}
          >
            🔍 Job Search
          </button>
          <button 
            className={`tab-btn ${activeTab === 'email' ? 'active' : ''}`}
            onClick={() => setActiveTab('email')}
          >
            ✉️ Email Drafter
          </button>
          <button 
            className={`tab-btn ${activeTab === 'bulk' ? 'active' : ''}`}
            onClick={() => setActiveTab('bulk')}
          >
            📮 Bulk Email
          </button>
        </div>

        <div className="main-content-inner">
          {activeTab === 'search' && (
            <>
              {/* Search Form — Primary Action */}
              <SearchForm
                onSearch={handleSearch}
                isSearching={isSearching}
                searchProgress={searchProgress}
              />

              {/* Resume Upload */}
              <ResumeUpload
                onSearchFromResume={handleSearch}
                isSearching={isSearching}
              />

              {/* Stats */}
              <StatsBar totalJobs={totalJobs} />

              {/* Filter Bar */}
              <FilterBar
                filters={filters}
                updateFilter={updateFilter}
                clearFilters={clearFilters}
                activeFilterCount={activeFilterCount}
                locations={locations}
              />

              {/* Job Table */}
              <JobTable
                jobs={jobs}
                totalJobs={totalJobs}
                loading={jobsLoading}
                error={jobsError}
                sort={sort}
                toggleSort={toggleSort}
                newRowIds={newRowIds}
                page={filters.page}
                totalPages={totalPages}
                onPageChange={(p) => updateFilter('page', p)}
                onReset={refetch}
              />
            </>
          )}

          {activeTab === 'email' && <ColdEmailTab />}
          {activeTab === 'bulk' && <BulkEmailTab />}
        </div>
      </main>

      {/* Account Sidebar */}
      <AccountSidebar
        isOpen={accountOpen}
        onClose={() => setAccountOpen(false)}
      />
    </div>
  );
}
