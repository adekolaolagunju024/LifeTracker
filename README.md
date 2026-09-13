# LifeTracker

A personal life, career, and wealth tracker. Multi-user, self-hosted, no external dependencies required to run locally.

## Features

- **Accounts** — email/password registration and login, sessions scoped per user (`express-session`)
- **Onboarding wizard** — name, wealth targets, and first project on first login
- **Projects & sub-folders** — one level of nested sub-projects (e.g. "UK Career Goals" → "Cloud Engineering Goals"), each individually editable
- **Project types** — a top-level project is either **Career** (task-based) or **Wealth** (tracked via the Wealth Tracker); more types can be added later
- **Tasks** — status, priority, start/due dates, notes; "Add to Google Calendar" per task
- **Gantt chart** — drag-to-move / drag-to-resize bars, collapsible groups by project, Week/Month/Year zoom, frozen Task/Status/Start/Due/Duration columns with a horizontally scrolling timeline. Wealth-type projects show one bar per wealth category (spanning the project's start date to the Net Worth target date), filled to its own % of target reached
- **Dashboard** — dynamic per project type: the Career Progress and Net Worth hero cards (and the Net Worth KPI) only appear once you actually have a project of that type, and reflow to fill the row when only one is present
- **Wealth tracker** — categories with editable targets (add/edit/delete), current values, a net worth chart, and a monthly income/savings log
- **Google Drive backup** (optional) — connect a Google account to export data as JSON, Excel, Google Sheets, PDF, or image
- **Dark mode**
- **Mobile responsive layout**

## Tech stack

- **Backend**: Node.js + Express, `better-sqlite3` (SQLite), `express-session`, `bcryptjs`
- **Frontend**: Vanilla JS + Tailwind CSS (CDN) — no build step
- **Exports**: `exceljs` (Excel), `puppeteer-core` (PDF/image reports), `googleapis` (Drive/Sheets)

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
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | No | Only needed for Google Drive backup/export. Create in Google Cloud Console → APIs & Services → Credentials |
| `NODE_ENV` | No | Set to `production` when deployed, so session cookies require HTTPS |
| `PUPPETEER_EXECUTABLE_PATH` | No | Path to a Chromium-family browser, only needed if one isn't auto-detected (used for PDF/image report rendering) |

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
  routes/              one file per API resource (auth, projects, tasks, wealth, actions, drive, profile)
  reports/             Excel/PDF/image export generation
frontend/
  index.html           all pages/modals (single-page app, no router)
  js/app.js            UI logic, rendering, event handling
  js/api.js            thin fetch wrapper for the backend API
```

Personal data files (e.g. `AdekolaProjects/`) are gitignored and never pushed — this repo is public.

## License

All rights reserved — see [LICENSE](LICENSE). No permission is granted to use, copy, modify, or distribute this code.
