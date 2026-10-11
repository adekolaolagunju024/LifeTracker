const db = require('../db/db');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES = ['High', 'Medium', 'Low'];
const OPEN_STATUSES = ['Not Started', 'In Progress'];
const EDITABLE_FIELDS = ['title', 'priority', 'status', 'startDate', 'endDate', 'notes', 'targetCount', 'targetUnit'];
const MAX_TARGET = 100000;

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

// Tasks can be added, edited, moved and deleted (deleting moves a task to
// Trash, where it can be restored); phases can only be added or renamed,
// never deleted. Blockers can be managed. Completed tasks are never offered
// as targets, and everything is shown to the user for approval first.
const EDIT_TOOL = {
  name: 'propose_edits',
  description: 'Propose changes to an existing plan. You may edit tasks, add tasks, move tasks between phases, rename phases, and add phases. You may also delete a task that is no longer needed (it goes to Trash and can be restored), but only when the user asks for it. You may set or clear a task\'s progress target (a count such as 20 pages, with a unit), and add or remove a task\'s predecessors (tasks it waits on before it can start). You may also manage a task\'s blockers (the obstacles standing in its way): add one, rename it or change how many enemies it puts on the Journey (1 to 5), tick it off as cleared (or back to pending), or remove it. You may not delete phases.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One or two sentences describing the revision as a whole' },
      operations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['updateTask', 'addTask', 'moveTask', 'deleteTask', 'renamePhase', 'addPhase', 'addBlocker', 'updateBlocker', 'removeBlocker', 'addPredecessor', 'removePredecessor'] },
            taskId: { type: 'string', description: 'For updateTask, moveTask, deleteTask, addBlocker, addPredecessor and removePredecessor: an existing task id from the plan' },
            predecessorId: { type: 'string', description: 'For addPredecessor and removePredecessor: the id of the task that taskId waits on (another task from the plan)' },
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
                targetCount: { type: 'integer', minimum: 0, maximum: MAX_TARGET, description: 'The progress target, e.g. 20 for "write 20 pages". 0 clears the target' },
                targetUnit: { type: 'string', description: 'What the target counts, e.g. "pages" or "calls". Optional' },
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
  const tasks = db.listTasksInProjectTreeDetailed(userId, project.id);
  const phaseIds = new Set([project.id, ...children.map(c => c.id)]);
  const taskById = new Map(tasks.map(t => [t.id, t]));
  const subIds = new Set(children.map(c => c.id));
  const phaseTitles = new Map([[project.id, project.title], ...children.map(c => [c.id, c.title])]);

  const lines = [`Project: "${project.title}" (id: ${project.id})`];
  const blockerById = new Map();
  const describe = t => {
    let line = `  - task id:${t.id} | "${t.title}" | status:${t.status} | priority:${t.priority} | start:${t.startDate || 'none'} | due:${t.endDate || 'none'}`;
    if (t.targetCount) line += ` | target:${t.targetCount}${t.targetUnit ? ' ' + t.targetUnit : ''} (done ${t.progressCount || 0})`;
    if ((t.predecessors || []).length) line += ` | waits on:${t.predecessors.map(p => p.id).join(',')}`;
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

// Does `fromId` already wait on `targetId`, directly or through a chain?
// Linking them the other way round would close a loop.
function waitsOn(index, fromId, targetId) {
  const seen = new Set();
  const stack = [fromId];
  while (stack.length) {
    const id = stack.pop();
    if (id === targetId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    (index.taskById.get(id)?.predecessors || []).forEach(p => stack.push(p.id));
  }
  return false;
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
        else if (key === 'targetCount' && (value === null || (Number.isInteger(value) && value >= 0 && value <= MAX_TARGET))) fields.targetCount = value || null;
        else if (key === 'targetUnit' && typeof value === 'string') fields.targetUnit = value.trim().slice(0, 30);
      }
      if (fields.title === '') delete fields.title;
      // A unit means nothing without a count: keep it only when the task
      // ends up with a target, and drop it when the target is being cleared.
      const endsWithTarget = fields.targetCount !== undefined ? !!fields.targetCount : !!task.targetCount;
      if (fields.targetUnit !== undefined && !endsWithTarget) delete fields.targetUnit;
      if (fields.targetCount === null && !task.targetCount) delete fields.targetCount;
      if (fields.targetCount !== undefined && fields.targetCount === (task.targetCount || null) && fields.targetUnit === undefined) delete fields.targetCount;
      if (!Object.keys(fields).length) { dropped++; continue; }
      valid.push({ type: 'updateTask', taskId: task.id, currentTitle: task.title, fields, reason });
    } else if (op.type === 'moveTask') {
      const task = index.taskById.get(op.taskId);
      if (!task || task.status === 'Completed' || !index.phaseIds.has(op.phaseId) || task.projectId === op.phaseId) { dropped++; continue; }
      valid.push({ type: 'moveTask', taskId: task.id, currentTitle: task.title, toPhaseId: op.phaseId, toPhaseTitle: index.phaseTitles.get(op.phaseId), reason });
    } else if (op.type === 'deleteTask') {
      const task = index.taskById.get(op.taskId);
      if (!task || task.status === 'Completed') { dropped++; continue; }
      valid.push({ type: 'deleteTask', taskId: task.id, currentTitle: task.title, reason });
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
    } else if (op.type === 'addPredecessor' || op.type === 'removePredecessor') {
      const task = index.taskById.get(op.taskId);
      const pred = index.taskById.get(op.predecessorId);
      if (!task || !pred || task.id === pred.id || task.status === 'Completed') { dropped++; continue; }
      const linked = (task.predecessors || []).some(p => p.id === pred.id);
      if (op.type === 'addPredecessor' ? linked || waitsOn(index, pred.id, task.id) : !linked) { dropped++; continue; }
      valid.push({ type: op.type, taskId: task.id, taskTitle: task.title, predecessorId: pred.id, predecessorTitle: pred.title, reason });
    } else {
      dropped++;
    }
  }
  return { operations: valid, dropped };
}

module.exports = { EDIT_TOOL, buildEditContext, validateOperations };
