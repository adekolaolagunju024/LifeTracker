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
- **Export / Import Data (JSON)** — Settings has a full account export (profile, projects, tasks, wealth) and a matching import that recreates it for the current user, remapping project/sub-folder ids as needed. Additive, not a wipe-and-replace — the standard way to move data between two instances (e.g. local → a fresh deploy)
- **Dark mode**
- **Mobile responsive layout**

## Tech stack

- **Backend**: Node.js (22+) + Express, `better-sqlite3` (SQLite), `express-session` backed by `better-sqlite3-session-store` (sessions survive redeploys), `bcryptjs`
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
| `PUPPETEER_EXECUTABLE_PATH` | No | Path to a Chromium-family browser, used for PDF/image reports and the Gantt chart's image export. The `Dockerfile` sets this to the Chromium it installs — only set it yourself on a non-Docker host |
| `ANTHROPIC_API_KEY` | No | Only needed for the "✨ AI Insights" button on the Actions page. Get one at [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |

Run it:

```bash
npm start        # production
npm run dev       # auto-restart on change (nodemon)
```

Then open `http://localhost:3000`.

## Deploying

A `Dockerfile` is included and is the recommended path — it installs Chromium (needed for PDF/image exports) and runs it with `--no-sandbox`, which containers require since they run as root with no sandbox namespace available. A `Procfile` (`web: node backend/server.js`) is also included for buildpack-style platforms, but without Chromium pre-installed those platforms will show PDF/image export errors unless you separately configure a Chromium buildpack and set `PUPPETEER_EXECUTABLE_PATH`.

### Railway (recommended)

1. Create a new project from this repo — Railway detects the `Dockerfile` automatically.
2. **Attach a volume**: mount it at `/data`, then set `DB_PATH=/data/lifetracker.sqlite`. Without this the SQLite database (and every session) is wiped on every redeploy.
3. Set environment variables: `SESSION_SECRET` (generate one — see the table below), `NODE_ENV=production`, and `ANTHROPIC_API_KEY`/`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` if you want those features live. Don't set `PUPPETEER_EXECUTABLE_PATH` — the Dockerfile already does.
4. Once Railway gives you a domain, if you're using Google features, go back to Google Cloud Console and add **both** `https://<your-domain>/api/drive/callback` and `https://<your-domain>/api/auth/google/callback` as Authorized redirect URIs on the OAuth client, and update `GOOGLE_REDIRECT_URI` to the first one.

### Any other host

1. Set `SESSION_SECRET` and `NODE_ENV=production`.
2. Attach persistent storage and set `DB_PATH` to a file inside it — otherwise the SQLite database is wiped on every redeploy.
3. Make sure a Chromium-family browser is available and set `PUPPETEER_EXECUTABLE_PATH` to it — used for PDF/image reports and the Gantt chart's image export. Building from the included `Dockerfile` handles this automatically.
4. Set the Google OAuth variables only if Drive backup / Sign in with Google should be enabled — see the redirect URI note above.

Sessions are stored in the same SQLite database (`better-sqlite3-session-store`) rather than in memory, so — as long as `DB_PATH` points at persistent storage — logins survive redeploys instead of forcing everyone to sign in again each time.

## Project structure

```
backend/
  server.js           entry point, middleware, route mounting
  db/                  SQLite connection, schema/migrations, data-access layer
  middleware/          session auth gate
  routes/              one file per API resource (auth, projects, tasks, wealth, drive, ai, reports, data, profile)
  reports/             Excel/PDF/image export generation, plus the Gantt chart's image export
frontend/
  index.html           all pages/modals (single-page app, no router)
  js/app.js            UI logic, rendering, event handling
  js/api.js            thin fetch wrapper for the backend API
```

Personal data files (e.g. `AdekolaProjects/`) are gitignored and never pushed — this repo is public.

## License

All rights reserved — see [LICENSE](LICENSE). No permission is granted to use, copy, modify, or distribute this code.
