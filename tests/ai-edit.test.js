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

test('the edit tool cannot express a deletion', () => {
  const types = EDIT_TOOL.input_schema.properties.operations.items.properties.type.enum;
  assert.deepEqual(types.sort(), ['addPhase', 'addTask', 'moveTask', 'renamePhase', 'updateTask']);
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
