const express = require('express');
const router  = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db/db');

const MODEL = 'claude-haiku-4-5-20251001';

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
    res.status(500).json({ error: 'Failed to generate AI insights. ' + (e.message || '') });
  }
});

module.exports = router;
