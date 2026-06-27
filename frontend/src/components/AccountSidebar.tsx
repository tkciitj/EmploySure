/* ── AccountSidebar — Google OAuth 2.0 + Email Fallback ────── */

import { useState, useEffect, useCallback, useRef } from 'react';

interface UserProfile {
  name: string;
  email: string;
  avatar?: string;
}

interface AccountSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void;
          renderButton: (el: HTMLElement, config: Record<string, unknown>) => void;
          disableAutoSelect: () => void;
          revoke: (email: string, cb: () => void) => void;
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = '785383354696-0i99r1bcqlaqnnhissl9slch31ngav8a.apps.googleusercontent.com';

function parseGoogleJwt(credential: string): UserProfile | null {
  try {
    const base64Url = credential.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64).split('').map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
    const p = JSON.parse(json);
    return { name: p.name || p.given_name || 'User', email: p.email || '', avatar: p.picture || undefined };
  } catch {
    return null;
  }
}

export function AccountSidebar({ isOpen, onClose }: AccountSidebarProps) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [googleError, setGoogleError] = useState(false);
  const [fuelStep, setFuelStep] = useState<'idle' | 'confirm' | 'qr'>('idle');
  const googleBtnRef = useRef<HTMLDivElement>(null);
  const scriptLoadedRef = useRef(false);

  // Load saved user
  useEffect(() => {
    const saved = localStorage.getItem('employsure_user');
    if (saved) {
      try { setUser(JSON.parse(saved)); } catch { /* */ }
    }
  }, []);

  // Reset fuel step when sidebar closes
  useEffect(() => {
    if (!isOpen) setFuelStep('idle');
  }, [isOpen]);

  const handleCredential = useCallback((response: { credential: string }) => {
    const profile = parseGoogleJwt(response.credential);
    if (profile) {
      localStorage.setItem('employsure_user', JSON.stringify(profile));
      setUser(profile);
      setGoogleError(false);
    }
  }, []);

  // Initialize Google Identity Services
  useEffect(() => {
    if (!isOpen || user) return;

    const init = () => {
      if (!window.google || !googleBtnRef.current) return;
      try {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleCredential,
          auto_select: false,
        });
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: 'outline',
          size: 'large',
          width: 280,
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'center',
        });
      } catch {
        setGoogleError(true);
      }
    };

    if (window.google) {
      setTimeout(init, 50);
      return;
    }

    if (!scriptLoadedRef.current) {
      scriptLoadedRef.current = true;
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.defer = true;
      s.onload = () => setTimeout(init, 100);
      s.onerror = () => setGoogleError(true);
      document.head.appendChild(s);
    }
  }, [isOpen, user, handleCredential]);

  const handleEmailSignIn = () => {
    if (!nameInput.trim() || !emailInput.trim()) return;
    const profile: UserProfile = { name: nameInput.trim(), email: emailInput.trim() };
    localStorage.setItem('employsure_user', JSON.stringify(profile));
    setUser(profile);
  };

  const handleSignOut = () => {
    if (user?.email && window.google) {
      try { window.google.accounts.id.revoke(user.email, () => {}); } catch { /* */ }
    }
    localStorage.removeItem('employsure_user');
    setUser(null);
    setNameInput('');
    setEmailInput('');
  };

  const getInitials = (name: string) =>
    name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');

  return (
    <>
      {isOpen && <div className="account-backdrop" onClick={onClose} />}

      <aside className={`account-sidebar ${isOpen ? 'account-sidebar--open' : ''}`}>
        <div className="account-sidebar-header">
          <h3 className="account-sidebar-title">Account</h3>
          <button className="account-close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {user ? (
          <div className="account-profile">
            <div className="account-avatar">
              {user.avatar ? (
                <img src={user.avatar} alt={user.name} className="account-avatar-img" referrerPolicy="no-referrer" />
              ) : (
                <span>{getInitials(user.name)}</span>
              )}
            </div>
            <div className="account-info">
              <div className="account-name">{user.name}</div>
              <div className="account-email">{user.email}</div>
            </div>
            <div className="account-actions">
              <div className="account-status">
                <span className="account-status-dot" />
                Signed In
              </div>
              <button className="btn btn-secondary btn-sm" onClick={handleSignOut} style={{ width: '100%' }}>
                Sign Out
              </button>
            </div>
          </div>
        ) : (
          <div className="account-signin">
            {/* Google Sign-In */}
            {!googleError && (
              <>
                <div className="google-btn-wrapper">
                  <div ref={googleBtnRef} className="google-btn-container" />
                </div>
                <div className="account-divider"><span>or</span></div>
              </>
            )}

            {googleError && (
              <div className="account-google-note">
                <p>⚠️ Google Sign-In requires adding <code>http://localhost:5173</code> as an authorized origin in your <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">Google Cloud Console</a>.</p>
              </div>
            )}

            {/* Email Sign In */}
            <p className="account-signin-title">Sign in to save your session</p>
            <div className="account-form">
              <input
                type="text"
                className="input"
                placeholder="Your name"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
              />
              <input
                type="email"
                className="input"
                placeholder="Your email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleEmailSignIn()}
              />
              <button
                className="btn btn-primary"
                onClick={handleEmailSignIn}
                disabled={!nameInput.trim() || !emailInput.trim()}
              >
                Sign In
              </button>
            </div>
          </div>
        )}

        {/* ── Fuel the Vision ── */}
        <div className="fuel-section">
          {fuelStep === 'idle' && (
            <button className="fuel-btn" onClick={() => setFuelStep('confirm')}>
              <span className="fuel-btn-icon">🚀</span>
              <span>Fuel the Vision</span>
            </button>
          )}

          {fuelStep === 'confirm' && (
            <div className="fuel-confirm">
              <p className="fuel-confirm-text">Are you sure that's not a mistake?<br />Do you really want to support?</p>
              <div className="fuel-confirm-btns">
                <button className="btn btn-accent btn-sm" onClick={() => setFuelStep('qr')}>Yes, I'm sure! 💛</button>
                <button className="btn btn-secondary btn-sm" onClick={onClose}>No, close</button>
              </div>
            </div>
          )}

          {fuelStep === 'qr' && (
            <div className="fuel-qr">
              <p className="fuel-qr-title">You're amazing! 🎉</p>
              <img src="/payment_qr.png" alt="Payment QR" className="fuel-qr-img" />
              <p className="fuel-qr-caption">Scan to support the mission</p>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="sidebar-footer">
          made with ❤️ for the resilient ones
        </div>
      </aside>
    </>
  );
}
