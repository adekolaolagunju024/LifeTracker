// ═══════════════════════════════════════════════════════════════
// API.JS — Frontend Service Layer
// All fetch() calls to the backend. No localStorage.
// app.js calls these functions — never fetch() directly.
// ═══════════════════════════════════════════════════════════════

const BASE = '/api';

async function request(method, path, body=null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(BASE + path, opts);
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

const API = {
  // ── PROFILE ──
  getProfile:    ()       => request('GET',  '/profile'),
  updateProfile: (data)   => request('PUT',  '/profile', data),

  // ── PROJECTS ──
  getProjects:   ()       => request('GET',  '/projects'),
  getProject:    (id)     => request('GET',  `/projects/${id}`),
  addProject:    (data)   => request('POST', '/projects', data),
  updateProject: (id, d)  => request('PUT',  `/projects/${id}`, d),
  deleteProject: (id)     => request('DELETE',`/projects/${id}`),

  // ── TASKS ──
  getTasks:      (params={}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([,v])=>v))
    ).toString();
    return request('GET', `/tasks${qs ? '?'+qs : ''}`);
  },
  getTask:       (id)     => request('GET',  `/tasks/${id}`),
  addTask:       (data)   => request('POST', '/tasks', data),
  updateTask:    (id, d)  => request('PUT',  `/tasks/${id}`, d),
  deleteTask:    (id)     => request('DELETE',`/tasks/${id}`),

  // ── WEALTH ──
  getWealth:         ()       => request('GET',  '/wealth'),
  updateWealthEntry: (data)   => request('PUT',  '/wealth/entries', data),
  addWealthCategory: (data)   => request('POST', '/wealth/targets', data),
  getMonthlyLog:     ()       => request('GET',  '/wealth/log'),
  addMonthlyEntry:   (data)   => request('POST', '/wealth/log', data),
  deleteMonthlyEntry:(id)     => request('DELETE',`/wealth/log/${id}`),

  // ── ACTIONS ──
  getActions:    ()       => request('GET',  '/actions'),
  addAction:     (data)   => request('POST', '/actions', data),
  updateAction:  (id, d)  => request('PUT',  `/actions/${id}`, d),
  toggleAction:  (id, cur)=> request('PUT',  `/actions/${id}`, { done: !cur }),
  deleteAction:  (id)     => request('DELETE',`/actions/${id}`),
};
