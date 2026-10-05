const express = require('express');
const router  = express.Router();
const ExcelJS = require('exceljs');
const db = require('../db/db');
const { callAI, isAIConfigured } = require('../ai/provider');
const { EDIT_TOOL, buildEditContext, validateOperations } = require('../ai/edit');

// Every user-triggered AI route spends one unit of the account's daily
// allowance. The configured check comes first so an unconfigured server
// doesn't burn anyone's quota on a request that's going to 503 anyway.
function aiQuota(kind = 'ai') {
  return (req, res, next) => {
    if (!isAIConfigured()) return next();
    const spend = kind === 'assistant' ? db.consumeAssistantQuota : db.consumeAiQuota;
    if (!spend(req.session.userId)) {
      return res.status(429).json({ error: "You've used today's AI allowance. It resets tomorrow — everything else in Waypoint still works." });
    }
    next();
  };
}

// GET /api/ai/status — lets the frontend show "not configured" without
// triggering a real (billable) call, same pattern as Google Drive backup.
router.get('/status', (req, res) => {
  res.json({ configured: isAIConfigured() });
});

// POST /api/ai/insights — sends the user's open tasks to the AI and asks
// for a prioritized focus list plus a few suggested next-step tasks.
router.post('/insights', aiQuota(), async (req, res) => {
  if (!isAIConfigured()) {
    return res.status(503).json({ error: 'AI is not configured on this server. Add ANTHROPIC_API_KEY (or GEMINI_API_KEY) to .env to enable it.' });
  }

  try {
    const userId = req.session.userId;
    const projects = db.listProjects(userId);
    const tasks = db.listTasks(userId).filter(t => t.status !== 'Completed');

    if (!tasks.length) {
      return res.json({ summary: 'No open tasks — nothing to prioritize right now.', priorityOrder: [], suggestedNextSteps: [] });
    }

    const projectById = Object.fromEntries(projects.map(p => [p.id, p]));
    const topLevelProjects = projects.filter(p => !p.parentId);
    const today = new Date().toISOString().slice(0, 10);

    const taskLines = tasks.map(t =>
      `- id:${t.id} | "${t.title}" | project:"${projectById[t.projectId]?.title || 'Unknown'}" | status:${t.status} | priority:${t.priority} | due:${t.endDate || 'none'}`
    ).join('\n');

    const projectLines = topLevelProjects.map(p => `- id:${p.id} | "${p.title}" (${p.type})`).join('\n');

    const response = await callAI({
      system: `You are a practical productivity assistant helping someone prioritize open tasks across every area of their life. Today's date is ${today}. Be concise and specific — reference real deadlines and real progress, not generic advice.`,
      messages: [{
        role: 'user',
        content: `My open tasks:\n${taskLines}\n\nMy top-level projects (use one of these exact ids for any new suggested task):\n${projectLines}\n\nAnalyze these and call the provide_insights tool.`,
      }],
      tools: [{
        name: 'provide_insights',
        description: 'Return a prioritized focus list and suggested next-step tasks',
        input_schema: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'One or two plain-spoken sentences on where things stand overall' },
            priorityOrder: {
              type: 'array',
              description: 'The 5-8 existing tasks (by id) to focus on next, most important first',
              items: {
                type: 'object',
                properties: {
                  taskId: { type: 'string' },
                  reason: { type: 'string', description: 'One short, specific sentence on why this matters now' },
                },
                required: ['taskId', 'reason'],
              },
            },
            suggestedNextSteps: {
              type: 'array',
              description: '2-4 brand new tasks, not already in the list, that would meaningfully move things forward',
              items: {
                type: 'object',
                properties: {
                  title:     { type: 'string' },
                  projectId: { type: 'string', description: 'Must be exactly one of the given project ids' },
                  priority:  { type: 'string', enum: ['High', 'Medium', 'Low'] },
                  reason:    { type: 'string' },
                },
                required: ['title', 'projectId', 'priority', 'reason'],
              },
            },
          },
          required: ['summary', 'priorityOrder', 'suggestedNextSteps'],
        },
      }],
      forceToolName: 'provide_insights',
    });

    if (response.type !== 'tool_use') throw new Error('AI did not return structured insights');

    const result = response.input;
    result.priorityOrder = (result.priorityOrder || [])
      .map(p => {
        const task = tasks.find(t => t.id === p.taskId);
        if (!task) return null;
        return { ...p, title: task.title, project: projectById[task.projectId]?.title || '', dueDate: task.endDate, priority: task.priority };
      })
      .filter(Boolean);
    result.suggestedNextSteps = (result.suggestedNextSteps || [])
      .filter(s => projectById[s.projectId])
      .map(s => ({ ...s, projectTitle: projectById[s.projectId].title }));

    res.json(result);
  } catch (e) {
    console.error('AI insights error:', e);
    // The SDK's own .message is a raw "<status> <json body>" dump — pull out
    // just the API's own error message when it's there, for a readable UI.
    const apiMessage = e?.error?.error?.message || e?.message || 'Unknown error';
    res.status(502).json({ error: apiMessage });
  }
});

// Turns an uploaded .xlsx workbook into a plain-text summary of every sheet
// so it can go to Claude as regular text — far cheaper and more reliable
// than treating a spreadsheet as an image.
async function excelToText(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const parts = [];
  wb.worksheets.forEach(ws => {
    parts.push(`--- Sheet: ${ws.name} ---`);
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells = [];
      row.eachCell({ includeEmpty: false }, cell => cells.push(String(cell.value ?? '').trim()));
      if (cells.some(Boolean)) parts.push(cells.join(' | '));
    });
  });
  return parts.join('\n');
}

const TASK_SCHEMA = {
  type: 'object',
  properties: {
    title:     { type: 'string' },
    priority:  { type: 'string', enum: ['High', 'Medium', 'Low'] },
    status:    { type: 'string', enum: ['Not Started', 'In Progress', 'Completed'] },
    startDate: { type: 'string', description: 'YYYY-MM-DD if known, else empty string' },
    endDate:   { type: 'string', description: 'YYYY-MM-DD if known, else empty string' },
    notes:     { type: 'string', description: 'Any extra context worth keeping, else empty string' },
  },
  required: ['title', 'priority', 'status', 'startDate', 'endDate', 'notes'],
};

const IMPORT_TOOL = {
  name: 'propose_project',
  description: 'Return a proposed project, broken into phases, once the conversation (and any attached file) has enough to finalize',
  input_schema: {
    type: 'object',
    properties: {
      title:       { type: 'string', description: 'A short project title summarising the goal/file' },
      icon:        { type: 'string', description: 'One emoji that fits the project' },
      description: { type: 'string', description: 'One sentence describing the project' },
      phases: {
        type: 'array',
        description: 'The roadmap broken into 2-5 named phases/milestones when the goal has natural stages (e.g. "Phase 1: Research"), or a single phase when it is simple enough not to need them. Every concrete task/action/goal item found in the conversation or attached file goes under one of these.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short phase/milestone name' },
            tasks: { type: 'array', items: TASK_SCHEMA },
          },
          required: ['title', 'tasks'],
        },
      },
    },
    required: ['title', 'icon', 'description', 'phases'],
  },
};

const CHAT_SYSTEM_PROMPT = today => `You are a friendly planning assistant helping someone turn a goal into a concrete project with tasks, through natural back-and-forth conversation. Today's date is ${today}.

The user may attach a file to a message — a spreadsheet, PDF, or image of a plan/checklist. Treat its content as real context for the goal, the same as if they'd typed it: pull out any concrete tasks/dates already in it rather than inventing your own when the file already answers that.

Ask short, specific clarifying questions when they'd genuinely sharpen the plan — timeframe, scope, current progress, constraints. Don't interrogate: one or two questions is usually enough, and if the goal (or an attached file) is already clear and specific, you can skip straight to proposing.

Once you have enough to propose a solid, sequenced plan AND the user seems ready (they've answered your questions, or said something like "go ahead", "that's enough", "just do it"), call the propose_project tool with realistic startDate/endDate on every task — don't pile everything on one day. Break the plan into phases: use 2-5 named phases/milestones ("Phase 1: Research", "Phase 2: Build", ...) when the goal has natural stages, or a single phase when it's simple enough that phases would be artificial padding. Otherwise, just send a normal short conversational reply (a sentence or two, plus your question) and do not call the tool yet.`;

// Converts one message's file attachment (sent as base64 inside the JSON
// body, not multipart — see the raised express.json limit in server.js)
// into Anthropic content blocks. A spreadsheet can't be sent as a native
// document/image block, so it's read into plain text instead, same as the
// old standalone file-import endpoint used to do.
async function attachmentToContentBlocks({ name, mimetype, dataBase64 }) {
  if (mimetype.includes('spreadsheet') || /\.xlsx?$/i.test(name || '')) {
    const text = await excelToText(Buffer.from(dataBase64, 'base64'));
    if (!text.trim()) throw new Error('That spreadsheet looks empty');
    return [{ type: 'text', text: `Attached file (${name}):\n\n${text}` }];
  }
  if (mimetype === 'application/pdf') {
    return [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: dataBase64 } }];
  }
  if (mimetype.startsWith('image/')) {
    return [{ type: 'image', source: { type: 'base64', media_type: mimetype, data: dataBase64 } }];
  }
  throw new Error('Unsupported file type. Attach a .xlsx, .pdf, .png, or .jpg.');
}

// POST /api/ai/project-chat — the frontend keeps the whole conversation
// client-side (this endpoint is stateless) and resends it every turn,
// including any earlier message's attachment (still needed so Claude keeps
// that context across later turns). Claude either replies with plain text
// to keep the conversation going, or calls propose_project once it has
// enough to finalize.
router.post('/project-chat', aiQuota(), async (req, res) => {
  if (!isAIConfigured()) {
    return res.status(503).json({ error: 'AI is not configured on this server. Add ANTHROPIC_API_KEY (or GEMINI_API_KEY) to .env to enable it.' });
  }

  const incoming = Array.isArray(req.body.messages) ? req.body.messages : [];
  const cleaned = incoming
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && (typeof m.content === 'string' || m.attachment))
    .slice(-30);

  if (!cleaned.length || cleaned[0].role !== 'user') {
    return res.status(400).json({ error: 'No conversation to respond to' });
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    const messages = await Promise.all(cleaned.map(async m => {
      const text = String(m.content || '').trim();
      if (!m.attachment) return { role: m.role, content: text };
      const blocks = await attachmentToContentBlocks(m.attachment);
      return { role: m.role, content: [...blocks, { type: 'text', text: text || '(see attached file)' }] };
    }));

    const response = await callAI({
      system: CHAT_SYSTEM_PROMPT(today),
      messages,
      tools: [IMPORT_TOOL],
      maxTokens: 4000,
    });

    if (response.type === 'tool_use') return res.json({ type: 'proposal', proposal: response.input });

    res.json({ type: 'message', message: response.text || "Sorry, I didn't catch that — could you say more?" });
  } catch (e) {
    console.error('AI project-chat error:', e);
    const apiMessage = e?.error?.error?.message || e?.message || 'Unknown error';
    res.status(502).json({ error: apiMessage });
  }
});

// POST /api/ai/tiny-step — the "just start" affordance on a Not Started
// task: one concrete, doable-in-two-minutes first action, not a full plan.
// Loads the task server-side (never trusts a client-supplied title/notes
// directly) so this can't be used as an open-ended prompt injection point.
router.post('/tiny-step', aiQuota(), async (req, res) => {
  if (!isAIConfigured()) {
    return res.status(503).json({ error: 'AI is not configured on this server. Add ANTHROPIC_API_KEY (or GEMINI_API_KEY) to .env to enable it.' });
  }
  const task = db.getTaskById(req.session.userId, req.body.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  try {
    const response = await callAI({
      system: `You help someone who's stuck procrastinating on a task take the smallest possible first step. Given the task below, suggest ONE concrete, physical action that takes two minutes or less and clearly moves it forward — something so small there's no reason not to just do it right now. One short sentence, no preamble, no markdown, imperative mood (e.g. "Open a blank document and write just the title.").`,
      messages: [{
        role: 'user',
        content: `Task: "${task.title}"${task.notes ? `\nNotes: ${task.notes}` : ''}`,
      }],
      maxTokens: 150,
    });
    res.json({ suggestion: response.text ? response.text.trim() : null });
  } catch (e) {
    console.error('AI tiny-step error:', e);
    const apiMessage = e?.error?.error?.message || e?.message || 'Unknown error';
    res.status(502).json({ error: apiMessage });
  }
});

// POST /api/ai/edit-project — revises an existing top-level plan from a
// feedback message. Proposes changes only; nothing is written here. The
// client shows them for review and applies whichever ones the user ticks,
// through the same endpoints the manual UI uses.
router.post('/edit-project', aiQuota(), async (req, res) => {
  if (!isAIConfigured()) {
    return res.status(503).json({ error: 'AI is not configured on this server.' });
  }
  const userId = req.session.userId;
  const feedback = String(req.body.feedback || '').trim().slice(0, 1000);
  if (!feedback) return res.status(400).json({ error: 'Tell the AI what you want changed' });

  const project = db.getProjectById(userId, req.body.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!db.canEditProject(userId, project.id)) return res.status(403).json({ error: 'You need edit access to revise this plan' });
  if (project.parentId) return res.status(400).json({ error: 'Open the top-level project to revise its plan' });

  const context = buildEditContext(userId, project);
  try {
    const response = await callAI({
      system: 'You revise an existing plan the user already has. Make only the changes that address the request, keep everything else as it is, and never mark anything Completed or delete anything. Use only the ids listed in the plan. Dates are YYYY-MM-DD.',
      messages: [{ role: 'user', content: context.text + '\n\nRequested change: ' + feedback }],
      tools: [EDIT_TOOL],
      forceToolName: 'propose_edits',
      maxTokens: 3000,
    });
    if (response.type !== 'tool_use') throw new Error('AI did not return a revision');
    const { operations, dropped } = validateOperations(response.input.operations, context.index);
    res.json({ summary: response.input.summary || '', operations, dropped });
  } catch (e) {
    console.error('AI edit-project error:', e);
    const apiMessage = e?.error?.error?.message || e?.message || 'Unknown error';
    res.status(502).json({ error: apiMessage });
  }
});

// POST /api/ai/assistant — one conversation that can propose a new goal, or
// proposed edits to a project the user can edit. Like the other AI routes it
// only proposes: nothing is written here, and every proposal is shown for
// review before anything changes.
const ASSISTANT_SYSTEM = today => `You are Waypoint's assistant. You help the user set up goals and keep them on track. Today's date is ${today}.

If the user describes a new goal and you have enough to plan it, call propose_project. If the user asks for changes to the project they have open, and that project's plan is included below, call propose_edits. Otherwise reply in one or two short sentences, asking a question if you need one. Never say you have made a change: you only propose changes, and the user approves them.`;

router.post('/assistant', aiQuota('assistant'), async (req, res) => {
  if (!isAIConfigured()) {
    return res.status(503).json({ error: 'AI is not configured on this server.' });
  }
  const userId = req.session.userId;
  const incoming = Array.isArray(req.body.messages) ? req.body.messages : [];
  const cleaned = incoming
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && ((typeof m.content === 'string' && m.content.trim()) || m.attachment))
    .slice(-20);
  if (!cleaned.length || cleaned[0].role !== 'user') {
    return res.status(400).json({ error: 'Say something to the assistant first' });
  }

  let context = null;
  if (req.body.projectId) {
    const project = db.getProjectById(userId, req.body.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!db.canEditProject(userId, project.id)) return res.status(403).json({ error: 'You need edit access to change this project' });
    if (project.parentId) return res.status(400).json({ error: 'Open the top-level project to change its plan' });
    context = buildEditContext(userId, project);
  }

  const today = new Date().toISOString().slice(0, 10);
  const tools = [IMPORT_TOOL];
  let system = ASSISTANT_SYSTEM(today);
  if (context) {
    tools.push(EDIT_TOOL);
    system += `\n\nThe project the user has open:\n${context.text}`;
  }

  try {
    const messages = await Promise.all(cleaned.map(async m => {
      const text = String(m.content || '').trim().slice(0, 2000);
      if (!m.attachment) return { role: m.role, content: text };
      const blocks = await attachmentToContentBlocks(m.attachment);
      return { role: m.role, content: [...blocks, { type: 'text', text: text || '(see attached file)' }] };
    }));
    const response = await callAI({ system, messages, tools, maxTokens: 4000 });
    if (response.type === 'tool_use' && response.name === 'propose_project') {
      return res.json({ type: 'proposal', proposal: response.input });
    }
    if (response.type === 'tool_use' && response.name === 'propose_edits' && context) {
      const { operations, dropped } = validateOperations(response.input.operations, context.index);
      return res.json({ type: 'edits', summary: response.input.summary || '', operations, dropped });
    }
    res.json({ type: 'message', text: response.text || "Sorry, I didn't catch that — could you say more?" });
  } catch (e) {
    console.error('AI assistant error:', e);
    const apiMessage = e?.error?.error?.message || e?.message || 'Unknown error';
    res.status(502).json({ error: apiMessage });
  }
});

module.exports = router;
