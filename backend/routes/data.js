const express = require('express');
const router  = express.Router();
const { v4: uuid } = require('uuid');
const db = require('../db/db');

// GET /api/data/export/:projectId — one project's own tree (itself, its
// sub-folders, and their tasks) as a downloadable JSON snapshot, same
// shape the whole-account Export Data (JSON) produces, so it can be
// re-imported the same way.
router.get('/export/:projectId', (req, res) => {
  const snapshot = db.getProjectSnapshot(req.session.userId, req.params.projectId);
  if (!snapshot) return res.status(404).json({ error: 'Project not found' });
  res.json(snapshot);
});

// POST /api/data/import — takes the JSON produced by Settings → Export Data
// and recreates it for the current user. Additive, not a wipe-and-replace:
// safe to run against an account that already has data, though re-running
// the same file twice will duplicate everything (no de-duplication).
// A goal stays a goal, and each task keeps its named blockers, tags,
// counted target and the tasks it waits on.
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
        isGoal: !!p.isGoal,
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

    // Tags by name: reuse this account's tag of the same name, or make it.
    const tagIds = new Map(db.listTags(userId).map(tg => [tg.label.toLowerCase(), tg.id]));
    const tagId = tg => {
      const label = String((tg && typeof tg === 'object' ? tg.label : tg) || '').trim().slice(0, 40);
      if (!label) return null;
      if (!tagIds.has(label.toLowerCase())) tagIds.set(label.toLowerCase(), db.createTag(userId, { label, color: tg && tg.color }).id);
      return tagIds.get(label.toLowerCase());
    };
    const taskIdMap = {};
    let taskCount = 0;
    for (const t of tasks) {
      const newProjectId = idMap[t.projectId];
      if (!newProjectId) continue;
      const created = db.createTask(userId, {
        id: uuid(),
        projectId: newProjectId,
        title: t.title,
        status: t.status,
        priority: t.priority,
        startDate: t.startDate,
        endDate: t.endDate,
        cost: t.cost,
        notes: t.notes,
        // a counted target (e.g. 20 practice tests) and how far along it is
        targetCount: Number.isInteger(t.targetCount) && t.targetCount > 0 ? Math.min(t.targetCount, 10000) : null,
        targetUnit: t.targetUnit ? String(t.targetUnit).slice(0, 40) : null,
        progressCount: Number.isInteger(t.progressCount) && t.progressCount > 0 && Number.isInteger(t.targetCount) ? Math.min(t.progressCount, t.targetCount) : 0,
        createdAt: new Date().toISOString(),
      });
      taskIdMap[t.id] = created.id;
      if (Array.isArray(t.tags) && t.tags.length) db.setTaskTags(userId, created.id, t.tags.slice(0, 10).map(tagId).filter(Boolean));
      // its named blockers come across too, ticked off or not
      for (const o of (Array.isArray(t.obstacles) ? t.obstacles : []).slice(0, 20)) {
        if (!o || !String(o.name || '').trim()) continue;
        const ob = db.addObstacle(userId, created.id, { name: o.name, count: o.count });
        if (ob && o.resolved) db.updateObstacle(userId, ob.id, { resolved: true });
      }
      taskCount++;
    }

    // What each task waits on, once every task exists (ids remapped).
    for (const t of tasks) {
      const pre = (Array.isArray(t.predecessors) ? t.predecessors : []).map(x => taskIdMap[x && typeof x === 'object' ? x.id : x]).filter(Boolean);
      if (pre.length && taskIdMap[t.id]) db.setTaskPredecessors(userId, taskIdMap[t.id], pre);
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
