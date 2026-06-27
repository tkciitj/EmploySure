/* ── main.tsx — Entry Point ──────────────────────────────────── */

import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

/* No StrictMode to avoid double-render issues with SSE subscriptions */
createRoot(rootEl).render(<App />);
