/* ── AddSourceForm Component ────────────────────────────────── */

import { useState, useCallback, type FormEvent } from 'react';

interface AddSourceFormProps {
  onAdd: (payload: { url: string; source_name?: string; criteria?: string }) => Promise<unknown>;
}

function isValidUrl(str: string): boolean {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function AddSourceForm({ onAdd }: AddSourceFormProps) {
  const [url, setUrl] = useState('');
  const [criteria, setCriteria] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);

      const trimmedUrl = url.trim();
      if (!trimmedUrl) {
        setError('URL is required');
        return;
      }
      if (!isValidUrl(trimmedUrl)) {
        setError('Please enter a valid URL (starting with http:// or https://)');
        return;
      }

      setLoading(true);
      try {
        await onAdd({
          url: trimmedUrl,
          criteria: criteria.trim() || undefined,
        });
        setUrl('');
        setCriteria('');
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add source');
      } finally {
        setLoading(false);
      }
    },
    [url, criteria, onAdd]
  );

  return (
    <>
      <form className="add-source-form" onSubmit={handleSubmit}>
        <div className="form-group" style={{ flex: 2 }}>
          <label className="form-label" htmlFor="source-url">
            Source URL
          </label>
          <input
            id="source-url"
            className={`input ${error && !url.trim() ? 'input--error' : ''}`}
            type="text"
            placeholder="Paste any job board URL, GitHub repo, or career page..."
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            disabled={loading}
            autoComplete="url"
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="source-criteria">
            Criteria (optional)
          </label>
          <input
            id="source-criteria"
            className="input"
            type="text"
            placeholder="e.g., Entry-level software engineer, remote only"
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            disabled={loading}
          />
        </div>

        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? (
            <>
              <span className="btn-spinner" />
              Adding...
            </>
          ) : (
            <>➕ Add Source</>
          )}
        </button>
      </form>

      {error && (
        <div className="error-banner" style={{ marginTop: '-0.5rem' }}>
          <span className="error-banner-icon">⚠️</span>
          <span className="error-banner-message">{error}</span>
          <button className="error-banner-dismiss" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}

      {success && (
        <div className="toast-container">
          <div className="toast toast--success">✅ Source added successfully!</div>
        </div>
      )}
    </>
  );
}
