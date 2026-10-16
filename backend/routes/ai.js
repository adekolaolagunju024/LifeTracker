const express = require('express');
const router  = express.Router();
const ExcelJS = require('exceljs');
const db = require('../db/db');
const motivation = require('../motivation');
const { buildDayContext, APP_TOOL, validateActions } = require('../ai/day');
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
      const pro = require('../billing').isPro(req.session.userId);
      return res.status(429).json({ error: pro ? "You've used today's AI allowance. It resets tomorrow. Everything else in KolaWay still works." : "You've used today's AI allowance. It resets tomorrow, or KolaWay Pro gives you ten times as much (Settings, Profile). Everything else still works.", upgrade: !pro });
    }
    next();
  };
}

// GET /api/ai/status — lets the frontend show "not configured" without
// triggering a real (billable) call, same pattern as Google Drive backup.
router.get('/status', (req, res) => {
  res.json({ configured: isAIConfigured() });
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

// The user's focus music (Your why): play it in the app's music dock, or
// offer to save a playlist link the user pasted. Saving is only proposed;
// the user confirms it, and only a link that appears in their own message
// is accepted, so the assistant can't invent one.
const MUSIC_TOOL = {
  name: 'focus_music',
  description: "Play one of the user's saved playlists in the app's music player, or offer to add a music link the user pasted (Spotify, YouTube, Apple Music, SoundCloud or Deezer) to their music library.",
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['play', 'pause', 'save'], description: 'play: start one of their saved playlists (or resume). pause: pause what is playing. save: offer to add the link they pasted to their library.' },
      name: { type: 'string', description: 'For play: which saved playlist, by its name, if they said one; leave empty for their default' },
      url: { type: 'string', description: 'For save: the exact link from the user\'s message' },
      label: { type: 'string', description: 'For save: a short name for it, if they gave one' },
      reply: { type: 'string', description: 'One short, warm sentence to show the user' },
    },
    required: ['action', 'reply'],
  },
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
      system: 'You revise an existing plan the user already has. Make only the changes that address the request, keep everything else as it is, and never mark anything Completed or delete a phase. Delete a task only when the user asks for it (it goes to Trash). Blockers may be added, edited, ticked off or removed when asked. A task\'s progress target (targetCount with an optional targetUnit; 0 clears it) and its predecessors (addPredecessor/removePredecessor: tasks it waits on) may be set when asked. Use only the ids listed in the plan. Dates are YYYY-MM-DD.',
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
const ASSISTANT_SYSTEM = today => `You are KolaWay's assistant: a calm, capable personal assistant in the spirit of a great chief of staff. You know the user's goals, plans and day (below), you help them decide what to do next, and you act in the app for them. You are warm and direct, never preachy, and you keep replies short because they are often spoken aloud. Today's date is ${today}.

When the user wants something done in the app (open a page, project or task; start focusing on a task, optionally with their music; finish a task; set a reminder; add a task), call take_actions with the ids from the context. When they ask what to do next, pick one task from their day, say why in a sentence, and offer to start a focus session on it.

If the user describes a new goal and you have enough to plan it, call propose_project. If the user asks for changes to the project they have open, and that project's plan is included below, call propose_edits. That includes deleting a task the user wants gone (it goes to Trash and can be restored), and a task's blockers (the obstacles in its way, listed under each task): adding one, renaming it, changing its count, ticking it off as cleared, or removing it. It also covers a task's progress target (a count such as 20 pages, set through updateTask's targetCount and targetUnit, or cleared with 0) and its predecessors (the tasks it waits on, shown as "waits on" in the plan): addPredecessor and removePredecessor. If the user asks for their music (play my music, put my workout playlist on, I need focus music) call focus_music with action play, naming the playlist if they did; to stop or pause it, action pause; if they paste a music link to keep, call focus_music with action save. Otherwise reply in one or two short sentences, asking a question if you need one. Never say you have made a change: you only propose changes, and the user approves them.`;

// POST /api/ai/fill {form, fields: [{key, label, type, options?, hint?}],
// values: {key: what's there now}, context, projectId?, taskId?}
// "Fill in for me": proposes values for the empty fields. Nothing is saved.
router.post('/fill', aiQuota(), async (req, res) => {
  if (!isAIConfigured()) return res.status(503).json({ error: 'The assistant is not set up on this server.' });
  const userId = req.session.userId;
  const fill = require('../ai/fill');
  const fields = fill.cleanFields(req.body.fields);
  const values = req.body.values && typeof req.body.values === 'object' ? req.body.values : {};
  const empty = fields.filter(f => { const v = values[f.key]; return v == null || v === '' || (Array.isArray(v) && !v.length); });
  if (!empty.length) return res.json({ values: {} });
  const lines = [`Form: ${String(req.body.form || 'a form').slice(0, 60)}`];
  const filled = fields.filter(f => !empty.includes(f));
  if (filled.length) lines.push('Already filled in:', ...filled.map(f => `${f.label}: ${String(Array.isArray(values[f.key]) ? values[f.key].join('; ') : values[f.key]).slice(0, 400)}`));
  if (req.body.context) lines.push(`Context: ${String(req.body.context).slice(0, 3000)}`);
  // The goal (and step) it's about, read here rather than trusted from the page.
  const task = req.body.taskId ? db.getTaskById(userId, req.body.taskId) : null;
  const projectId = (task && task.projectId) || req.body.projectId;
  const project = projectId ? db.getProjectById(userId, projectId) : null;
  if (project) {
    const top = project.parentId ? db.getProjectById(userId, project.parentId) || project : project;
    const steps = db.listTasks(userId).filter(t => t.projectId === top.id || t.projectId === project.id).slice(0, 40);
    lines.push(`Goal: ${top.title}${top.description ? ` (${top.description.slice(0, 300)})` : ''}`);
    if (steps.length) lines.push(`Its steps: ${steps.map(t => `${t.title}${t.status === 'Completed' ? ' (done)' : t.endDate ? ` (due ${t.endDate.slice(0, 10)})` : ''}`).join('; ')}`);
  }
  if (task) lines.push(`This step: ${task.title} (${task.status}${task.endDate ? `, due ${task.endDate.slice(0, 10)}` : ''})${task.notes ? `, notes: ${task.notes.slice(0, 300)}` : ''}${(task.obstacles || []).filter(o => !o.resolved).length ? `, blockers: ${task.obstacles.filter(o => !o.resolved).map(o => o.name).join(', ')}` : ''}`);
  lines.push(`Fill in: ${empty.map(f => f.label).join(', ')}`);
  const today = new Date().toISOString().slice(0, 10);
  try {
    const profile = db.getProfile(userId) || {};
    const out = await callAI({
      system: fill.systemPrompt(today, profile.name && profile.name !== 'Your Name' ? profile.name.split(' ')[0] : ''),
      messages: [{ role: 'user', content: lines.join('\n') }],
      tools: [fill.fillTool(empty)], forceToolName: 'fill_form', maxTokens: 800,
    });
    res.json({ values: out.type === 'tool_use' ? fill.validate(empty, out.input, today) : {} });
  } catch (e) {
    console.error('AI fill error:', e);
    res.status(502).json({ error: 'The assistant could not fill it in just now. Try again in a moment.' });
  }
});

router.post('/assistant', aiQuota('assistant'), async (req, res) => {
  // The request is checked first (and attachments read) so a bad request
  // gets its own answer; whether AI is set up only matters for the call.
  const userId = req.session.userId;
  const incoming = Array.isArray(req.body.messages) ? req.body.messages : [];
  const cleaned = incoming
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && ((typeof m.content === 'string' && m.content.trim()) || m.attachment))
    .slice(-20);
  // a long chat trimmed to its latest messages must still start with the user
  while (cleaned.length > 1 && cleaned[0].role !== 'user' && incoming.length > 20) cleaned.shift();
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
    // Opened from a task: "this task" means that one.
    if (req.body.taskId && context.index.taskById.has(req.body.taskId)) {
      const t = context.index.taskById.get(req.body.taskId);
      context.text += `\n\nThe user opened the assistant from the task "${t.title}" (task id:${t.id}). When they say "this task" or "it", they mean that task.`;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const tools = [IMPORT_TOOL, MUSIC_TOOL, APP_TOOL];
  const day = buildDayContext(userId, typeof req.body.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.today) ? req.body.today : new Date().toISOString().slice(0, 10));
  let system = ASSISTANT_SYSTEM(today);
  // Their own "Your why" (if they allow it), so encouragement speaks to
  // what actually moves them. Never invented quotes or words for real people.
  const why = motivation.forAssistant(motivation.get(req.session.userId));
  if (why) system += `\n\nWhat keeps this user going, in their own words. When they're stuck or low, encourage them briefly with these (their reason, who they're becoming, their mentor's routine, a quote they chose). Quote only what is listed here, exactly, and never make up a quote or put words in a real person's mouth:\n${why}`;
  system += `\n\nThe user's day, across all their projects:\n${day.text}`;
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
    if (!isAIConfigured()) return res.status(503).json({ error: 'AI is not configured on this server.' });
    const response = await callAI({ system, messages, tools, maxTokens: 4000 });
    if (response.type === 'tool_use' && response.name === 'propose_project') {
      return res.json({ type: 'proposal', proposal: response.input });
    }
    if (response.type === 'tool_use' && response.name === 'take_actions') {
      const actions = validateActions(userId, response.input && response.input.actions, day);
      return res.json({ type: 'actions', text: (response.input && response.input.reply) || 'On it.', actions });
    }
    if (response.type === 'tool_use' && response.name === 'focus_music') {
      const { action, reply } = response.input || {};
      const library = motivation.get(userId).playlists;
      if (action === 'pause') return res.json({ type: 'music', action: 'pause', text: reply || 'Paused.' });
      if (action === 'save') {
        // Only a link the user actually sent, and only a web link.
        const lastUser = [...cleaned].reverse().find(m => m.role === 'user');
        const url = String(response.input.url || '').trim();
        const clean = motivation.clean({ playlist: { url, label: response.input.label } }).playlist;
        if (clean.url && lastUser && String(lastUser.content || '').includes(url)) {
          return res.json({ type: 'music', action: 'save', url: clean.url, label: clean.label, text: reply || 'Want me to save that as your focus music?' });
        }
        return res.json({ type: 'message', text: 'Paste the link to your playlist and I\'ll save it as your focus music.' });
      }
      if (!library.length) return res.json({ type: 'music', action: 'setup', text: "You haven't added any music yet. Paste a Spotify, YouTube or Apple Music link here, or add it in Your why." });
      const want = String(response.input.name || '').trim().toLowerCase();
      const found = want ? library.findIndex(p => (p.label || '').toLowerCase().includes(want) || want.includes((p.label || '').toLowerCase() || '\u0000')) : 0;
      if (found < 0) return res.json({ type: 'message', text: `I couldn't find "${response.input.name}" in your music. You have: ${library.map(p => p.label || 'Untitled').join(', ')}.` });
      return res.json({ type: 'music', action: 'play', index: found, label: library[found].label, text: reply || `Putting on ${library[found].label || 'your music'}.` });
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

// ── SAVED CONVERSATIONS ─────────────────────────────────────────
// The assistant's chats, kept per user so one can be picked up again
// after closing the window. The client saves the whole (cleaned) message
// list after each exchange; nothing here calls the AI.
router.get('/conversations', (req, res) => {
  res.json(db.listAssistantConversations(req.session.userId));
});
router.get('/conversations/:id', (req, res) => {
  const convo = db.getAssistantConversation(req.session.userId, req.params.id);
  if (!convo) return res.status(404).json({ error: 'Conversation not found' });
  res.json(convo);
});
router.put('/conversations/:id', (req, res) => {
  try {
    res.json(db.saveAssistantConversation(req.session.userId, req.params.id, { projectId: req.body.projectId || null, messages: req.body.messages }));
  } catch (e) {
    res.status(/not found/i.test(e.message) ? 404 : 400).json({ error: e.message });
  }
});
router.delete('/conversations/:id', (req, res) => {
  db.deleteAssistantConversation(req.session.userId, req.params.id);
  res.json({ success: true });
});

// ── YOUR WHY, AS A CONVERSATION ─────────────────────────────────
// Forms put people off, so Your why can be filled by a short interview:
// one question at a time, spoken or typed, then a draft for the person to
// check and save (nothing is saved here). Quotes come only from the
// starter shelf (by id) or the person's own words, music links only from
// what they pasted, and a real mentor's words only from the person.
const WHY_TOOL = {
  name: 'draft_why',
  description: "Return a draft of the user's Your why once you have enough",
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'One warm sentence to say as you hand over the draft' },
      why: { type: 'string', description: 'Why their goal matters to them, in their own voice, first person, one sentence' },
      becoming: { type: 'string', description: 'Who they are becoming, completing "I\'m becoming…", short' },
      mentorPreset: { type: 'string', enum: ['athlete', 'founder', 'scholar', 'carer', 'creator', ''], description: 'If they picked a type of mentor rather than a person' },
      mentorName: { type: 'string', description: 'The person they look up to, if a real person' },
      mentorRoutine: { type: 'string', description: "That person's routine or habits, as the user described them" },
      mentorSays: { type: 'string', description: 'For a real person: only words the user said that person would say. For a type: one short line in that spirit.' },
      sources: { type: 'array', items: { type: 'string', enum: ['Bible', 'Quran', 'Books and speeches'] }, description: 'Where they said they like their words from; empty if none of these' },
      shelfQuoteIds: { type: 'array', items: { type: 'string' }, description: 'Ids of starter-shelf quotes, only from the sources they chose' },
      ownQuotes: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, source: { type: 'string' } } }, description: 'Quotes the user typed or said themselves, word for word' },
      musicLinks: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, label: { type: 'string' } } }, description: 'Music links the user pasted' },
    },
    required: ['reply'],
  },
};

const WHY_SYSTEM = shelf => `You are KolaWay's coach, helping someone put into words what keeps them going, so the app can remind them when they are about to give up. Have a short, warm conversation: ask ONE short question at a time (under 20 words), react briefly to what they say, and never lecture. Cover, in this order, skipping anything they already answered: the goal they care about most and why it matters to them; who they are becoming; someone they look up to (a real person, or a type: athlete, founder, scholar, carer, creator) and what that person does or their routine; where they draw strength from (ask openly: their faith and which one, books or speeches, songs, people they know, or nothing in particular) and words that move them. Only suggest starter-shelf lines from a source they chose; never offer scripture from a faith they did not name; and music they work to (they can paste a Spotify, YouTube or Apple Music link, or skip). After about five questions, or sooner if they want, call draft_why.

Rules: write their why and becoming in their own voice. Never invent a quote or attribute words to a real person; real-person mentor words must be the user's own. Starter shelf quotes go in shelfQuoteIds by id only. Use only music links they pasted. If they seem low, be kind and practical.

Starter shelf (id: text — source):
${shelf}`;

router.post('/why-interview', aiQuota('assistant'), async (req, res) => {
  if (!isAIConfigured()) return res.status(503).json({ error: 'The AI interview is not available right now. You can fill in Your why yourself below.' });
  const msgs = (Array.isArray(req.body.messages) ? req.body.messages : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-24)
    .map(m => ({ role: m.role, content: m.content.trim().slice(0, 1500) }));
  if (!msgs.some(m => m.role === 'user')) return res.status(400).json({ error: 'Say something first' });
  // The interview opens with our own first question; the model needs the
  // person to speak first.
  if (msgs[0].role !== 'user') msgs.unshift({ role: 'user', content: 'Help me put my why into words.' });
  const shelf = motivation.LIBRARY.map(q => `${q.id}: ${q.text} — ${q.source}`).join('\n');
  try {
    const response = await callAI({ system: WHY_SYSTEM(shelf), messages: msgs, tools: [WHY_TOOL], maxTokens: 1200 });
    if (!(response.type === 'tool_use' && response.name === 'draft_why')) {
      return res.json({ type: 'question', text: response.text || 'Tell me a little more?' });
    }
    const d = response.input || {};
    const draft = motivation.draftFromInterview(d, msgs.filter(m => m.role === 'user').map(m => m.content));
    res.json({ type: 'draft', text: d.reply || "Here's your why. Change anything you like, then save it.", draft });
  } catch (e) {
    console.error('Why interview error:', e);
    res.status(502).json({ error: e?.message || 'The interview could not continue' });
  }
});

module.exports = router;
