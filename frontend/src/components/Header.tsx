/* ── Header Component ───────────────────────────────────────── */

import { useState } from 'react';
import type { Stats } from '../types';

interface HeaderProps {
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  stats: Stats;
  onAccountClick?: () => void;
}

const LOGO_MESSAGES = [
  'You found the secret! 🎉',
  'Keep clicking, good things come to those who persist! 💪',
  'Achievement unlocked: Curious Explorer 🏆',
  "You're hired! ...just kidding. Keep searching 😄",
  '10x Developer Energy Detected ⚡',
];

export function Header({ theme, toggleTheme, stats, onAccountClick }: HeaderProps) {
  const [clickCount, setClickCount] = useState(0);
  const [easterMsg, setEasterMsg] = useState<string | null>(null);

  const handleLogoClick = () => {
    const next = clickCount + 1;
    setClickCount(next);
    if (next >= 5) {
      const msg = LOGO_MESSAGES[Math.floor(Math.random() * LOGO_MESSAGES.length)];
      setEasterMsg(msg);
      setClickCount(0);
      setTimeout(() => setEasterMsg(null), 3000);
    }
  };

  return (
    <header className="header">
      <div className="header-brand" onClick={handleLogoClick} style={{ cursor: 'pointer', userSelect: 'none' }}>
        <div className="header-logo" aria-hidden="true">
          ⚡
        </div>
        <div>
          <div className="header-title">EmploySure</div>
          <div className="header-tagline">Your AI-Powered Job Search Agent</div>
        </div>
      </div>

      {/* Easter egg toast */}
      {easterMsg && (
        <div className="easter-toast">
          {easterMsg}
        </div>
      )}

      <div className="header-actions">
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          <span key={theme} className="theme-toggle-icon">
            {theme === 'dark' ? '☀️' : '🌙'}
          </span>
        </button>
        <button
          className="account-toggle"
          onClick={onAccountClick}
          aria-label="Account"
          title="Account"
        >
          👤
        </button>
      </div>
    </header>
  );
}
