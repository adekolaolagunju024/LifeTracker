const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const ExcelJS = require('exceljs');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db/db');

const MODEL = 'claude-haiku-4-5-20251001';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// GET /api/ai/status — lets the frontend show "not configured" without
// triggering a real (billable) call, same pattern as Google Drive backup.
router.get('/status', (req, res) => {
  res.json({ configured: !!process.env.ANTHROPIC_API_KEY });
});

// POST /api/ai/insights — sends the user's open tasks to Claude and asks
// for a prioritized focus list plus a few suggested next-step tasks.
router.post('/insights', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'AI is not configured on this server. Add ANTHROPIC_API_KEY to .env to enable it.' });
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

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: `You are a practical productivity assistant helping someone prioritize open tasks across their life, career, and wealth goals. Today's date is ${today}. Be concise and specific — reference real deadlines and real progress, not generic advice.`,
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
      tool_choice: { type: 'tool', name: 'provide_insights' },
    });

    const toolUse = response.content.find(c => c.type === 'tool_use');
    if (!toolUse) throw new Error('AI did not return structured insights');

    const result = toolUse.input;
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
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells = [];
      row.eachCell({ includeEmpty: false }, cell => cells.push(String(cell.value ?? '').trim()));
      if (cells.some(Boolean)) parts.push(cells.join(' | '));
    });
  });
  return parts.join('\n');
}

const IMPORT_TOOL = {
  name: 'propose_project',
  description: 'Return a proposed project and its tasks extracted from the uploaded file',
  input_schema: {
    type: 'object',
    properties: {
      title:       { type: 'string', description: 'A short project title summarising the file' },
      icon:        { type: 'string', description: 'One emoji that fits the project' },
      description: { type: 'string', description: 'One sentence describing the project' },
      tasks: {
        type: 'array',
        description: 'Every concrete task/action/goal item found in the file',
        items: {
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
        },
      },
    },
    required: ['title', 'icon', 'description', 'tasks'],
  },
};

const IMPORT_SYSTEM_PROMPT = today => `You extract a project plan from a document a user uploaded (spreadsheet text, a PDF, or an image of a plan/list). Today's date is ${today}. Identify a sensible project title and every concrete task, goal, or action item in it. If dates are written as just a month/year, use the 1st of that month. Never invent tasks that aren't actually in the source. Call the propose_project tool with the result.`;

// POST /api/ai/import-project — upload a .xlsx/.pdf/.png/.jpg and get back a
// proposed project + task list for the user to review before anything is
// actually created (creation itself reuses the normal project/task APIs).
// multer is invoked manually (rather than as route middleware) so an
// upload error — e.g. the 15MB limit — comes back as JSON instead of
// falling through to Express's default HTML error page.
router.post('/import-project', (req, res) => {
  upload.single('file')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message || 'File upload failed' });
    handleImportProject(req, res);
  });
});

async function handleImportProject(req, res) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'AI is not configured on this server. Add ANTHROPIC_API_KEY to .env to enable it.' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { mimetype, originalname, buffer } = req.file;
  const today = new Date().toISOString().slice(0, 10);

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    let content;

    if (mimetype.includes('spreadsheet') || /\.xlsx?$/i.test(originalname)) {
      const text = await excelToText(buffer);
      if (!text.trim()) return res.status(400).json({ error: 'That spreadsheet looks empty' });
      content = [{ type: 'text', text: `File: ${originalname}\n\n${text}\n\nExtract a project and its tasks, then call propose_project.` }];
    } else if (mimetype === 'application/pdf') {
      content = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } },
        { type: 'text', text: `File: ${originalname}\n\nExtract a project and its tasks from this document, then call propose_project.` },
      ];
    } else if (mimetype.startsWith('image/')) {
      content = [
        { type: 'image', source: { type: 'base64', media_type: mimetype, data: buffer.toString('base64') } },
        { type: 'text', text: `File: ${originalname}\n\nExtract a project and its tasks from this image, then call propose_project.` },
      ];
    } else {
      return res.status(400).json({ error: 'Unsupported file type. Upload a .xlsx, .pdf, .png, or .jpg.' });
    }

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: IMPORT_SYSTEM_PROMPT(today),
      messages: [{ role: 'user', content }],
      tools: [IMPORT_TOOL],
      tool_choice: { type: 'tool', name: 'propose_project' },
    });

    const toolUse = response.content.find(c => c.type === 'tool_use');
    if (!toolUse) throw new Error('AI could not read a project out of that file');
    res.json(toolUse.input);
  } catch (e) {
    console.error('AI import-project error:', e);
    const apiMessage = e?.error?.error?.message || e?.message || 'Unknown error';
    res.status(502).json({ error: apiMessage });
  }
}

const BREAKDOWN_SYSTEM_PROMPT = today => `You help someone who has a goal but doesn't know how to break it down into concrete steps. Today's date is ${today}. Given a plain-language goal description (and optionally a target timeframe), propose a project and a sequence of concrete, actionable tasks that would realistically achieve it.

Sequence the tasks logically (e.g. research/setup before execution, execution before review), and give each one a realistic startDate and endDate so the whole set is spread sensibly across the available time — don't pile every task onto the same day, and don't make one task span the entire timeframe. If no timeframe is given, use your own judgment for a sensible overall duration for a goal like this and say so implicitly through the dates you choose. Aim for 5-12 tasks — enough to be a genuine plan, not so many it's overwhelming. Call the propose_project tool with the result.`;

// POST /api/ai/breakdown-goal — same output shape as import-project, but
// starting from a plain-text goal description instead of an uploaded file,
// for someone who doesn't have a source document and just needs a
// starting plan. Shares the review-before-creating step (and the actual
// project/task creation) with the file-import flow on the frontend.
router.post('/breakdown-goal', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'AI is not configured on this server. Add ANTHROPIC_API_KEY to .env to enable it.' });
  }
  const goal = String(req.body.goal || '').trim();
  const timeframe = String(req.body.timeframe || '').trim();
  if (!goal) return res.status(400).json({ error: 'Describe your goal first' });

  const today = new Date().toISOString().slice(0, 10);
  const userText = `My goal: ${goal}${timeframe ? `\nTarget timeframe: ${timeframe}` : ''}\n\nBreak this down into a project and a sequenced list of tasks with realistic dates, then call propose_project.`;

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: BREAKDOWN_SYSTEM_PROMPT(today),
      messages: [{ role: 'user', content: userText }],
      tools: [IMPORT_TOOL],
      tool_choice: { type: 'tool', name: 'propose_project' },
    });

    const toolUse = response.content.find(c => c.type === 'tool_use');
    if (!toolUse) throw new Error('AI could not break that goal down');
    res.json(toolUse.input);
  } catch (e) {
    console.error('AI breakdown-goal error:', e);
    const apiMessage = e?.error?.error?.message || e?.message || 'Unknown error';
    res.status(502).json({ error: apiMessage });
  }
});

const CHAT_SYSTEM_PROMPT = today => `You are a friendly planning assistant helping someone turn a goal into a concrete project with tasks, through natural back-and-forth conversation. Today's date is ${today}.

Ask short, specific clarifying questions when they'd genuinely sharpen the plan — timeframe, scope, current progress, constraints. Don't interrogate: one or two questions is usually enough, and if the goal is already clear and specific, you can skip straight to proposing.

Once you have enough to propose a solid, sequenced plan AND the user seems ready (they've answered your questions, or said something like "go ahead", "that's enough", "just do it"), call the propose_project tool with realistic startDate/endDate on every task — don't pile everything on one day. Otherwise, just send a normal short conversational reply (a sentence or two, plus your question) and do not call the tool yet.`;

// POST /api/ai/project-chat — a multi-turn version of breakdown-goal: the
// frontend keeps the whole conversation client-side (this endpoint is
// stateless) and resends it every turn. Claude either replies with plain
// text to keep the conversation going, or calls propose_project once it
// has enough to finalize — same tool/shape as import-project and
// breakdown-goal, so the frontend's review-before-creating step is shared.
router.post('/project-chat', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'AI is not configured on this server. Add ANTHROPIC_API_KEY to .env to enable it.' });
  }

  const incoming = Array.isArray(req.body.messages) ? req.body.messages : [];
  const messages = incoming
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.trim() }))
    .slice(-30);

  if (!messages.length || messages[0].role !== 'user') {
    return res.status(400).json({ error: 'No conversation to respond to' });
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: CHAT_SYSTEM_PROMPT(today),
      messages,
      tools: [IMPORT_TOOL],
      tool_choice: { type: 'auto' },
    });

    const toolUse = response.content.find(c => c.type === 'tool_use');
    if (toolUse) return res.json({ type: 'proposal', proposal: toolUse.input });

    const textBlock = response.content.find(c => c.type === 'text');
    res.json({ type: 'message', message: textBlock ? textBlock.text : "Sorry, I didn't catch that — could you say more?" });
  } catch (e) {
    console.error('AI project-chat error:', e);
    const apiMessage = e?.error?.error?.message || e?.message || 'Unknown error';
    res.status(502).json({ error: apiMessage });
  }
});

module.exports = router;
