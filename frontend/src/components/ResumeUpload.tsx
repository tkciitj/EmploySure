/* ── ResumeUpload Component ─────────────────────────────────── */

import { useState, useRef, useCallback } from 'react';
import type { SearchPayload } from '../types';

interface ResumeProfile {
  skills: string[];
  experience_level: string;
  suggested_roles: string[];
  locations: string[];
  summary: string;
  provider: string;
}

interface ResumeUploadProps {
  onSearchFromResume: (payload: SearchPayload) => Promise<void>;
  isSearching: boolean;
}

export function ResumeUpload({ onSearchFromResume, isSearching }: ResumeUploadProps) {
  const [profile, setProfile] = useState<ResumeProfile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please upload a PDF file.');
      return;
    }
    if (file.size > 10_000_000) {
      setError('File too large. Maximum 10MB.');
      return;
    }

    setUploading(true);
    setError(null);
    setProfile(null);
    setFileName(file.name);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('http://localhost:8000/api/resume/analyze', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `Upload failed: ${res.status}`);
      }

      const data: ResumeProfile = await res.json();
      setProfile(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleSearchRole = async (role: string) => {
    if (!profile) return;
    await onSearchFromResume({
      role,
      experience: profile.experience_level,
      location: profile.locations[0] || '',
    });
  };

  return (
    <div className="resume-upload-container glass">
      <div className="resume-upload-header">
        <div className="resume-upload-icon">📄</div>
        <div>
          <h2 className="resume-upload-title">Upload Your Resume</h2>
          <p className="resume-upload-subtitle">
            AI will analyze your resume and find matching jobs automatically
          </p>
        </div>
      </div>

      {/* Upload Zone */}
      {!profile && (
        <div
          className={`resume-dropzone ${dragOver ? 'resume-dropzone--active' : ''} ${uploading ? 'resume-dropzone--uploading' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => !uploading && fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          {uploading ? (
            <div className="resume-dropzone-content">
              <div className="spinner spinner--lg" />
              <p className="resume-dropzone-text">Analyzing {fileName}...</p>
              <p className="resume-dropzone-hint">AI is extracting skills and experience</p>
            </div>
          ) : (
            <div className="resume-dropzone-content">
              <div className="resume-dropzone-icon">⬆️</div>
              <p className="resume-dropzone-text">
                {dragOver ? 'Drop your resume here' : 'Drag & drop your PDF resume here'}
              </p>
              <p className="resume-dropzone-hint">or click to browse · PDF only · Max 10MB</p>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="resume-error">
          ⚠️ {error}
          <button className="resume-error-dismiss" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Extracted Profile */}
      {profile && (
        <div className="resume-profile">
          <div className="resume-profile-header">
            <div>
              <div className="resume-profile-badge">✅ Resume Analyzed</div>
              {fileName && <span className="resume-profile-file">{fileName}</span>}
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => { setProfile(null); setFileName(null); }}
            >
              Upload New
            </button>
          </div>

          {/* Summary */}
          {profile.summary && (
            <p className="resume-summary">{profile.summary}</p>
          )}

          {/* Skills */}
          {profile.skills.length > 0 && (
            <div className="resume-section">
              <h4 className="resume-section-title">🛠️ Skills Detected</h4>
              <div className="resume-tags">
                {profile.skills.map((skill) => (
                  <span key={skill} className="resume-tag">{skill}</span>
                ))}
              </div>
            </div>
          )}

          {/* Experience & Location */}
          <div className="resume-meta-row">
            <div className="resume-meta">
              <span className="resume-meta-label">📊 Experience</span>
              <span className="resume-meta-value">{profile.experience_level}</span>
            </div>
            {profile.locations.length > 0 && (
              <div className="resume-meta">
                <span className="resume-meta-label">📍 Location</span>
                <span className="resume-meta-value">{profile.locations.join(', ')}</span>
              </div>
            )}
          </div>

          {/* Suggested Roles — Clickable Search Buttons */}
          {profile.suggested_roles.length > 0 && (
            <div className="resume-section">
              <h4 className="resume-section-title">🎯 Recommended Roles — Click to Search</h4>
              <div className="resume-roles">
                {profile.suggested_roles.map((role) => (
                  <button
                    key={role}
                    className="btn btn-accent btn-sm resume-role-btn"
                    onClick={() => handleSearchRole(role)}
                    disabled={isSearching}
                  >
                    🔍 {role}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
