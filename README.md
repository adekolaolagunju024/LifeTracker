# Waypoint

A general-purpose personal goal tracker — Career and Wealth are just two of the built-in project types; use it for any goal, in any area of life. Multi-user, self-hosted, no external dependencies required to run locally.

## Features

- **Accounts** — email/password registration and login, sessions scoped per user (`express-session`), an optional "Sign in with Google" (finds-or-creates an account by email), a "Keep me signed in" toggle (persistent 30-day session vs. a session-only cookie cleared when the browser closes), browser-native password-save support (real `<form>` submits + the Credential Management API), a "Forgot password?" flow (no email service required — the reset link is logged to the server console rather than emailed, so it's the account owner reading their own logs), and self-service permanent account deletion from Settings (password-confirmed; every project/task/wealth row cascades with it)
- **Recurring tasks** — a task can repeat Daily/Weekly/Monthly; marking one Completed automatically creates the next occurrence with dates shifted forward
- **Onboarding wizard** — name, wealth targets, and first project on first login
- **Projects & sub-folders** — one level of nested sub-projects (e.g. "UK Career Goals" → "Cloud Engineering Goals"), each individually editable
- **Project types** — Career, Wealth, Health & Fitness, Learning, Business, Home & Family, Relationships, Personal Growth, Hobbies & Creative, or Travel — pick whichever fits, purely for clarity. Every type gets the same full task list (add/edit/delete, filters, KPIs); **Wealth** is the only one that's functionally different, additionally showing a banner linking to the Wealth Tracker for its £ categories/monthly log/chart
- **Tasks** — status, priority, start/due dates, notes; "Add to Google Calendar" per task (task table and Gantt chart both)
- **Gantt chart** — with a **Kanban view** alongside the timeline (a "🗂️ Timeline / 📋 Kanban" toggle, remembered next time — the page heading and topbar title switch between "Gantt Chart" and "Kanban Board" too): three columns by status, drag a card between columns to change its status. An overdue card's due date shows in red with a 🔴, same as the rest of the app — the card visibly lifts and follows the cursor (a floating copy, tilted and shadowed) rather than just fading in place, same drag feel as the timeline's bars and rows, and works with touch too, a phone, tablet, or the Android app, not just a mouse. Cards can be **sorted** — by Due Soon or Starting Soon (each buckets by urgency: overdue/already-should-have-started, then today, then this week, then everything else, so it actually answers "what do I need to work on or start today or this week" instead of a flat chronological list), by Priority, or by Recently Added — and **filtered by priority**, both remembered next time. A "+" per column adds a task straight in with that status preselected, and the same hover-revealed 📅/🗑️ actions as everywhere else. Respects the same project filter as the timeline. Full CRUD directly from the chart either way: a "+ Add Project" button in the toolbar, a hover-revealed "+" on each project row to add a task straight into it (no need to pick a project from a dropdown), and a hover-revealed 🗑️ on both project and task rows to delete either (deleting a project cascades to its tasks, with a confirmation first). Task rows can also be manually reordered — drag the hover-revealed ⠿ handle up or down within a project to set your own order, which persists (and is reflected in that project's task table too, since both share the same order). Also: drag-to-move / drag-to-resize bars, collapsible groups by project — individually, or all at once with a single **Collapse All** / **Expand All** toggle button (a project's sub-folders always stay grouped directly beneath it, never scattered alphabetically among unrelated projects), Week/Month/Year zoom, a project filter dropdown to zoom into a single project's tasks, frozen Task/Status/Start/Due/Duration columns (Status is an inline dropdown, same as the task table — no need to open a task just to mark it done) with a horizontally scrolling timeline, and one **Export ▾** dropdown for **Print/PDF** (the browser's native print, with a stylesheet that un-freezes the columns) and **Export Image** (a server-side headless-browser screenshot of the live chart — more reliable than a client-side canvas library, which clips text in this chart's CSS Grid rows). The color/priority legend and any project-start (🚩) badges are collapsed behind an "ⓘ Legend" toggle by default (remembered next time) rather than always on screen — reference info, not something you need every time you look at the chart. Shows real tasks only — Wealth-type projects appear here the same as Career ones, via their tasks. On narrow/mobile screens the Start/Due/Duration columns drop out and the remaining columns narrow so the actual timeline bars are reachable after a short swipe instead of a very long one
- **Dashboard** — goal-agnostic on purpose: the KPI row (Total/Completed/In Progress) and the "Goals Progress" hero card both aggregate every project regardless of type, since Wealth is just one goal among many, not a special headline metric. "Projects at a Glance" shows live per-project stats (tasks, done, an overdue count highlighted in red, progress — a Wealth-type project shows its own £ progress toward its own target instead) as cards or a compact table — pick whichever with the Cards/Table toggle, which is remembered next time. A one-line "⚡ Needs Attention" strip (overdue / high-priority-in-progress counts, or "All caught up 🎉") links straight into Actions rather than duplicating its full task list on the Dashboard too
- **Wealth tracker** — categories with editable targets (add/edit/delete), current values, a net worth chart, and a monthly income/savings log; reached via a Wealth-type project rather than a dedicated nav item
- **Actions** — a live, auto-generated feed (not a maintained list) of Overdue, Due This Week, Starting This Week, and High-priority-in-progress tasks across every project; mark one done straight from the feed
- **Daily digest** — a dismissible banner on login/reload if anything is overdue or due today, linking straight into Actions; shows at most once per day
- **Daily digest email** (optional) — a genuine outside-the-app notification: one email a day (07:00 server time) grouping Overdue / Due Today / Due Tomorrow tasks by project, sent via Gmail SMTP. Opt-in per account from Settings → Notifications; skipped automatically on a day with nothing to report, and skipped entirely (with a log line, not an error) if Gmail credentials aren't configured on the server
- **AI Insights** (optional) — a "✨ Analyze My Tasks" button on the Actions page sends your open tasks to Claude and gets back a prioritized focus list plus 2-4 suggested next-step tasks you can add with one click. Button copy sets expectations up front (time + that it uses your API credits) and shows a spinner while it runs
- **Create a Project with AI** (optional) — on All Projects, two ways in: upload a `.xlsx`/`.pdf`/`.png`/`.jpg` (a plan, checklist, or spreadsheet) and Claude extracts a project with tasks from it, or **chat it through** — a real back-and-forth conversation for someone who doesn't know how to break a goal into tasks yet. Claude asks a clarifying question or two (timeframe, scope, current progress) and proposes a project once it has enough, or straight away if the goal's already specific. Either path lands on the same review screen; every field is editable and nothing is created until you confirm. The plain "+ New Project" button remains the fully manual option with no AI involved
- **Google Drive backup** (optional) — connect a Google account to export data as JSON, Excel, Google Sheets, PDF, or image
- **Export / Import Data (JSON)** — Settings has a full account export (profile, projects, tasks, wealth) and a matching import that recreates it for the current user, remapping project/sub-folder ids as needed. Additive, not a wipe-and-replace — the standard way to move data between two instances (e.g. local → a fresh deploy). Also reachable from anywhere via the sidebar's **File** menu, alongside Settings and Log Out — kept off the topbar and out of the nav list to keep both tidy
- **Dark mode** — includes a genuine iOS-style sliding switch (not a button with a changing label) for both this and the daily email digest toggle in Settings
- **Apple-style nav & Settings** — colored icon badges throughout the sidebar (each project's own color, for its own nav link) and Settings section headers; a persistent selected-state highlight in the sidebar (a bug fix along the way — the static nav items never actually got one before, only per-project links did); Settings' Appearance/Notifications merged into one grouped "Preferences" card with a divider between rows, iOS Settings-app style, instead of two separate boxes
- **Glass UI** — an iOS-style translucent material look throughout: a soft gradient wallpaper behind everything, with cards, the sidebar, modals, and pill/toggle buttons all frosted glass (`backdrop-filter: blur` + translucency) rather than flat colors, in both light and dark mode. Applied as global overrides keyed to Tailwind's existing `bg-white`/`bg-gray-100`/`bg-gray-50` utility classes — the same technique dark mode itself uses — so it's consistent everywhere without having retrofitted a new class onto ~2000 lines of templates. Modal/onboarding content boxes get a near-opaque variant instead, since they sit on a dark dimming backdrop rather than the page's own wallpaper, and blurring that straight through would read as muddy grey rather than a clean surface
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
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | No | Powers the daily digest email. `GMAIL_APP_PASSWORD` is **not** your normal Gmail password — generate one at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (requires 2-Step Verification on that Google account). Leave both blank to disable the feature |
| `APP_URL` | No | Public URL used for the "Open Waypoint" link in digest emails, since a background email job has no incoming request to derive it from. Defaults to `http://localhost:3000` |

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
3. Set environment variables: `SESSION_SECRET` (generate one — see the table below), `NODE_ENV=production`, `APP_URL` (your Railway domain, once you have it), and `ANTHROPIC_API_KEY`/`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI`/`GMAIL_USER`/`GMAIL_APP_PASSWORD` if you want those features live. Don't set `PUPPETEER_EXECUTABLE_PATH` — the Dockerfile already does.
4. Once Railway gives you a domain, if you're using Google features, go back to Google Cloud Console and add **both** `https://<your-domain>/api/drive/callback` and `https://<your-domain>/api/auth/google/callback` as Authorized redirect URIs on the OAuth client, and update `GOOGLE_REDIRECT_URI` to the first one.

### Any other host

1. Set `SESSION_SECRET` and `NODE_ENV=production`.
2. Attach persistent storage and set `DB_PATH` to a file inside it — otherwise the SQLite database is wiped on every redeploy.
3. Make sure a Chromium-family browser is available and set `PUPPETEER_EXECUTABLE_PATH` to it — used for PDF/image reports and the Gantt chart's image export. Building from the included `Dockerfile` handles this automatically.
4. Set the Google OAuth variables only if Drive backup / Sign in with Google should be enabled — see the redirect URI note above.

Sessions are stored in the same SQLite database (`better-sqlite3-session-store`) rather than in memory, so — as long as `DB_PATH` points at persistent storage — logins survive redeploys instead of forcing everyone to sign in again each time.

## iPhone

An APK only installs on Android — iOS can't sideload one, and there's no workaround for that. Instead, the web app itself is set up for Safari's "Add to Home Screen": with the `apple-mobile-web-app-*` meta tags and `apple-touch-icon` in `frontend/index.html`, that gives a real full-screen app icon on the home screen with no browser chrome, entirely free (no Mac, no Apple Developer account, no Xcode). A proper native iOS app (App Store or sideloaded) would additionally need a Mac with Xcode and, to distribute it at all, a $99/year Apple Developer account.

## Android app

`mobile/` is a thin [Capacitor](https://capacitorjs.com) wrapper — a real installable Android app whose WebView just points at the live Railway deployment (`mobile/capacitor.config.json` → `server.url`). There's no separate mobile codebase to maintain: any change pushed and deployed to Railway shows up in the app immediately, no rebuild needed. A rebuild is only needed for things baked into the native shell (app name/icon, the URL it points at).

Not published to the Play Store (personal use only) — it's installed by sideloading the APK directly. The app icon (`frontend/icons/`, generated from a single SVG) is shared between the web manifest and the Android launcher icon (both the flat pre-Android-8 icon and the adaptive icon's foreground/background layers).

The Android `appId` is still `com.lifetracker.app`, left over from before the app was renamed to Waypoint — intentionally not changed, since Android treats a different `appId` as a different app entirely rather than an update to the one already installed. Changing it is possible any time (edit it in `mobile/capacitor.config.json` and `mobile/android/app/src/main/res/values/strings.xml`, then rebuild), it would just mean reinstalling on any phone that already has the old one.

**Rebuilding the APK** (requires a JDK 21 and the Android SDK command-line tools — set `JAVA_HOME` and `ANDROID_HOME` first):

```bash
cd mobile
npx cap sync android        # only needed after changing capacitor.config.json
cd android
./gradlew assembleDebug     # gradlew.bat on Windows
```

The APK is written to `mobile/android/app/build/outputs/apk/debug/app-debug.apk`. To install it on a phone: enable "Install unknown apps" for whatever app you use to open the file (e.g. Files, Chrome), transfer the APK over (USB, email to yourself, cloud drive), and tap it — or with the phone connected via USB and USB debugging on, `adb install app-debug.apk`.

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
mobile/
  capacitor.config.json  points the Android WebView at the live Railway URL
  android/               native Android project (Capacitor-generated)
```

Personal data files (e.g. `AdekolaProjects/`) are gitignored and never pushed — this repo is public.

## License

All rights reserved — see [LICENSE](LICENSE). No permission is granted to use, copy, modify, or distribute this code.
