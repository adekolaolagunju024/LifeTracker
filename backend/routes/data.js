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
    const { profile, projects = [], tasks = [] } = req.body || {};

    if (profile) {
      db.updateProfile(userId, {
        name: profile.name,
        tagline: profile.tagline,
        currency: profile.currency,
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

    res.json({
      success: true,
      projects: Object.keys(idMap).length,
      tasks: taskCount,
    });
  } catch (e) {
    console.error('Data import error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
