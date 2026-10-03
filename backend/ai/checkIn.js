const cron = require('node-cron');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db/db');
const { sendPushToUser } = require('../push/webpush');
const { notifyCheckIn } = require('../email/activity');

const MODEL = 'claude-haiku-4-5-20251001';
const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Same done/overdue/days-remaining shape the Dashboard's Goals cards compute
// client-side, just derived here from the task tree for the prompt instead
// of for rendering.
function summarizeGoal(tasks) {
  const todayKey = localDateKey(new Date());
  const done = tasks.filter(t => t.status === 'Completed').length;
  const overdue = tasks.filter(t => t.status !== 'Completed' && t.endDate && t.endDate.slice(0, 10) < todayKey).length;
  const dueDates = tasks.map(t => t.endDate).filter(Boolean).sort();
  const latestDue = dueDates[dueDates.length - 1] || null;
  return { total: tasks.length, done, overdue, latestDue };
}

// One short, specific check-in message per goal — plain text, no tool call:
// this is deliberately *not* allowed to touch the plan/tasks themselves,
// just read status and say something useful about it. Auto-editing a
// user's timeline from a cron job is a much bigger trust risk than a
// read-only nudge, so that's left for a future pass if this isn't enough.
async function generateCheckInMessage(client, userName, projectTitle, stats) {
  const today = new Date().toISOString().slice(0, 10);
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: `You are a supportive accountability coach checking in on someone's goal. Today's date is ${today}. Write 2-3 short, specific, plain-spoken sentences: acknowledge real progress if there is any, name what's stalled or overdue if anything is, and end with one concrete next action. No greeting, no sign-off, no markdown — just the message body.`,
    messages: [{
      role: 'user',
      content: `Goal: "${projectTitle}" (${userName}'s account)\nTotal tasks: ${stats.total}\nCompleted: ${stats.done}\nOverdue: ${stats.overdue}\nLatest due date in the plan: ${stats.latestDue || 'none set'}`,
    }],
  });
  const textBlock = response.content.find(c => c.type === 'text');
  return textBlock ? textBlock.text.trim() : null;
}

async function runWeeklyCheckIns() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('Weekly AI check-ins skipped: ANTHROPIC_API_KEY not set.');
    return;
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const now = new Date();

  for (const goal of db.listGoalProjectsForCheckIn()) {
    if (goal.lastCheckInAt && now.getTime() - new Date(goal.lastCheckInAt).getTime() < SIX_DAYS_MS) continue;
    try {
      const tasks = db.listTasksInProjectTree(goal.userId, goal.projectId);
      if (!tasks.length) continue; // nothing to say about an empty goal
      const stats = summarizeGoal(tasks);
      const profile = db.getProfile(goal.userId);
      const message = await generateCheckInMessage(client, profile.name, goal.title, stats);
      if (!message) continue;

      await sendPushToUser(goal.userId, { title: `🎯 Check-in: ${goal.title}`, body: message, url: undefined });
      await notifyCheckIn(goal.userId, { projectTitle: goal.title, message });
      db.setProjectLastCheckInAt(goal.projectId, now.toISOString());
    } catch (e) {
      console.error(`Weekly check-in failed for goal ${goal.projectId}:`, e.message);
    }
  }
}

function startCheckInScheduler() {
  cron.schedule('0 9 * * 1', () => {
    runWeeklyCheckIns().catch(e => console.error('Weekly check-in run failed:', e.message));
  });
}

module.exports = { startCheckInScheduler, runWeeklyCheckIns };
