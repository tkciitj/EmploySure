/* ── ColdEmailTab — AI-Powered Cold Email Drafter ──────────── */

import { useState, useRef } from 'react';
import { generateColdEmail, findContacts, uploadResumeForText } from '../utils/api';

interface Contact {
  name: string;
  role: string;
  email: string;
}

type Step = 'input' | 'contacts' | 'resume' | 'generate' | 'result';

export function ColdEmailTab() {
  /* ── Step management ── */
  const [step, setStep] = useState<Step>('input');

  /* ── Step 1: Job + Company ── */
  const [jobTitle, setJobTitle] = useState('');
  const [companyName, setCompanyName] = useState('');

  /* ── Step 2: Contacts ── */
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsNote, setContactsNote] = useState('');
  const [selectedEmail, setSelectedEmail] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [contactsLoading, setContactsLoading] = useState(false);

  /* ── Step 3: Resume ── */
  const [resumeText, setResumeText] = useState('');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeLoading, setResumeLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /* ── Step 4: Intent ── */
  const [intent, setIntent] = useState('');

  /* ── Step 5: Generated email ── */
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  /* ── Gmail ── */
  const [gmailStatus, setGmailStatus] = useState('');

  /* ── Shared ── */
  const [error, setError] = useState('');

  const recipientEmail = selectedEmail === '__manual__' ? manualEmail : selectedEmail;

  /* ══════════════════════════════════════════════════════════════
     Step 1 → 2: Find Contacts
     ══════════════════════════════════════════════════════════════ */
  const handleFindContacts = async () => {
    if (!jobTitle.trim() || !companyName.trim()) {
      setError('Please enter both Job Title and Company Name.');
      return;
    }
    setError('');
    setContactsLoading(true);
    try {
      const data = await findContacts({
        company_name: companyName.trim(),
        job_title: jobTitle.trim(),
      });
      setContacts(data.contacts);
      setContactsNote(data.note);
      setStep('contacts');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to find contacts');
    } finally {
      setContactsLoading(false);
    }
  };

  /* ══════════════════════════════════════════════════════════════
     Step 3: Resume Upload
     ══════════════════════════════════════════════════════════════ */
  const handleFileUpload = async (file: File) => {
    setResumeFile(file);
    setResumeLoading(true);
    setError('');
    try {
      const result = await uploadResumeForText(file);
      setResumeText(result.text);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to extract resume text');
    } finally {
      setResumeLoading(false);
    }
  };

  /* ══════════════════════════════════════════════════════════════
     Step 4 → 5: Generate Email
     ══════════════════════════════════════════════════════════════ */
  const handleGenerate = async () => {
    if (!resumeText.trim()) {
      setError('Please upload a resume or paste your skills/experience.');
      return;
    }
    setError('');
    setGenerating(true);
    try {
      const data = await generateColdEmail({
        job_title: jobTitle.trim(),
        company_name: companyName.trim(),
        resume_text: resumeText.trim(),
        intent: intent.trim(),
      });
      setSubject(data.subject);
      setBody(data.body);
      setStep('result');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate email');
    } finally {
      setGenerating(false);
    }
  };

  /* ══════════════════════════════════════════════════════════════
     Actions: Copy / mailto / Gmail
     ══════════════════════════════════════════════════════════════ */
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* */ }
  };

  const handleMailto = () => {
    const mailto = `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailto, '_blank');
  };

  const handleGmailSend = () => {
    if (!recipientEmail) {
      setError('Please select or enter a recipient email.');
      return;
    }
    // Open Gmail compose window directly — no OAuth needed
    const gmailUrl = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(recipientEmail)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(gmailUrl, '_blank');
    setGmailStatus('✅ Gmail compose window opened! Check your browser tabs.');
  };

  const handleRegenerate = () => {
    setStep('generate');
    setSubject('');
    setBody('');
  };

  const handleStartOver = () => {
    setStep('input');
    setJobTitle('');
    setCompanyName('');
    setContacts([]);
    setSelectedEmail('');
    setManualEmail('');
    setResumeText('');
    setResumeFile(null);
    setIntent('');
    setSubject('');
    setBody('');
    setError('');
    setGmailStatus('');
  };

  /* ══════════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════════ */
  return (
    <div className="cold-email-container fade-in">
      {/* Header */}
      <div className="ce-header">
        <div className="ce-header-icon">✉️</div>
        <div>
          <h2 className="ce-title">AI Cold Email Drafter</h2>
          <p className="ce-subtitle">Generate personalized cold emails to hiring managers</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="ce-steps">
        {['Target', 'Contacts', 'Resume', 'Intent', 'Email'].map((label, i) => {
          const stepOrder: Step[] = ['input', 'contacts', 'resume', 'generate', 'result'];
          const currentIdx = stepOrder.indexOf(step);
          const isActive = i <= currentIdx;
          return (
            <div key={label} className={`ce-step ${isActive ? 'ce-step--active' : ''}`}>
              <div className="ce-step-dot">{i < currentIdx ? '✓' : i + 1}</div>
              <span className="ce-step-label">{label}</span>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="ce-error">
          <span>⚠️</span> {error}
        </div>
      )}

      {gmailStatus && (
        <div className="ce-success">{gmailStatus}</div>
      )}

      {/* ─── STEP 1: Job Title + Company ─── */}
      {step === 'input' && (
        <div className="ce-form fade-in">
          <div className="ce-form-row">
            <div className="ce-field">
              <label className="ce-label">Job Title *</label>
              <input
                type="text"
                className="input"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="e.g. Senior Frontend Developer"
              />
            </div>
            <div className="ce-field">
              <label className="ce-label">Company Name *</label>
              <input
                type="text"
                className="input"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Google, Razorpay, Flipkart"
                onKeyDown={(e) => e.key === 'Enter' && handleFindContacts()}
              />
            </div>
          </div>
          <button
            className="btn btn-primary"
            onClick={handleFindContacts}
            disabled={contactsLoading}
          >
            {contactsLoading ? (
              <><span className="ce-spinner" /> Finding contacts...</>
            ) : (
              '🔍 Find Hiring Contacts'
            )}
          </button>
        </div>
      )}

      {/* ─── STEP 2: Select Contact ─── */}
      {step === 'contacts' && (
        <div className="ce-form fade-in">
          <h3 className="ce-section-title">📋 Suggested Contacts at {companyName}</h3>
          {contactsNote && <p className="ce-note">ℹ️ {contactsNote}</p>}

          <div className="ce-contacts-list">
            {contacts.map((c, i) => (
              <label key={i} className={`ce-contact-card ${selectedEmail === c.email ? 'ce-contact-card--selected' : ''}`}>
                <input
                  type="radio"
                  name="contact"
                  value={c.email}
                  checked={selectedEmail === c.email}
                  onChange={() => setSelectedEmail(c.email)}
                />
                <div className="ce-contact-info">
                  <span className="ce-contact-name">{c.name}</span>
                  <span className="ce-contact-role">{c.role}</span>
                  <span className="ce-contact-email">{c.email}</span>
                </div>
              </label>
            ))}

            {/* Manual entry option */}
            <label className={`ce-contact-card ${selectedEmail === '__manual__' ? 'ce-contact-card--selected' : ''}`}>
              <input
                type="radio"
                name="contact"
                value="__manual__"
                checked={selectedEmail === '__manual__'}
                onChange={() => setSelectedEmail('__manual__')}
              />
              <div className="ce-contact-info">
                <span className="ce-contact-name">✏️ Enter manually</span>
              </div>
            </label>
          </div>

          {selectedEmail === '__manual__' && (
            <div className="ce-field">
              <input
                type="email"
                className="input"
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                placeholder="hiring.manager@company.com"
              />
            </div>
          )}

          <div className="ce-actions">
            <button className="btn btn-secondary" onClick={() => setStep('input')}>← Back</button>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (!recipientEmail) {
                  setError('Please select a contact or enter an email.');
                  return;
                }
                setError('');
                setStep('resume');
              }}
            >
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* ─── STEP 3: Resume ─── */}
      {step === 'resume' && (
        <div className="ce-form fade-in">
          <h3 className="ce-section-title">📄 Your Resume / Key Details</h3>

          <div className="ce-upload-area" onClick={() => fileRef.current?.click()}>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileUpload(f);
              }}
            />
            {resumeLoading ? (
              <div className="ce-upload-status"><span className="ce-spinner" /> Extracting text from PDF...</div>
            ) : resumeFile ? (
              <div className="ce-upload-status">✅ {resumeFile.name} — text extracted</div>
            ) : (
              <div className="ce-upload-prompt">
                <span className="ce-upload-icon">📎</span>
                <span>Click to upload PDF resume</span>
                <span className="ce-upload-hint">or paste your details below</span>
              </div>
            )}
          </div>

          <div className="ce-field">
            <label className="ce-label">Resume Text / Skills / Experience</label>
            <textarea
              className="input ce-textarea"
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
              placeholder="Paste your resume, key skills, projects, and experience here..."
              rows={8}
            />
          </div>

          <div className="ce-actions">
            <button className="btn btn-secondary" onClick={() => setStep('contacts')}>← Back</button>
            <button className="btn btn-primary" onClick={() => { setError(''); setStep('generate'); }}>
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* ─── STEP 4: Intent / Feedback ─── */}
      {step === 'generate' && (
        <div className="ce-form fade-in">
          <h3 className="ce-section-title">🎯 Email Intent & Tone</h3>
          <p className="ce-note">
            Customize how the AI drafts your email. Leave blank for a standard professional tone.
          </p>

          <div className="ce-field">
            <label className="ce-label">Intent / Feedback <span className="ce-optional">(optional)</span></label>
            <textarea
              className="input ce-textarea"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder={"Examples:\n• Make it more casual and friendly\n• Emphasize my React and TypeScript experience\n• Mention I'm relocating to Bangalore\n• Keep it very short, under 100 words\n• I was referred by someone at the company"}
              rows={5}
            />
          </div>

          <div className="ce-summary">
            <div className="ce-summary-row"><span>📌 Role:</span> {jobTitle} at {companyName}</div>
            <div className="ce-summary-row"><span>📧 To:</span> {recipientEmail}</div>
            <div className="ce-summary-row"><span>📄 Resume:</span> {resumeText.length > 0 ? `${resumeText.slice(0, 60)}...` : 'Not provided'}</div>
          </div>

          <div className="ce-actions">
            <button className="btn btn-secondary" onClick={() => setStep('resume')}>← Back</button>
            <button
              className="btn btn-primary"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? (
                <><span className="ce-spinner" /> Generating...</>
              ) : (
                '⚡ Generate Email'
              )}
            </button>
          </div>
        </div>
      )}

      {/* ─── STEP 5: Result ─── */}
      {step === 'result' && (
        <div className="ce-form fade-in">
          <div className="ce-output-header">
            <h3 className="ce-section-title">📧 Your Cold Email</h3>
            <div className="ce-output-actions">
              <button className="btn btn-ghost btn-sm" onClick={handleCopy}>
                {copied ? '✅ Copied!' : '📋 Copy'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={handleRegenerate}>
                ↺ Regenerate
              </button>
            </div>
          </div>

          <div className="ce-field">
            <label className="ce-label">To</label>
            <input type="text" className="input" value={recipientEmail} readOnly />
          </div>

          <div className="ce-field">
            <label className="ce-label">Subject</label>
            <input
              type="text"
              className="input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div className="ce-field">
            <label className="ce-label">Body</label>
            <textarea
              className="input ce-textarea"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
            />
          </div>

          <div className="ce-send-row">
            <button className="btn btn-accent ce-send-btn" onClick={handleMailto}>
              📨 Open in Mail Client
            </button>
            <button
              className="btn btn-primary ce-send-btn"
              onClick={handleGmailSend}
            >
              📤 Open in Gmail
            </button>
          </div>
          <p className="ce-send-hint">
            Both options open a compose window with your email pre-filled. Edit and send from there.
          </p>

          <div className="ce-actions" style={{ marginTop: '8px' }}>
            <button className="btn btn-secondary" onClick={handleStartOver}>
              ✨ Start Over
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
