const db = require('../db/db');

// ── THE ASSISTANT'S VIEW OF YOUR DAY ────────────────────────────
// So the assistant can act as a personal assistant across the whole app,
// not just inside one project: what's late, due today, coming up, blocked
// and in progress, across every project the person can see, with ids it
// can use in actions. Kept short: at most 40 tasks.

const MAX = 40;

function buildDayContext(userId, todayKey) {
  const projects = db.listProjects(userId);
  const byId = Object.fromEntries(projects.map(p => [p.id, p]));
  const topOf = p => (p && p.parentId && byId[p.parentId] ? topOf(byId[p.parentId]) : p);
  const open = db.listTasks(userId).filter(t => t.status !== 'Completed');
  const due = t => (t.endDate || '').slice(0, 10);
  const weekAhead = new Date(`${todayKey}T00:00:00Z`);
  weekAhead.setUTCDate(weekAhead.getUTCDate() + 7);
  const weekKey = weekAhead.toISOString().slice(0, 10);
  const blockedBy = t => (t.obstacles || []).filter(o => !o.resolved).map(o => o.name);

  const rank = t => (due(t) && due(t) < todayKey ? 0 : due(t) === todayKey ? 1 : blockedBy(t).length ? 2 : t.status === 'In Progress' ? 3 : due(t) && due(t) <= weekKey ? 4 : 5);
  const picked = open
    .filter(t => rank(t) < 5 || t.priority === 'High')
    .sort((a, b) => rank(a) - rank(b) || (due(a) || '9999').localeCompare(due(b) || '9999'))
    .slice(0, MAX);

  const label = t => {
    const bits = [];
    if (due(t) && due(t) < todayKey) bits.push(`OVERDUE since ${due(t)}`);
    else if (due(t) === todayKey) bits.push('due TODAY');
    else if (due(t)) bits.push(`due ${due(t)}`);
    if (t.status === 'In Progress') bits.push('in progress');
    if (t.priority === 'High') bits.push('high priority');
    const b = blockedBy(t);
    if (b.length) bits.push(`blocked by: ${b.join(', ')}`);
    return bits.join('; ');
  };
  const lines = picked.map(t => {
    const top = topOf(byId[t.projectId]);
    return `- "${t.title}" (task id:${t.id}) in ${top ? `"${top.title}"` : 'a project'}: ${label(t) || 'no date'}`;
  });
  const tops = projects.filter(p => !p.parentId).slice(0, 25).map(p => `- "${p.title}" (project id:${p.id})`);
  const profile = db.getProfile(userId) || {};

  const taskIds = new Set(open.map(t => t.id));
  const projectIds = new Set(projects.map(p => p.id));
  return {
    text: [
      `Today is ${todayKey}. ${profile.name && profile.name !== 'Your Name' ? `Their name is ${profile.name}. ` : ''}Streak: ${profile.currentStreak || 0} day(s).`,
      `Open tasks that matter now (${open.length} open in total):`,
      lines.length ? lines.join('\n') : '- Nothing urgent.',
      'Their projects:',
      tops.length ? tops.join('\n') : '- None yet.',
    ].join('\n'),
    taskIds, projectIds,
  };
}

// What the assistant can do around the app. Moving around, focus sessions
// and music happen straight away (they change nothing). Changes to data
// (finishing a task, setting a reminder, adding a task) come back as
// suggestions the person confirms with a tap.
const APP_TOOL = {
  name: 'take_actions',
  description: 'Act in the app for the user: open a page, project or task; start a focus session on a task; finish a task; set a task reminder; add a task. Use ids from the context only.',
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'One or two short, warm sentences to say to the user, like a capable personal assistant' },
      actions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['open_page', 'open_project', 'open_task', 'start_focus', 'complete_task', 'set_reminder', 'add_task'] },
            page: { type: 'string', enum: ['dashboard', 'actions', 'calendar', 'gantt', 'projects', 'chats', 'settings', 'why'], description: 'For open_page' },
            projectId: { type: 'string', description: 'For open_project and add_task' },
            taskId: { type: 'string', description: 'For open_task, start_focus, complete_task, set_reminder' },
            minutes: { type: 'integer', description: 'For start_focus: 5 to 90, default 25' },
            music: { type: 'boolean', description: 'For start_focus: also play their default music' },
            at: { type: 'string', description: 'For set_reminder: date and time, ISO 8601 with offset' },
            title: { type: 'string', description: 'For add_task' },
            endDate: { type: 'string', description: 'For add_task: YYYY-MM-DD, optional' },
          },
          required: ['type'],
        },
      },
    },
    required: ['reply', 'actions'],
  },
};

const PAGES = new Set(APP_TOOL.input_schema.properties.actions.items.properties.page.enum);

// Keeps only actions that point at things this person can see (and, for
// changes, edit), with sensible values. Returns the survivors.
function validateActions(userId, actions, day, now = new Date()) {
  const out = [];
  for (const a of (Array.isArray(actions) ? actions : []).slice(0, 8)) {
    if (!a || typeof a.type !== 'string') continue;
    const task = a.taskId ? db.getTaskById(userId, a.taskId) : null;
    const canEditTask = task && db.canEditProject(userId, task.projectId);
    switch (a.type) {
      case 'open_page':
        if (PAGES.has(a.page)) out.push({ type: 'open_page', page: a.page });
        break;
      case 'open_project':
        if (a.projectId && day.projectIds.has(a.projectId)) out.push({ type: 'open_project', projectId: a.projectId });
        break;
      case 'open_task':
        if (task) out.push({ type: 'open_task', taskId: task.id, title: task.title });
        break;
      case 'start_focus':
        if (task || !a.taskId) out.push({ type: 'start_focus', taskId: task ? task.id : null, title: task ? task.title : '', minutes: Math.min(90, Math.max(5, parseInt(a.minutes, 10) || 25)), music: a.music !== false });
        break;
      case 'complete_task':
        if (canEditTask && task.status !== 'Completed') out.push({ type: 'complete_task', taskId: task.id, title: task.title });
        break;
      case 'set_reminder': {
        const when = new Date(a.at || '');
        if (task && !Number.isNaN(when.getTime()) && when > now && when - now < 366 * 86400000) out.push({ type: 'set_reminder', taskId: task.id, title: task.title, at: when.toISOString() });
        break;
      }
      case 'add_task': {
        const title = String(a.title || '').trim().slice(0, 200);
        const endDate = /^\d{4}-\d{2}-\d{2}$/.test(a.endDate || '') ? a.endDate : '';
        if (title && a.projectId && day.projectIds.has(a.projectId) && db.canEditProject(userId, a.projectId)) out.push({ type: 'add_task', projectId: a.projectId, title, endDate });
        break;
      }
      default: break;
    }
  }
  return out;
}

module.exports = { buildDayContext, APP_TOOL, validateActions };
