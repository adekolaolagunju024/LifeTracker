const db = require('../db/db');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES = ['High', 'Medium', 'Low'];
const OPEN_STATUSES = ['Not Started', 'In Progress'];
const EDITABLE_FIELDS = ['title', 'priority', 'status', 'startDate', 'endDate', 'notes'];

const NEW_TASK_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    priority: { type: 'string', enum: PRIORITIES },
    startDate: { type: 'string', description: 'YYYY-MM-DD or empty' },
    endDate: { type: 'string', description: 'YYYY-MM-DD or empty' },
    notes: { type: 'string' },
  },
  required: ['title'],
};

// Only add and edit operations exist for tasks and phases, so the model has
// no way to express deleting one; the one thing it may remove is a blocker
// (an obstacle on a task). Completed tasks are never offered as targets.
const EDIT_TOOL = {
  name: 'propose_edits',
  description: 'Propose changes to an existing plan. You may edit tasks, add tasks, move tasks between phases, rename phases, and add phases. You may also manage a task\'s blockers (the obstacles standing in its way): add one, rename it or change how many enemies it puts on the Journey (1 to 5), tick it off as cleared (or back to pending), or remove it. You may not delete tasks or phases.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One or two sentences describing the revision as a whole' },
      operations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['updateTask', 'addTask', 'moveTask', 'renamePhase', 'addPhase', 'addBlocker', 'updateBlocker', 'removeBlocker'] },
            taskId: { type: 'string', description: 'For updateTask and addBlocker: an existing task id from the plan' },
            blockerId: { type: 'string', description: 'For updateBlocker and removeBlocker: an existing blocker id from the plan' },
            blocker: {
              type: 'object',
              description: 'For addBlocker: the new blocker. For updateBlocker: only what changes',
              properties: {
                name: { type: 'string', description: 'What is in the way, e.g. "Waiting on the supplier quote"' },
                count: { type: 'integer', minimum: 1, maximum: 5, description: 'How many enemies it puts on the Journey (1-5)' },
                resolved: { type: 'boolean', description: 'For updateBlocker: true when it has been cleared, false to put it back to pending' },
              },
            },
            phaseId: { type: 'string', description: 'For addTask: the phase to add to. For moveTask: the phase to move the task into. For renamePhase: the phase to rename. Always an existing phase id from the plan' },
            title: { type: 'string', description: 'For renamePhase and addPhase' },
            fields: {
              type: 'object',
              description: 'For updateTask: only the fields that change',
              properties: {
                title: { type: 'string' },
                priority: { type: 'string', enum: PRIORITIES },
                status: { type: 'string', enum: OPEN_STATUSES },
                startDate: { type: 'string' },
                endDate: { type: 'string' },
                notes: { type: 'string' },
              },
            },
            task: NEW_TASK_SCHEMA,
            tasks: { type: 'array', items: NEW_TASK_SCHEMA },
            reason: { type: 'string', description: 'One short sentence on why this change helps' },
          },
          required: ['type', 'reason'],
        },
      },
    },
    required: ['summary', 'operations'],
  },
};

// Loads the live plan for a top-level project, with real ids the model can
// refer to. Nothing here comes from the client.
function buildEditContext(userId, project) {
  const children = db.listProjects(userId, { parentId: project.id });
  const tasks = db.listTasksInProjectTree(userId, project.id);
  const phaseIds = new Set([project.id, ...children.map(c => c.id)]);
  const taskById = new Map(tasks.map(t => [t.id, t]));
  const subIds = new Set(children.map(c => c.id));
  const phaseTitles = new Map([[project.id, project.title], ...children.map(c => [c.id, c.title])]);

  const lines = [`Project: "${project.title}" (id: ${project.id})`];
  const blockerById = new Map();
  const describe = t => {
    const line = `  - task id:${t.id} | "${t.title}" | status:${t.status} | priority:${t.priority} | start:${t.startDate || 'none'} | due:${t.endDate || 'none'}`;
    const blockers = (t.obstacles || []).map(o => {
      blockerById.set(o.id, { ...o, taskId: t.id, taskTitle: t.title, taskStatus: t.status });
      return `      blocker id:${o.id} | "${o.name}" | x${o.count} | ${o.resolved ? 'cleared' : 'pending'}`;
    });
    return [line, ...blockers].join('\n');
  };
  const topTasks = tasks.filter(t => t.projectId === project.id);
  if (topTasks.length) lines.push('Tasks directly in the project:', ...topTasks.map(describe));
  for (const child of children) {
    lines.push(`Phase: "${child.title}" (phase id: ${child.id})`);
    const phaseTasks = tasks.filter(t => t.projectId === child.id);
    lines.push(...(phaseTasks.length ? phaseTasks.map(describe) : ['  (no tasks yet)']));
  }

  return { text: lines.join('\n'), index: { phaseIds, subIds, taskById, phaseTitles, blockerById } };
}

const cleanBlockerName = name => (typeof name === 'string' ? name.trim().slice(0, 80) : '');
const validCount = n => Number.isInteger(n) && n >= 1 && n <= 5;

function validDate(value) {
  return typeof value === 'string' && (value === '' || DATE_RE.test(value));
}

function sanitizeNewTask(task) {
  if (!task || typeof task.title !== 'string' || !task.title.trim()) return null;
  return {
    title: task.title.trim(),
    priority: PRIORITIES.includes(task.priority) ? task.priority : 'Medium',
    status: 'Not Started',
    startDate: validDate(task.startDate) ? task.startDate || '' : '',
    endDate: validDate(task.endDate) ? task.endDate || '' : '',
    notes: typeof task.notes === 'string' ? task.notes : '',
  };
}

// Anything the model invents or tries to touch outside the plan is dropped
// here, before the user ever sees it. Returns only operations that are safe
// to apply, plus a count of what was dropped.
function validateOperations(operations, index) {
  const valid = [];
  let dropped = 0;
  for (const op of Array.isArray(operations) ? operations : []) {
    const reason = typeof op.reason === 'string' ? op.reason.trim().slice(0, 300) : '';

    if (op.type === 'updateTask') {
      const task = index.taskById.get(op.taskId);
      if (!task || task.status === 'Completed') { dropped++; continue; }
      const fields = {};
      for (const key of EDITABLE_FIELDS) {
        const value = op.fields?.[key];
        if (value === undefined) continue;
        if (key === 'priority' && PRIORITIES.includes(value)) fields.priority = value;
        else if (key === 'status' && OPEN_STATUSES.includes(value)) fields.status = value;
        else if ((key === 'startDate' || key === 'endDate') && validDate(value)) fields[key] = value;
        else if ((key === 'title' || key === 'notes') && typeof value === 'string') fields[key] = value.trim();
      }
      if (fields.title === '') delete fields.title;
      if (!Object.keys(fields).length) { dropped++; continue; }
      valid.push({ type: 'updateTask', taskId: task.id, currentTitle: task.title, fields, reason });
    } else if (op.type === 'moveTask') {
      const task = index.taskById.get(op.taskId);
      if (!task || task.status === 'Completed' || !index.phaseIds.has(op.phaseId) || task.projectId === op.phaseId) { dropped++; continue; }
      valid.push({ type: 'moveTask', taskId: task.id, currentTitle: task.title, toPhaseId: op.phaseId, toPhaseTitle: index.phaseTitles.get(op.phaseId), reason });
    } else if (op.type === 'addTask') {
      const task = sanitizeNewTask(op.task);
      if (!index.phaseIds.has(op.phaseId) || !task) { dropped++; continue; }
      valid.push({ type: 'addTask', phaseId: op.phaseId, task, reason });
    } else if (op.type === 'renamePhase') {
      const title = typeof op.title === 'string' ? op.title.trim() : '';
      if (!index.subIds.has(op.phaseId) || !title) { dropped++; continue; }
      valid.push({ type: 'renamePhase', phaseId: op.phaseId, title, reason });
    } else if (op.type === 'addPhase') {
      const title = typeof op.title === 'string' ? op.title.trim() : '';
      const tasks = (Array.isArray(op.tasks) ? op.tasks : []).map(sanitizeNewTask).filter(Boolean);
      if (!title) { dropped++; continue; }
      valid.push({ type: 'addPhase', title, tasks, reason });
    } else if (op.type === 'addBlocker') {
      const task = index.taskById.get(op.taskId);
      const name = cleanBlockerName(op.blocker?.name);
      if (!task || task.status === 'Completed' || !name) { dropped++; continue; }
      valid.push({ type: 'addBlocker', taskId: task.id, taskTitle: task.title, blocker: { name, count: validCount(op.blocker?.count) ? op.blocker.count : 1 }, reason });
    } else if (op.type === 'updateBlocker' || op.type === 'removeBlocker') {
      const current = index.blockerById && index.blockerById.get(op.blockerId);
      if (!current || current.taskStatus === 'Completed') { dropped++; continue; }
      if (op.type === 'removeBlocker') {
        valid.push({ type: 'removeBlocker', blockerId: current.id, currentName: current.name, taskTitle: current.taskTitle, reason });
        continue;
      }
      const changes = {};
      const name = cleanBlockerName(op.blocker?.name);
      if (name && name !== current.name) changes.name = name;
      if (validCount(op.blocker?.count) && op.blocker.count !== current.count) changes.count = op.blocker.count;
      if (typeof op.blocker?.resolved === 'boolean' && op.blocker.resolved !== !!current.resolved) changes.resolved = op.blocker.resolved;
      if (!Object.keys(changes).length) { dropped++; continue; }
      valid.push({ type: 'updateBlocker', blockerId: current.id, currentName: current.name, taskTitle: current.taskTitle, changes, reason });
    } else {
      dropped++;
    }
  }
  return { operations: valid, dropped };
}

module.exports = { EDIT_TOOL, buildEditContext, validateOperations };
