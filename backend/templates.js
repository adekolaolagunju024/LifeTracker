const { v4: uuid } = require('uuid');
const connection = require('./db/connection');
const db = require('./db/db');

// Ready-made plans to start a project from, like the template galleries in
// Asana or Notion. Each is a goal with phases and tasks whose dates count
// from the chosen start day (`start` days in, lasting `days`), plus the
// tasks each one waits on (`after`, by key) and an optional target.
const TEMPLATES = [
  {
    id: 'job-hunt', icon: '💼', color: '#0A7E8C', title: 'Land a new job',
    description: 'From a sharp CV to signing an offer, with a weekly target for applications.',
    phases: [
      { title: 'Get ready', tasks: [
        { key: 'cv', title: 'Update my CV for the roles I want', start: 0, days: 4, priority: 'High' },
        { key: 'linkedin', title: 'Refresh my LinkedIn profile', start: 2, days: 3 },
        { key: 'list', title: 'List 20 organisations I would like to work for', start: 3, days: 4 },
      ] },
      { title: 'Apply', tasks: [
        { key: 'apply', title: 'Send applications', start: 7, days: 21, priority: 'High', after: ['cv'], target: [15, 'applications'] },
        { key: 'statement', title: 'Write a supporting statement I can tailor', start: 7, days: 5, after: ['cv'] },
        { key: 'network', title: 'Message five people in roles I want', start: 9, days: 14, target: [5, 'messages'] },
      ] },
      { title: 'Interview and offer', tasks: [
        { key: 'prep', title: 'Prepare STAR examples for interviews', start: 14, days: 7, after: ['statement'] },
        { key: 'mock', title: 'Do a mock interview', start: 21, days: 3, after: ['prep'] },
        { key: 'offer', title: 'Accept an offer', start: 35, days: 7, priority: 'High', after: ['apply', 'mock'] },
      ] },
    ],
  },
  {
    id: 'exam', icon: '📚', color: '#6D28D9', title: 'Pass an exam',
    description: 'A study plan that covers the syllabus, practises past papers and leaves time to revise.',
    phases: [
      { title: 'Plan', tasks: [
        { key: 'syllabus', title: 'Break the syllabus into topics', start: 0, days: 2, priority: 'High' },
        { key: 'timetable', title: 'Make a weekly study timetable', start: 1, days: 2, after: ['syllabus'] },
      ] },
      { title: 'Learn', tasks: [
        { key: 'topics', title: 'Work through every topic', start: 3, days: 28, priority: 'High', after: ['timetable'], target: [12, 'topics'] },
        { key: 'notes', title: 'Make flashcards for key facts', start: 5, days: 25 },
      ] },
      { title: 'Practise and sit it', tasks: [
        { key: 'papers', title: 'Do past papers under timed conditions', start: 24, days: 14, after: ['topics'], target: [6, 'papers'] },
        { key: 'weak', title: 'Revise my weakest topics again', start: 32, days: 7, after: ['papers'] },
        { key: 'exam', title: 'Sit the exam', start: 42, days: 1, priority: 'High', after: ['weak'] },
      ] },
    ],
  },
  {
    id: 'side-project', icon: '🚀', color: '#C0642A', title: 'Launch a side project',
    description: 'Validate the idea, build the smallest useful version and get it in front of people.',
    phases: [
      { title: 'Idea', tasks: [
        { key: 'problem', title: 'Write down the problem and who has it', start: 0, days: 2, priority: 'High' },
        { key: 'talk', title: 'Talk to people who have the problem', start: 2, days: 7, after: ['problem'], target: [5, 'conversations'] },
      ] },
      { title: 'Build', tasks: [
        { key: 'scope', title: 'Choose the smallest version worth making', start: 9, days: 2, after: ['talk'] },
        { key: 'build', title: 'Build it', start: 11, days: 21, priority: 'High', after: ['scope'] },
        { key: 'page', title: 'Make a simple landing page', start: 20, days: 5 },
      ] },
      { title: 'Launch', tasks: [
        { key: 'beta', title: 'Get five people to try it', start: 32, days: 7, after: ['build'], target: [5, 'testers'] },
        { key: 'launch', title: 'Launch publicly', start: 42, days: 1, priority: 'High', after: ['beta', 'page'] },
      ] },
    ],
  },
  {
    id: 'move-home', icon: '🏡', color: '#1A7A4A', title: 'Move home',
    description: 'Viewings, paperwork, packing and the move itself, in the right order.',
    phases: [
      { title: 'Find a place', tasks: [
        { key: 'budget', title: 'Set my budget and must-haves', start: 0, days: 2, priority: 'High' },
        { key: 'view', title: 'Book and go to viewings', start: 2, days: 14, after: ['budget'], target: [6, 'viewings'] },
        { key: 'secure', title: 'Secure the new place', start: 16, days: 7, priority: 'High', after: ['view'] },
      ] },
      { title: 'Get ready', tasks: [
        { key: 'notice', title: 'Give notice on my current place', start: 23, days: 1, after: ['secure'] },
        { key: 'van', title: 'Book a van or removals', start: 24, days: 3, after: ['secure'] },
        { key: 'pack', title: 'Pack room by room', start: 28, days: 14, target: [8, 'rooms'] },
      ] },
      { title: 'Move', tasks: [
        { key: 'move', title: 'Moving day', start: 44, days: 1, priority: 'High', after: ['van', 'pack'] },
        { key: 'address', title: 'Update my address everywhere', start: 45, days: 7, after: ['move'] },
      ] },
    ],
  },
  {
    id: 'event', icon: '🎉', color: '#B03020', title: 'Plan an event',
    description: 'A celebration, meetup or fundraiser, from booking the venue to the day itself.',
    phases: [
      { title: 'Plan', tasks: [
        { key: 'brief', title: 'Decide the date, budget and guest list', start: 0, days: 3, priority: 'High' },
        { key: 'venue', title: 'Book the venue', start: 3, days: 7, priority: 'High', after: ['brief'] },
      ] },
      { title: 'Organise', tasks: [
        { key: 'invite', title: 'Send the invitations', start: 10, days: 3, after: ['venue'] },
        { key: 'rsvp', title: 'Collect RSVPs', start: 13, days: 14, after: ['invite'], target: [40, 'guests'] },
        { key: 'food', title: 'Arrange food and drink', start: 14, days: 7, after: ['venue'] },
      ] },
      { title: 'The day', tasks: [
        { key: 'run', title: 'Write the running order', start: 24, days: 3 },
        { key: 'day', title: 'Event day', start: 30, days: 1, priority: 'High', after: ['rsvp', 'food', 'run'] },
        { key: 'thanks', title: 'Send thank-you messages', start: 31, days: 3, after: ['day'] },
      ] },
    ],
  },
  {
    id: 'fitness', icon: '🏃', color: '#0D1B2A', title: 'Run my first 10K',
    description: 'Eight weeks from easy runs to race day, building up week by week.',
    phases: [
      { title: 'Start', tasks: [
        { key: 'race', title: 'Enter a 10K race', start: 0, days: 2, priority: 'High' },
        { key: 'shoes', title: 'Get fitted for running shoes', start: 1, days: 5 },
      ] },
      { title: 'Build up', tasks: [
        { key: 'base', title: 'Run three times a week', start: 3, days: 28, priority: 'High', target: [12, 'runs'] },
        { key: 'long', title: 'Reach a 7K long run', start: 31, days: 14, after: ['base'] },
      ] },
      { title: 'Race', tasks: [
        { key: 'taper', title: 'Taper the week before', start: 49, days: 6, after: ['long'] },
        { key: 'day', title: 'Race day', start: 56, days: 1, priority: 'High', after: ['race', 'taper'] },
      ] },
    ],
  },
];

const summary = t => ({
  id: t.id, icon: t.icon, color: t.color, title: t.title, description: t.description,
  phases: t.phases.length, tasks: t.phases.reduce((n, p) => n + p.tasks.length, 0),
  days: Math.max(...t.phases.flatMap(p => p.tasks.map(k => k.start + k.days))),
});
const listTemplates = () => TEMPLATES.map(summary);

const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Creates the whole plan in one transaction, so a failure leaves nothing
// half-made. Returns the new top-level project.
function createFromTemplate(userId, templateId, { startDate, title } = {}) {
  const template = TEMPLATES.find(t => t.id === templateId);
  if (!template) throw new Error('Template not found');
  const start = /^\d{4}-\d{2}-\d{2}$/.test(startDate || '') ? startDate : new Date().toISOString().slice(0, 10);
  const now = () => new Date().toISOString();
  return connection.transaction(() => {
    const goal = db.createProject(userId, { id: uuid(), createdAt: now(), title: (title || '').trim() || template.title, description: template.description, icon: template.icon, color: template.color, startDate: start });
    const ids = {};
    const waits = [];
    for (const phase of template.phases) {
      const folder = db.createProject(userId, { id: uuid(), createdAt: now(), parentId: goal.id, title: phase.title, icon: '📁', color: template.color, startDate: start });
      for (const t of phase.tasks) {
        const task = db.createTask(userId, {
          id: uuid(), createdAt: now(), projectId: folder.id, title: t.title, priority: t.priority || 'Medium',
          startDate: addDays(start, t.start), endDate: addDays(start, t.start + t.days - 1),
          ...(t.target ? { targetCount: t.target[0], targetUnit: t.target[1] } : {}),
        });
        ids[t.key] = task.id;
        if (t.after) waits.push([t.key, t.after]);
      }
    }
    for (const [key, after] of waits) db.setTaskPredecessors(userId, ids[key], after.map(k => ids[k]));
    return db.getProjectById(userId, goal.id);
  })();
}

module.exports = { TEMPLATES, listTemplates, createFromTemplate };
