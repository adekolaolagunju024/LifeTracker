const { test } = require('node:test');
const assert = require('node:assert/strict');
const fill = require('../backend/ai/fill');

// "Fill in for me" (backend/ai/fill.js): only what the form asked for comes
// back, of the right kind, and never a past date.
test('fill: fields are cleaned and the answer is held to them', () => {
  const fields = fill.cleanFields([
    { key: 'notes', label: 'Notes', type: 'longtext' },
    { key: 'priority', label: 'Priority', type: 'choice', options: ['High', 'Medium', 'Low'] },
    { key: 'due', label: 'Due date', type: 'date' },
    { key: 'steps', label: 'Checklist', type: 'list' },
    { key: 'bad key!', label: 'Odd', type: 'weird' },
    { key: 'nolabel', label: '' },
    { key: 'pick', label: 'Pick', type: 'choice' },
  ]);
  assert.deepEqual(fields.map(f => f.key), ['notes', 'priority', 'due', 'steps', 'badkey']);
  assert.equal(fields[4].type, 'text');

  const tool = fill.fillTool(fields);
  assert.equal(tool.name, 'fill_form');
  assert.deepEqual(tool.input_schema.properties.priority.enum, ['High', 'Medium', 'Low']);
  assert.equal(tool.input_schema.properties.steps.type, 'array');

  const out = fill.validate(fields, {
    notes: 'x'.repeat(2000), priority: 'Urgent', due: '2020-01-01', steps: ['Ring the surgery', '', 42], badkey: 'ok', extra: 'not asked for',
  }, '2026-10-14');
  assert.equal(out.notes.length, 1000);
  assert.equal(out.priority, undefined, 'only the offered choices');
  assert.equal(out.due, undefined, 'never a date in the past');
  assert.deepEqual(out.steps, ['Ring the surgery', '42']);
  assert.equal(out.extra, undefined);
  assert.equal(fill.validate(fields, { due: '2026-11-02' }, '2026-10-14').due, '2026-11-02');
  assert.match(fill.systemPrompt('2026-10-14', 'Ada'), /Never make up .*money/);
});
