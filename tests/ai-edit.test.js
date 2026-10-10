const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EDIT_TOOL, validateOperations } = require('../backend/ai/edit');

const index = {
  phaseIds: new Set(['goal', 'phase-1', 'phase-2']),
  subIds: new Set(['phase-1', 'phase-2']),
  phaseTitles: new Map([['goal', 'Goal'], ['phase-1', 'Phase 1'], ['phase-2', 'Phase 2']]),
  taskById: new Map([
    ['t-open', { id: 't-open', title: 'Open task', status: 'Not Started', projectId: 'phase-1' }],
    ['t-done', { id: 't-done', title: 'Done task', status: 'Completed', projectId: 'phase-1' }],
    ['t-goal', { id: 't-goal', title: 'Top-level task', status: 'In Progress', projectId: 'goal' }],
  ]),
  blockerById: new Map([
    ['b-open', { id: 'b-open', name: 'Supplier quote', count: 2, resolved: false, taskId: 't-open', taskTitle: 'Open task', taskStatus: 'Not Started' }],
    ['b-done', { id: 'b-done', name: 'Old snag', count: 1, resolved: false, taskId: 't-done', taskTitle: 'Done task', taskStatus: 'Completed' }],
  ]),
};

test('a task can be moved to another phase, with the phase title for review', () => {
  const { operations, dropped } = validateOperations([
    { type: 'moveTask', taskId: 't-open', phaseId: 'phase-2', reason: 'belongs later' },
  ], index);
  assert.equal(dropped, 0);
  assert.equal(operations[0].toPhaseTitle, 'Phase 2');
  assert.equal(operations[0].currentTitle, 'Open task');
});

test('moves are dropped for completed tasks, unknown phases, or a task already in that phase', () => {
  const { operations, dropped } = validateOperations([
    { type: 'moveTask', taskId: 't-done', phaseId: 'phase-2', reason: 'x' },
    { type: 'moveTask', taskId: 't-open', phaseId: 'nowhere', reason: 'x' },
    { type: 'moveTask', taskId: 't-open', phaseId: 'phase-1', reason: 'x' },
  ], index);
  assert.equal(operations.length, 0);
  assert.equal(dropped, 3);
});

test('the edit tool cannot express deleting a task or phase; the only removal is a blocker', () => {
  const types = EDIT_TOOL.input_schema.properties.operations.items.properties.type.enum;
  assert.deepEqual([...types].sort(), ['addBlocker', 'addPhase', 'addTask', 'moveTask', 'removeBlocker', 'renamePhase', 'updateBlocker', 'updateTask']);
});

test('an edit to an open task is kept, with its real title and only allowed fields', () => {
  const { operations, dropped } = validateOperations([
    { type: 'updateTask', taskId: 't-open', fields: { priority: 'High', endDate: '2026-12-01', bogus: 'x' }, reason: 'urgent' },
  ], index);
  assert.equal(dropped, 0);
  assert.equal(operations[0].currentTitle, 'Open task');
  assert.deepEqual(operations[0].fields, { priority: 'High', endDate: '2026-12-01' });
});

test('edits to completed tasks are dropped', () => {
  const { operations, dropped } = validateOperations([
    { type: 'updateTask', taskId: 't-done', fields: { priority: 'High' }, reason: 'x' },
  ], index);
  assert.equal(operations.length, 0);
  assert.equal(dropped, 1);
});

test('ids the plan does not contain are dropped', () => {
  const { operations, dropped } = validateOperations([
    { type: 'updateTask', taskId: 'made-up', fields: { priority: 'High' }, reason: 'x' },
    { type: 'addTask', phaseId: 'nowhere', task: { title: 'x' }, reason: 'x' },
    { type: 'renamePhase', phaseId: 'goal', title: 'Top level is not a phase', reason: 'x' },
  ], index);
  assert.equal(operations.length, 0);
  assert.equal(dropped, 3);
});

test('a field with an invalid date or priority is ignored, and an empty change is dropped', () => {
  const { operations, dropped } = validateOperations([
    { type: 'updateTask', taskId: 't-open', fields: { endDate: 'next week' }, reason: 'x' },
    { type: 'updateTask', taskId: 't-open', fields: { priority: 'Urgent' }, reason: 'x' },
  ], index);
  assert.equal(operations.length, 0);
  assert.equal(dropped, 2);
});

test('new tasks get safe defaults and are always created as Not Started', () => {
  const { operations } = validateOperations([
    { type: 'addTask', phaseId: 'phase-1', task: { title: 'Book a venue', status: 'Completed', priority: 'Urgent' }, reason: 'x' },
  ], index);
  assert.equal(operations[0].task.status, 'Not Started');
  assert.equal(operations[0].task.priority, 'Medium');
});

test('a new phase is kept when it has a title, and its tasks are sanitized', () => {
  const { operations } = validateOperations([
    { type: 'addPhase', title: 'Phase 3: Launch', tasks: [{ title: 'Ship it' }, { title: '   ' }], reason: 'x' },
  ], index);
  assert.equal(operations[0].title, 'Phase 3: Launch');
  assert.equal(operations[0].tasks.length, 1);
});

test('unknown operation types are dropped', () => {
  const { operations, dropped } = validateOperations([{ type: 'deleteTask', taskId: 't-open', reason: 'x' }], index);
  assert.equal(operations.length, 0);
  assert.equal(dropped, 1);
});

test('blockers can be added to an open task, with a sensible count', () => {
  const { operations, dropped } = validateOperations([
    { type: 'addBlocker', taskId: 't-open', blocker: { name: '  Waiting on the landlord  ', count: 3 }, reason: 'x' },
    { type: 'addBlocker', taskId: 't-goal', blocker: { name: 'Permit', count: 40 }, reason: 'x' },
    { type: 'addBlocker', taskId: 't-done', blocker: { name: 'Too late', count: 1 }, reason: 'x' },
    { type: 'addBlocker', taskId: 't-open', blocker: { name: '   ' }, reason: 'x' },
    { type: 'addBlocker', taskId: 'nope', blocker: { name: 'Ghost' }, reason: 'x' },
  ], index);
  assert.equal(dropped, 3, 'completed tasks, empty names and unknown tasks are dropped');
  assert.deepEqual(operations[0].blocker, { name: 'Waiting on the landlord', count: 3 });
  assert.equal(operations[0].taskTitle, 'Open task');
  assert.equal(operations[1].blocker.count, 1, 'an out-of-range count falls back to 1');
});

test('blockers can be renamed, recounted, ticked off or removed, only if they exist on an open task', () => {
  const { operations, dropped } = validateOperations([
    { type: 'updateBlocker', blockerId: 'b-open', blocker: { resolved: true }, reason: 'cleared' },
    { type: 'updateBlocker', blockerId: 'b-open', blocker: { name: 'Signed quote', count: 1 }, reason: 'x' },
    { type: 'updateBlocker', blockerId: 'b-open', blocker: { name: 'Supplier quote', count: 2 }, reason: 'no real change' },
    { type: 'removeBlocker', blockerId: 'b-open', reason: 'not an issue any more' },
    { type: 'removeBlocker', blockerId: 'b-done', reason: 'x' },
    { type: 'updateBlocker', blockerId: 'nope', blocker: { resolved: true }, reason: 'x' },
  ], index);
  assert.equal(dropped, 3);
  assert.deepEqual(operations.map(o => o.type), ['updateBlocker', 'updateBlocker', 'removeBlocker']);
  assert.deepEqual(operations[0].changes, { resolved: true });
  assert.deepEqual(operations[1].changes, { name: 'Signed quote', count: 1 });
  assert.equal(operations[2].currentName, 'Supplier quote');
});

test('the edit tool tells the model it can manage blockers but not delete tasks', () => {
  assert.ok(EDIT_TOOL.input_schema.properties.operations.items.properties.type.enum.includes('removeBlocker'));
  assert.match(EDIT_TOOL.description, /blockers/);
  assert.match(EDIT_TOOL.description, /may not delete tasks or phases/);
});
