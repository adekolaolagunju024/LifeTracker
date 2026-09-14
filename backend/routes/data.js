const express = require('express');
const router  = express.Router();
const { v4: uuid } = require('uuid');
const db = require('../db/db');

// POST /api/data/import — takes the JSON produced by Settings → Export Data
// and recreates it for the current user. Additive, not a wipe-and-replace:
// safe to run against an account that already has data, though re-running
// the same file twice will duplicate everything (no de-duplication).
router.post('/import', (req, res) => {
  try {
    const userId = req.session.userId;
    const { profile, projects = [], tasks = [], wealth = {} } = req.body || {};

    if (profile) {
      db.updateProfile(userId, {
        name: profile.name,
        tagline: profile.tagline,
        currency: profile.currency,
        targetNetWorth: profile.targetNetWorth,
        targetDate: profile.targetDate,
        onboarded: true,
      });
    }

    // Projects: top-level first, then sub-folders, remapping old ids to the
    // freshly-created ones (this account's ids won't match the export's).
    const idMap = {};
    const topLevel = projects.filter(p => !p.parentId);
    const subs     = projects.filter(p => p.parentId);

    for (const p of topLevel) {
      const created = db.createProject(userId, {
        id: uuid(),
        title: p.title,
        description: p.description,
        icon: p.icon,
        color: p.color,
        startDate: p.startDate,
        type: p.type,
        createdAt: new Date().toISOString(),
      });
      idMap[p.id] = created.id;
    }
    for (const p of subs) {
      const newParentId = idMap[p.parentId];
      if (!newParentId) continue; // parent wasn't in the export — skip rather than guess
      const created = db.createProject(userId, {
        id: uuid(),
        title: p.title,
        description: p.description,
        icon: p.icon,
        color: p.color,
        startDate: p.startDate,
        parentId: newParentId,
        createdAt: new Date().toISOString(),
      });
      idMap[p.id] = created.id;
    }

    let taskCount = 0;
    for (const t of tasks) {
      const newProjectId = idMap[t.projectId];
      if (!newProjectId) continue;
      db.createTask(userId, {
        id: uuid(),
        projectId: newProjectId,
        title: t.title,
        status: t.status,
        priority: t.priority,
        startDate: t.startDate,
        endDate: t.endDate,
        cost: t.cost,
        notes: t.notes,
        createdAt: new Date().toISOString(),
      });
      taskCount++;
    }

    // Wealth categories keep their original key so wealth.entries (keyed
    // the same way) lines up without needing a separate remap.
    let wealthCount = 0;
    if (wealth.targets) {
      for (const [key, wt] of Object.entries(wealth.targets)) {
        db.addWealthTarget(userId, key, wt.label, wt.target);
        wealthCount++;
      }
    }
    if (wealth.entries) db.updateWealthEntries(userId, wealth.entries);

    let logCount = 0;
    if (Array.isArray(wealth.monthlyLog)) {
      for (const entry of wealth.monthlyLog) {
        db.addMonthlyLogEntry(userId, {
          id: uuid(),
          date: entry.date || new Date().toISOString(),
          month: entry.month,
          income: entry.income,
          business: entry.business,
          expenses: entry.expenses,
          saved: entry.saved,
          notes: entry.notes,
        });
        logCount++;
      }
    }

    res.json({
      success: true,
      projects: Object.keys(idMap).length,
      tasks: taskCount,
      wealthCategories: wealthCount,
      logEntries: logCount,
    });
  } catch (e) {
    console.error('Data import error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
