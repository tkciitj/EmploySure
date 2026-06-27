# ⚡ EmploySure — AI-Powered Real-Time Job Search Agent

A free, zero-paywall, anti-scam job search aggregator that scrapes job listings from any URL, filters out garbage using AI, and presents a clean, unified dashboard.

**No resume upsells. No AI cover letter filler. No dead links. Just real jobs.**

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite |
| Styling | Vanilla CSS (custom design system with glassmorphism & gradients) |
| Backend | Python 3.11+ + FastAPI |
| Scraping | crawl4ai (Playwright-based headless browser) |
| AI Primary | Google Gemini 2.5 Flash (free tier) |
| AI Fallback | Groq Llama 3.3 70B (free tier) |
| AI Offline | Ollama (local models, optional) |
| Database | SQLite (dev) → PostgreSQL (production) |
| Scheduling | APScheduler (async background jobs) |

---

## 🚀 Quick Start

### Prerequisites
- **Python 3.11+** — [Download](https://www.python.org/downloads/)
- **Node.js 18+** — [Download](https://nodejs.org/)
- **At least one AI API key** (free):
  - [Google AI Studio](https://aistudio.google.com/) → Get a Gemini API key
  - [Groq Console](https://console.groq.com/) → Get a Groq API key
  - Or install [Ollama](https://ollama.ai/) for local AI (no key needed)

### 1. Clone & Configure

```bash
# Navigate to the project
cd EmploySure

# Set up backend environment
cd backend
cp .env.example .env
# Edit .env and add your API key(s)
```

### 2. Start the Backend

```bash
cd backend

# Create virtual environment
python -m venv .venv

# Activate it
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Setup crawl4ai (installs Playwright browsers)
crawl4ai-setup

# Start the server
python -m app.main
```

The backend will start at `http://localhost:8000`.

### 3. Start the Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

The frontend will open at `http://localhost:5173`.

---

## 📋 Features

### ✅ Phase 1: Real-Time Multi-Source Scraping
- Add any URL — job boards, GitHub repos, company career pages
- Headless browser rendering (JavaScript-heavy pages supported)
- AI-powered anti-scam filtering (discards courses, MLM, resume services)

### ✅ Phase 2: Unified Dashboard
- Clean, spreadsheet-inspired data table
- One-click "Apply Direct ↗️" to the real application page
- Client-side instant filtering by title, experience, location
- Hide agency/recruiter postings with a single toggle
- Dark mode (default) + Light mode toggle

### ✅ Phase 3: Background Automation
- Hourly re-crawl of all active sources
- Automatic dead link detection and archival
- Database de-duplication (no duplicate job listings)

---

## 🔑 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sources` | Add a new scraping target |
| GET | `/api/sources` | List all sources with status |
| DELETE | `/api/sources/{id}` | Remove a source |
| POST | `/api/scrape` | Trigger background scrape |
| GET | `/api/jobs` | List jobs (filterable, paginated) |
| GET | `/api/jobs/stream` | SSE for real-time updates |
| PATCH | `/api/jobs/{id}/hide` | Hide a listing |
| GET | `/api/stats` | Dashboard statistics |
| GET | `/api/health` | Health check |

---

## 🎨 Design

- **Dark Mode Default**: Deep purple/indigo/violet gradient mesh background
- **Glassmorphism**: Frosted glass panels with backdrop-filter blur
- **Micro-Animations**: Button glow, row slide-in, pulsing status dots
- **Light Mode**: Clean black & white minimal theme
- **Inter Font**: Modern typography from Google Fonts
- **Fully Responsive**: Desktop, tablet, and mobile

---

## 📄 License

This project is free and open-source. Built to serve the community.
