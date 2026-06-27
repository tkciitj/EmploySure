/* ── BulkEmailTab — Bulk Cold Email Tool ───────────────────── */

import { useState, useRef } from 'react';
import { generateColdEmail, uploadResumeForText, sendBulkEmails } from '../utils/api';

interface BulkEntry {
  id: string;
  recipientEmail: string;
  companyName: string;
  jobTitle: string;
  intent: string;
  resumeText: string;
  subject: string;
  body: string;
  status: 'draft' | 'generating' | 'ready' | 'approved' | 'sending' | 'sent' | 'failed';
  action: 'send' | 'schedule';
  error: string;
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

const emptyEntry = (): BulkEntry => ({
  id: makeId(),
  recipientEmail: '',
  companyName: '',
  jobTitle: '',
  intent: '',
  resumeText: '',
  subject: '',
  body: '',
  status: 'draft',
  action: 'send',
  error: '',
});

export function BulkEmailTab() {
  /* ── Credential state (persisted in localStorage) ── */
  const [credsSaved, setCredsSaved] = useState(() => {
    return !!(localStorage.getItem('bulk_sender_email') && localStorage.getItem('bulk_app_password'));
  });
  const [senderEmail, setSenderEmail] = useState(() => localStorage.getItem('bulk_sender_email') || '');
  const [appPassword, setAppPassword] = useState(() => localStorage.getItem('bulk_app_password') || '');
  const [setupError, setSetupError] = useState('');

  const handleSaveCreds = () => {
    if (!senderEmail.trim() || !senderEmail.includes('@')) {
      setSetupError('Please enter a valid Gmail address.');
      return;
    }
    if (!appPassword.trim() || appPassword.trim().length < 8) {
      setSetupError('Please enter a valid App Password (at least 8 characters).');
      return;
    }
    localStorage.setItem('bulk_sender_email', senderEmail.trim());
    localStorage.setItem('bulk_app_password', appPassword.trim());
    setCredsSaved(true);
    setSetupError('');
  };

  const handleResetCreds = () => {
    localStorage.removeItem('bulk_sender_email');
    localStorage.removeItem('bulk_app_password');
    setSenderEmail('');
    setAppPassword('');
    setCredsSaved(false);
  };

  const [entries, setEntries] = useState<BulkEntry[]>([emptyEntry()]);
  const [globalResume, setGlobalResume] = useState('');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<{ sent: number; failed: number } | null>(null);
  const [error, setError] = useState('');
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* ── Helpers ── */
  const updateEntry = (idx: number, patch: Partial<BulkEntry>) => {
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  };

  /* ══════════════════════════════════════════════════════════════
     ONE-TIME SETUP GATE
     ══════════════════════════════════════════════════════════════ */
  if (!credsSaved) {
    return (
      <div className="cold-email-container fade-in">
        <div className="bulk-setup-gate">
          <div className="bulk-setup-icon">🔑</div>
          <h2 className="bulk-setup-title">Gmail Setup</h2>
          <p className="bulk-setup-desc">
            Connect your Gmail to send bulk emails. This is a one-time setup — your credentials are saved locally and never sent to any server except Gmail's SMTP.
          </p>

          {setupError && <div className="ce-error"><span>⚠️</span> {setupError}</div>}

          <div className="bulk-setup-fields">
            <div className="ce-field">
              <label className="ce-label">Gmail Address</label>
              <input
                type="email"
                className="input"
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
                placeholder="you@gmail.com"
              />
            </div>
            <div className="ce-field">
              <label className="ce-label">App Password</label>
              <input
                type="password"
                className="input"
                value={appPassword}
                onChange={(e) => setAppPassword(e.target.value)}
                placeholder="xxxx xxxx xxxx xxxx"
              />
            </div>
          </div>

          <p className="bulk-setup-hint">
            Use a <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">Google App Password</a> — NOT your Gmail password. Enable 2FA first, then generate one.
          </p>

          <button className="btn btn-primary bulk-setup-btn" onClick={handleSaveCreds}>
            ✅ Save & Continue
          </button>
        </div>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════
     MAIN TAB (after credentials saved)
     ══════════════════════════════════════════════════════════════ */
  const addEntry = () => {
    setEntries((prev) => [...prev, emptyEntry()]);
  };

  const removeEntry = (idx: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== idx));
  };

  /* ── Resume Upload ── */
  const handleResumeUpload = async (file: File) => {
    setResumeFile(file);
    setResumeLoading(true);
    try {
      const result = await uploadResumeForText(file);
      setGlobalResume(result.text);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to extract resume text');
    } finally {
      setResumeLoading(false);
    }
  };

  /* ── Generate email for a single entry ── */
  const handleGenerate = async (idx: number) => {
    const entry = entries[idx];
    if (!entry.recipientEmail || !entry.companyName || !entry.jobTitle) {
      setError(`Row ${idx + 1}: Please fill recipient, company, and job title.`);
      return;
    }
    setError('');
    updateEntry(idx, { status: 'generating' });
    try {
      const resumeText = entry.resumeText || globalResume;
      const data = await generateColdEmail({
        job_title: entry.jobTitle,
        company_name: entry.companyName,
        resume_text: resumeText,
        intent: entry.intent,
      });
      updateEntry(idx, {
        subject: data.subject,
        body: data.body,
        status: 'ready',
      });
    } catch (err: unknown) {
      updateEntry(idx, {
        status: 'draft',
        error: err instanceof Error ? err.message : 'Generation failed',
      });
    }
  };

  /* ── Generate all drafts ── */
  const handleGenerateAll = async () => {
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].status === 'draft' && entries[i].recipientEmail && entries[i].companyName) {
        await handleGenerate(i);
      }
    }
  };

  /* ── Approve from preview ── */
  const handleApprove = (idx: number) => {
    updateEntry(idx, { status: 'approved' });
    setPreviewIdx(null);
  };

  /* ── Send all approved ── */
  const handleSendAll = async () => {
    if (!senderEmail || !appPassword) {
      setError('Please enter your Gmail and App Password in the credentials section.');
      return;
    }
    const approved = entries.filter((e) => e.status === 'approved');
    if (approved.length === 0) {
      setError('No approved emails to send. Preview and approve entries first.');
      return;
    }
    setError('');
    setSending(true);
    setResults(null);

    // Mark as sending
    setEntries((prev) =>
      prev.map((e) =>
        e.status === 'approved' ? { ...e, status: 'sending' as const } : e
      )
    );

    try {
      const payload = {
        entries: approved.map((e) => ({
          id: e.id,
          recipient_email: e.recipientEmail,
          company_name: e.companyName,
          job_title: e.jobTitle,
          intent: e.intent,
          resume_text: e.resumeText || globalResume,
          subject: e.subject,
          body: e.body,
          status: 'approved',
          action: e.action,
        })),
        sender_email: senderEmail,
        sender_app_password: appPassword,
      };

      const data = await sendBulkEmails(payload);

      // Update statuses from results
      setEntries((prev) =>
        prev.map((e) => {
          const r = data.results.find((res) => res.id === e.id);
          if (r) {
            return {
              ...e,
              status: r.status as BulkEntry['status'],
              error: r.error || '',
            };
          }
          return e;
        })
      );

      setResults({ sent: data.total_sent, failed: data.total_failed });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Bulk send failed');
      setEntries((prev) =>
        prev.map((e) =>
          e.status === 'sending' ? { ...e, status: 'approved' as const } : e
        )
      );
    } finally {
      setSending(false);
    }
  };

  const approvedCount = entries.filter((e) => e.status === 'approved').length;
  const readyCount = entries.filter((e) => e.status === 'ready').length;

  /* ══════════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════════ */
  return (
    <div className="cold-email-container fade-in">
      {/* Header */}
      <div className="ce-header">
        <div className="ce-header-icon">📮</div>
        <div>
          <h2 className="ce-title">Bulk Email Tool</h2>
          <p className="ce-subtitle">
            Sending as <strong>{senderEmail}</strong>{' · '}
            <button className="bulk-change-creds" onClick={handleResetCreds}>Change</button>
          </p>
        </div>
      </div>

      {error && <div className="ce-error"><span>⚠️</span> {error}</div>}
      {results && (
        <div className="ce-success">
          ✅ Batch complete: {results.sent} sent, {results.failed} failed
        </div>
      )}

      {/* ── Resume (shared) ── */}
      <div className="bulk-section">
        <h3 className="ce-section-title">📄 Resume (shared for all entries)</h3>
        <div className="ce-upload-area" onClick={() => fileRef.current?.click()}>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleResumeUpload(f);
            }}
          />
          {resumeLoading ? (
            <div className="ce-upload-status"><span className="ce-spinner" /> Extracting...</div>
          ) : resumeFile ? (
            <div className="ce-upload-status">✅ {resumeFile.name}</div>
          ) : (
            <div className="ce-upload-prompt">
              <span className="ce-upload-icon">📎</span>
              <span>Click to upload PDF resume</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Entry Table ── */}
      <div className="bulk-section">
        <div className="bulk-table-header">
          <h3 className="ce-section-title">📋 Email Queue ({entries.length})</h3>
          <div className="bulk-table-actions">
            <button className="btn btn-secondary btn-sm" onClick={handleGenerateAll} disabled={sending}>
              ⚡ Generate All
            </button>
            <button className="btn btn-primary btn-sm" onClick={addEntry} disabled={sending}>
              + Add Entry
            </button>
          </div>
        </div>

        <div className="bulk-entries">
          {entries.map((entry, idx) => (
            <div key={entry.id} className={`bulk-entry bulk-entry--${entry.status}`}>
              <div className="bulk-entry-header">
                <span className="bulk-entry-num">#{idx + 1}</span>
                <span className={`bulk-entry-status bulk-status--${entry.status}`}>
                  {entry.status === 'draft' && '📝 Draft'}
                  {entry.status === 'generating' && '⏳ Generating...'}
                  {entry.status === 'ready' && '✨ Ready'}
                  {entry.status === 'approved' && '✅ Approved'}
                  {entry.status === 'sending' && '📤 Sending...'}
                  {entry.status === 'sent' && '✅ Sent!'}
                  {entry.status === 'failed' && `❌ Failed${entry.error ? ': ' + entry.error.slice(0, 50) : ''}`}
                </span>
                <div className="bulk-entry-actions">
                  <select
                    className="select select--sm"
                    value={entry.action}
                    onChange={(e) => updateEntry(idx, { action: e.target.value as 'send' | 'schedule' })}
                    disabled={entry.status === 'sent' || sending}
                  >
                    <option value="send">Send Now</option>
                    <option value="schedule">Schedule (30s gap)</option>
                  </select>
                  {entries.length > 1 && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => removeEntry(idx)}
                      disabled={sending}
                      title="Remove"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>

              <div className="bulk-entry-fields">
                <input
                  className="input input--sm"
                  placeholder="recipient@company.com"
                  value={entry.recipientEmail}
                  onChange={(e) => updateEntry(idx, { recipientEmail: e.target.value })}
                  disabled={entry.status === 'sent' || sending}
                />
                <input
                  className="input input--sm"
                  placeholder="Company Name"
                  value={entry.companyName}
                  onChange={(e) => updateEntry(idx, { companyName: e.target.value })}
                  disabled={entry.status === 'sent' || sending}
                />
                <input
                  className="input input--sm"
                  placeholder="Job Title"
                  value={entry.jobTitle}
                  onChange={(e) => updateEntry(idx, { jobTitle: e.target.value })}
                  disabled={entry.status === 'sent' || sending}
                />
                <input
                  className="input input--sm"
                  placeholder="Intent (e.g. casual tone, highlight React skills)"
                  value={entry.intent}
                  onChange={(e) => updateEntry(idx, { intent: e.target.value })}
                  disabled={entry.status === 'sent' || sending}
                />
              </div>

              <div className="bulk-entry-btns">
                {(entry.status === 'draft' || entry.status === 'failed') && (
                  <button className="btn btn-accent btn-sm" onClick={() => handleGenerate(idx)} disabled={sending}>
                    ⚡ Generate
                  </button>
                )}
                {(entry.status === 'ready' || entry.status === 'approved') && (
                  <button className="btn btn-secondary btn-sm" onClick={() => setPreviewIdx(idx)}>
                    👁️ Preview & Approve
                  </button>
                )}
                {entry.status === 'ready' && (
                  <button className="btn btn-primary btn-sm" onClick={() => handleApprove(idx)}>
                    ✅ Quick Approve
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Send All ── */}
      <div className="bulk-send-section">
        <div className="bulk-send-stats">
          <span>{approvedCount} approved</span>
          <span>·</span>
          <span>{readyCount} ready for review</span>
        </div>
        <button
          className="btn btn-primary bulk-send-all-btn"
          onClick={handleSendAll}
          disabled={sending || approvedCount === 0}
        >
          {sending ? (
            <><span className="ce-spinner" /> Processing batch...</>
          ) : (
            `📤 Send All Approved (${approvedCount})`
          )}
        </button>
        <p className="ce-send-hint">
          "Send Now" emails go immediately. "Schedule" emails are sent with ~30 second gaps to avoid spam filters.
        </p>
      </div>

      {/* ── Preview Modal ── */}
      {previewIdx !== null && entries[previewIdx] && (
        <div className="bulk-modal-overlay" onClick={() => setPreviewIdx(null)}>
          <div className="bulk-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bulk-modal-header">
              <h3>Preview Email #{previewIdx + 1}</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setPreviewIdx(null)}>✕</button>
            </div>

            <div className="ce-field">
              <label className="ce-label">To</label>
              <input className="input" value={entries[previewIdx].recipientEmail} readOnly />
            </div>

            <div className="ce-field">
              <label className="ce-label">Subject</label>
              <input
                className="input"
                value={entries[previewIdx].subject}
                onChange={(e) => updateEntry(previewIdx, { subject: e.target.value })}
              />
            </div>

            <div className="ce-field">
              <label className="ce-label">Body</label>
              <textarea
                className="input ce-textarea"
                value={entries[previewIdx].body}
                onChange={(e) => updateEntry(previewIdx, { body: e.target.value })}
                rows={12}
              />
            </div>

            <div className="bulk-modal-actions">
              <button className="btn btn-secondary" onClick={() => setPreviewIdx(null)}>
                Cancel
              </button>
              <button className="btn btn-accent" onClick={() => handleGenerate(previewIdx)}>
                ↺ Regenerate
              </button>
              <button className="btn btn-primary" onClick={() => handleApprove(previewIdx)}>
                ✅ Approve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
