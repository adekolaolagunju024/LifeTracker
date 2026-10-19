const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// The Help guides (frontend/js/help.js): every guide's button goes
// somewhere real, ids are unique, and the icons it draws exist.
const src = fs.readFileSync(path.join(__dirname, '../frontend/js/help.js'), 'utf8');
const { ICON_PATHS } = require('../frontend/js/icons.js');

test('every help guide has steps, a unique id and a destination the app knows', () => {
  const goBlock = src.slice(src.indexOf('const go = {'), src.indexOf('};', src.indexOf('const go = {')));
  const known = new Set([...goBlock.matchAll(/\n\s+([a-z_]+):/g)].map(m => m[1]));
  const guides = [...src.matchAll(/\n\s+\['([^']+)', '([a-z0-9-]+)', '([^']+)', \[([\s\S]*?)\], '([^']+)', '([a-z_]+)'\],/g)];
  assert.ok(guides.length >= 12, `found ${guides.length} guides`);
  const ids = guides.map(g => g[2]);
  assert.equal(new Set(ids).size, ids.length, 'guide ids are unique');
  for (const g of guides) {
    assert.ok(known.has(g[6]), `guide ${g[2]} goes to ${g[6]}`);
    assert.ok(g[4].trim().length > 20, `guide ${g[2]} has steps`);
  }
  // tips point at real guides
  for (const m of src.matchAll(/guide: '([a-z0-9-]+)'/g)) assert.ok(ids.includes(m[1]), `tip guide ${m[1]}`);
  for (const name of [...src.matchAll(/icon\('([a-z-]+)'/g)].map(m => m[1])) assert.ok(ICON_PATHS[name], `icon ${name}`);
});
