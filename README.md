# LifeTracker

A personal life, career, and wealth tracker. Multi-user, self-hosted, no external dependencies required to run locally.

## Features

- **Accounts** — email/password registration and login, sessions scoped per user (`express-session`), an optional "Sign in with Google" (finds-or-creates an account by email), a "Keep me signed in" toggle (persistent 30-day session vs. a session-only cookie cleared when the browser closes), and browser-native password-save support (real `<form>` submits + the Credential Management API)
- **Onboarding wizard** — name, wealth targets, and first project on first login
- **Projects & sub-folders** — one level of nested sub-projects (e.g. "UK Career Goals" → "Cloud Engineering Goals"), each individually editable
- **Project types** — a top-level project is either **Career** or **Wealth**; more types can be added later. Both get a full task list (add/edit/delete, filters, KPIs) — a Wealth project additionally shows a banner linking to the Wealth Tracker for its £ categories/monthly log/chart
- **Tasks** — status, priority, start/due dates, notes; "Add to Google Calendar" per task
- **Gantt chart** — drag-to-move / drag-to-resize bars, collapsible groups by project (a project's sub-folders always stay grouped directly beneath it, never scattered alphabetically among unrelated projects), Week/Month/Year zoom, a project filter dropdown to zoom into a single project's tasks, frozen Task/Status/Start/Due/Duration columns with a horizontally scrolling timeline, and **Print/PDF** (the browser's native print, with a stylesheet that un-freezes the columns) or **Export Image** (a server-side headless-browser screenshot of the live chart — more reliable than a client-side canvas library, which clips text in this chart's CSS Grid rows). Shows real tasks only — Wealth-type projects appear here the same as Career ones, via their tasks
- **Dashboard** — dynamic per project type: the Career Progress and Net Worth hero cards (and the Net Worth KPI) only appear once you actually have a project of that type, and reflow to fill the row when only one is present
- **Wealth tracker** — categories with editable targets (add/edit/delete), current values, a net worth chart, and a monthly income/savings log; reached via a Wealth-type project rather than a dedicated nav item
- **Actions** — a live, auto-generated feed (not a maintained list) of Overdue, Due This Week, and High-priority-in-progress tasks across every project; mark one done straight from the feed
- **AI Insights** (optional) — a "✨ Analyze My Tasks" button on the Actions page sends your open tasks to Claude and gets back a prioritized focus list plus 2-4 suggested next-step tasks you can add with one click
- **Import Project from File** (optional) — on All Projects, upload a `.xlsx`/`.pdf`/`.png`/`.jpg` (a plan, checklist, or spreadsheet) and Claude proposes a project with tasks extracted from it; every field is editable and nothing is created until you confirm
- **Google Drive backup** (optional) — connect a Google account to export data as JSON, Excel, Google Sheets, PDF, or image
- **Dark mode**
- **Mobile responsive layout**

## Tech stack

- **Backend**: Node.js + Express, `better-sqlite3` (SQLite), `express-session`, `bcryptjs`
- **Frontend**: Vanilla JS + Tailwind CSS (CDN) — no build step
- **Exports**: `exceljs` (Excel), `puppeteer-core` (PDF/image reports), `googleapis` (Drive/Sheets)
- **AI**: `@anthropic-ai/sdk` (Claude, tool-use for structured output — task prioritization and file-to-project extraction), `multer` (file uploads)

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:

| Variable | Required | Notes |
|---|---|---|
| `SESSION_SECRET` | Yes (production) | Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `PORT` | No | Defaults to `3000`; most hosts set this automatically |
| `DB_PATH` | No | Defaults to `backend/db/lifetracker.sqlite`. On most cloud hosts the filesystem resets on redeploy — point this at a mounted persistent volume in production |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | No | Powers both Google Drive backup/export AND "Sign in with Google". Create in Google Cloud Console → APIs & Services → Credentials, and add **both** `.../api/drive/callback` and `.../api/auth/google/callback` as Authorized redirect URIs on that one OAuth client |
| `NODE_ENV` | No | Set to `production` when deployed, so session cookies require HTTPS |
| `PUPPETEER_EXECUTABLE_PATH` | No | Path to a Chromium-family browser, only needed if one isn't auto-detected (used for PDF/image report rendering) |
| `ANTHROPIC_API_KEY` | No | Only needed for the "✨ AI Insights" button on the Actions page. Get one at [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |

Run it:

```bash
npm start        # production
npm run dev       # auto-restart on change (nodemon)
```

Then open `http://localhost:3000`.

## Deploying

A `Procfile` (`web: node backend/server.js`) is included for Heroku-style platforms. For any host:

1. Set `SESSION_SECRET` and `NODE_ENV=production`.
2. Attach persistent storage and set `DB_PATH` to a file inside it — otherwise the SQLite database is wiped on every redeploy.
3. Set the Google OAuth variables only if Drive backup should be enabled.

## Project structure

```
backend/
  server.js           entry point, middleware, route mounting
  db/                  SQLite connection, schema/migrations, data-access layer
  middleware/          session auth gate
  routes/              one file per API resource (auth, projects, tasks, wealth, drive, ai, reports, profile)
  reports/             Excel/PDF/image export generation, plus the Gantt chart's image export
frontend/
  index.html           all pages/modals (single-page app, no router)
  js/app.js            UI logic, rendering, event handling
  js/api.js            thin fetch wrapper for the backend API
```

Personal data files (e.g. `AdekolaProjects/`) are gitignored and never pushed — this repo is public.

## License

All rights reserved — see [LICENSE](LICENSE). No permission is granted to use, copy, modify, or distribute this code.
