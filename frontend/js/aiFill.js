/* global API, icon, esc, showToast, syncSegs, APP_currentDetailTaskId */
// ── FILL IN FOR ME ──────────────────────────────────────────────
// A "Fill in for me" button for any form, for when you're too busy or
// can't be bothered: the assistant fills the empty fields from what you've
// already typed and what the form is about (backend/ai/fill.js). It only
// ever fills empty fields and never saves: you check it and save as usual.
// Each form describes its fields: { key, label, type, el, options?, hint?,
// get?, set? }, where type is text, longtext, date, number, choice or list.
const AIFill = (() => {
  let ready = null; // is the assistant set up on this server?
  const configured = () => (ready = ready || API.getAIStatus().then(s => !!(s && s.configured)).catch(() => false));

  const valueOf = f => {
    if (f.get) return f.get();
    const el = typeof f.el === 'string' ? document.querySelector(f.el) : f.el;
    return el ? el.value.trim() : '';
  };
  function put(f, v) {
    if (f.set) return f.set(v);
    const el = typeof f.el === 'string' ? document.querySelector(f.el) : f.el;
    if (!el) return;
    el.value = f.type === 'date' ? String(v).slice(0, 10) : v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.classList.add('ai-filled');
    setTimeout(() => el.classList.remove('ai-filled'), 2400);
  }

  // The button, for a form to place where it fits. spec: { form, fields,
  // context?: () => string, projectId?: () => id, taskId?: () => id,
  // label?, after?: (filledKeys) => void }
  const specs = new Map();
  let seq = 0;
  function button(spec, label = 'Fill in for me') {
    const id = `aif-${++seq}`;
    specs.set(id, spec);
    // shown once we know the assistant is set up
    configured().then(ok => { const b = document.getElementById(id); if (b) b.classList.toggle('hidden', !ok); });
    return `<button type="button" id="${id}" class="ai-fill-btn hidden" onclick="AIFill.run('${id}')" title="The assistant fills the empty fields. You check them before saving">${icon('sparkles', 'tiny')}<span>${esc(label)}</span></button>`;
  }
  // For a button already in the page: show it if the assistant is set up.
  function attach(btn, spec) {
    if (!btn) return;
    const id = btn.id || `aif-${++seq}`;
    btn.id = id;
    specs.set(id, spec);
    btn.onclick = () => run(id);
    configured().then(ok => btn.classList.toggle('hidden', !ok));
  }

  async function run(id) {
    const spec = specs.get(id);
    const btn = document.getElementById(id);
    if (!spec || !btn) return;
    const fields = spec.fields.filter(f => !f.when || f.when());
    const values = Object.fromEntries(fields.map(f => [f.key, valueOf(f)]));
    const empty = fields.filter(f => { const v = values[f.key]; return v == null || v === '' || (Array.isArray(v) && !v.length); });
    if (!empty.length) { showToast('Everything is filled in already. Clear a field to have it suggested'); return; }
    btn.disabled = true;
    btn.classList.add('busy');
    const label = btn.querySelector('span:last-of-type'); // the words, not the icon
    const was = label ? label.textContent : '';
    if (label) label.textContent = 'Filling in…';
    try {
      const out = await API.aiFill({
        form: spec.form,
        fields: fields.map(({ key, label, type, options, hint }) => ({ key, label, type, options, hint })),
        values, context: spec.context ? spec.context() : '',
        projectId: spec.projectId ? spec.projectId() : null, taskId: spec.taskId ? spec.taskId() : null,
      });
      const got = Object.entries(out.values || {}).filter(([k]) => empty.some(f => f.key === k));
      got.forEach(([k, v]) => put(fields.find(f => f.key === k), v));
      if (typeof syncSegs === 'function') syncSegs();
      if (spec.after) spec.after(got.map(([k]) => k));
      showToast(got.length ? `✨ Filled in ${got.length} ${got.length === 1 ? 'field' : 'fields'}. Check them, then save` : 'Nothing to add here. Give it a title or a few words first');
    } catch (e) {
      showToast(e.message || 'The assistant could not fill it in just now', 'error');
    } finally {
      btn.disabled = false;
      btn.classList.remove('busy');
      if (label) label.textContent = was;
    }
  }
  return { button, attach, run, configured };
})();
window.AIFill = AIFill;

// ── The forms that are always in the page ──
// A task: from its name (and the goal it's in), the notes, priority and dates.
AIFill.attach(document.getElementById('task-ai-fill'), {
  form: 'A task (one step towards a goal)',
  fields: [
    { key: 'title', label: 'Task name', type: 'text', el: '#task-title-in', hint: 'Short, starts with a verb' },
    { key: 'notes', label: 'Notes', type: 'longtext', el: '#task-notes', hint: 'Two or three practical sentences: what to do first, what done looks like, anything to remember' },
    { key: 'priority', label: 'Priority', type: 'choice', options: ['High', 'Medium', 'Low'], el: '#task-priority', get: () => (document.getElementById('task-id').value ? document.getElementById('task-priority').value : '') },
    { key: 'start', label: 'Start date', type: 'date', el: '#task-start' },
    { key: 'due', label: 'Due date', type: 'date', el: '#task-end', hint: 'After the start date, and realistic for the work' },
  ],
  projectId: () => document.getElementById('task-project').value || null,
  taskId: () => document.getElementById('task-id').value || null,
  context: () => { const sel = document.getElementById('task-project'); const o = sel && sel.selectedOptions[0]; return o ? `It's in the goal or folder: ${o.textContent.trim()}` : ''; },
});
// A goal or folder: from its name, the description, icon, area of life and start.
AIFill.attach(document.getElementById('proj-ai-fill'), {
  form: 'A goal (a project)',
  fields: [
    { key: 'title', label: 'Goal name', type: 'text', el: '#proj-title' },
    { key: 'description', label: 'Description', type: 'longtext', el: '#proj-desc', hint: 'One or two sentences on what done looks like' },
    { key: 'icon', label: 'Icon', type: 'choice', options: [...document.querySelectorAll('#modal-project .proj-icons button')].map(b => b.dataset.value), el: '#proj-icon', get: () => { const v = document.getElementById('proj-icon').value; return v === '📁' ? '' : v; } },
    { key: 'area', label: 'Area of life', type: 'choice', options: [...document.querySelectorAll('#modal-project .proj-types button')].map(b => b.dataset.value), el: '#proj-type', when: () => !document.getElementById('proj-type-wrap').classList.contains('hidden'), get: () => { const v = document.getElementById('proj-type').value; return v === 'career' && document.getElementById('proj-icon').value === '📁' ? '' : v; } },
    { key: 'start', label: 'Start date', type: 'date', el: '#proj-start' },
  ],
  projectId: () => document.getElementById('proj-id').value || document.getElementById('proj-parent').value || null,
});
// A status update on a task: why it's where it is.
AIFill.attach(document.getElementById('td-status-ai-fill'), {
  form: 'A short status update on a task: why it is still at its status, for the people working with them',
  fields: [{ key: 'update', label: 'Status update', type: 'text', el: '#td-status-update-input', hint: 'One sentence in the first person, e.g. what it is waiting on or what happens next' }],
  taskId: () => (typeof APP_currentDetailTaskId !== 'undefined' ? APP_currentDetailTaskId : null),
});
