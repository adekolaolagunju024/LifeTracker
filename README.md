# 🎯 Life & Wealth Tracker

> Personal Life, Career, Business & Wealth Tracker — built by Adekola Olagunju

---

## 📁 Project Structure

```
LifeTracker/
├── frontend/               ← Everything the browser sees
│   ├── index.html          ← Structure & styles only (no logic)
│   ├── css/
│   │   └── styles.css      ← All CSS (split from HTML)
│   └── js/
│       ├── api.js          ← API service layer (fetch calls to backend)
│       └── app.js          ← All UI logic, rendering, modals, Gantt
│
├── backend/                ← Node.js + Express API server
│   ├── server.js           ← Entry point — starts Express, mounts routes
│   ├── db/
│   │   ├── db.js           ← Read/write database.json helper
│   │   └── database.json   ← The actual database (auto-created on first run)
│   └── routes/
│       ├── profile.js      ← GET/PUT  /api/profile
│       ├── projects.js     ← CRUD     /api/projects
│       ├── tasks.js        ← CRUD     /api/tasks
│       ├── wealth.js       ← CRUD     /api/wealth
│       └── actions.js      ← CRUD     /api/actions
│
├── package.json            ← Node dependencies
└── README.md               ← You are here
```

---

## 🚀 Getting Started

### 1. Install Node.js
Download from https://nodejs.org (LTS version)

### 2. Install dependencies
```bash
cd LifeTracker
npm install
```

### 3. Run the app
```bash
npm run dev
```

### 4. Open in browser
```
http://localhost:3000
```

---

## 📡 API Reference

| Method | Endpoint             | Description              |
|--------|----------------------|--------------------------|
| GET    | /api/profile         | Get user profile         |
| PUT    | /api/profile         | Update profile           |
| GET    | /api/projects        | Get all projects         |
| POST   | /api/projects        | Create project           |
| PUT    | /api/projects/:id    | Update project           |
| DELETE | /api/projects/:id    | Delete project + tasks   |
| GET    | /api/tasks           | Get tasks (with filters) |
| POST   | /api/tasks           | Create task              |
| PUT    | /api/tasks/:id       | Update task              |
| DELETE | /api/tasks/:id       | Delete task              |
| GET    | /api/wealth          | Get all wealth data      |
| PUT    | /api/wealth/entries  | Update current values    |
| POST   | /api/wealth/log      | Add monthly entry        |
| GET    | /api/actions         | Get all actions          |
| POST   | /api/actions         | Add action               |
| PUT    | /api/actions/:id     | Update/toggle action     |
| DELETE | /api/actions/:id     | Delete action            |

---

## 🛠️ Tech Stack

| Layer     | Technology                        |
|-----------|-----------------------------------|
| Frontend  | HTML + CSS + Vanilla JS           |
| Backend   | Node.js + Express                 |
| Database  | JSON file (upgrade to SQLite next)|
| Charts    | Chart.js (CDN) — coming Phase 2   |

---

## 🗺️ Roadmap

- [x] Phase 1 — Core tracker (projects, tasks, wealth, Gantt)
- [ ] Phase 2 — Charts, mobile layout, task detail panel
- [ ] Phase 3 — User auth (login/register, multi-user)
- [ ] Phase 4 — SQLite database, deploy to cloud
