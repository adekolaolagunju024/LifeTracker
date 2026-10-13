/* global icon, esc, emojiIcon */
// ── THE PROJECT PICKER ──────────────────────────────────────────
// A plain <select> can't show a project apart from its sub-folders: no
// headings, icons or indents. This lays a picker over one: a button with
// the chosen project, and a list where each project has its icon and
// colour, its sub-folders sit indented beneath it with a folder icon, and
// projects shared with you have their own section. The <select> stays the
// source of truth (hidden), so the code reading .value and its onchange
// work as before: picking here sets it and fires "change".
// Used by the Planner and Calendar filters and the task form
// (projectOptionsHTML in js/app/01-core.js fills the select).
const ProjectPicker = (() => {
  let open = null; // { sel, pop, btn }

  function attach(sel, projects) {
    if (!sel) return;
    sel._ppProjects = projects;
    if (!sel._ppBtn) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `pp-btn ${sel.className}`; // same size and place as the select it covers
      btn.setAttribute('aria-haspopup', 'listbox');
      btn.setAttribute('aria-expanded', 'false');
      if (sel.getAttribute('aria-label')) btn.setAttribute('aria-label', sel.getAttribute('aria-label'));
      btn.addEventListener('click', e => { e.stopPropagation(); if (open && open.sel === sel) close(); else show(sel); });
      btn.addEventListener('keydown', e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); show(sel); } });
      sel.insertAdjacentElement('afterend', btn);
      sel.classList.add('pp-native');
      sel.setAttribute('tabindex', '-1');
      sel.setAttribute('aria-hidden', 'true');
      sel._ppBtn = btn;
      // Code that sets .value and fires change (or the label it renders)
      // keeps the button in step.
      sel.addEventListener('change', () => paintButton(sel));
    }
    paintButton(sel);
  }

  const byId = sel => Object.fromEntries((sel._ppProjects || []).map(p => [p.id, p]));
  const badge = p => `<span class="pp-ic" style="background:${esc(p.color || '#0A7E8C')}22;color:${esc(p.color || '#0A7E8C')}">${p.icon ? emojiIcon(p.icon) : icon('folder')}</span>`;

  function paintButton(sel) {
    const btn = sel._ppBtn; if (!btn) return;
    const map = byId(sel);
    const p = map[sel.value];
    const parent = p && p.parentId && map[p.parentId];
    btn.innerHTML = p
      ? `${parent ? `<span class="pp-ic sub">${icon('folder')}</span>` : badge(p)}<span class="pp-label"><b>${esc(p.title)}</b>${parent ? `<small>in ${esc(parent.title)}</small>` : ''}</span>${icon('chevron_down', 'pp-chev')}`
      : `<span class="pp-ic all">${icon('layers')}</span><span class="pp-label"><b>${esc((sel.options[sel.selectedIndex] || {}).text || 'All Projects')}</b></span>${icon('chevron_down', 'pp-chev')}`;
    btn.title = p ? (parent ? `${p.title}, a sub-folder of ${parent.title}` : p.title) : '';
  }

  function rows(sel, q) {
    const map = byId(sel);
    const all = [...sel.options].find(o => o.value === '' && !o.hidden && !o.disabled);
    const list = sel._ppProjects || [];
    const ids = new Set(list.map(p => p.id));
    const tops = list.filter(p => !p.parentId || !ids.has(p.parentId));
    const match = p => !q || p.title.toLowerCase().includes(q);
    const row = (p, sub) => `<li role="option" id="pp-${p.id}" data-value="${p.id}" aria-selected="${sel.value === p.id}" class="pp-row ${sub ? 'sub' : 'top'}">
        ${sub ? `<span class="pp-ic sub">${icon('folder')}</span>` : badge(p)}
        <span class="pp-label"><b>${esc(p.title)}</b>${!sub && p.role && p.role !== 'owner' && p.ownerName ? `<small>from ${esc(p.ownerName)}</small>` : ''}</span>
        ${sel.value === p.id ? icon('check', 'pp-tick') : ''}</li>`;
    const block = t => {
      const kids = list.filter(k => k.parentId === t.id);
      const shownKids = kids.filter(k => match(k) || match(t));
      if (!match(t) && !shownKids.length) return '';
      return `<li class="pp-group" role="presentation"><ul role="group" aria-label="${esc(t.title)}">${row(t, false)}${shownKids.map(k => row(k, true)).join('')}</ul></li>`;
    };
    const mine = tops.filter(p => !p.role || p.role === 'owner').map(block).join('');
    const shared = tops.filter(p => p.role && p.role !== 'owner').map(block).join('');
    const head = t => `<li class="pp-head" role="presentation">${t}</li>`;
    const allRow = all && !q ? `<li role="option" id="pp-all" data-value="" aria-selected="${sel.value === ''}" class="pp-row top"><span class="pp-ic all">${icon('layers')}</span><span class="pp-label"><b>${esc(all.text)}</b><small>Every project and sub-folder</small></span>${sel.value === '' ? icon('check', 'pp-tick') : ''}</li>` : '';
    const body = allRow + (mine && shared ? head('Your projects') : '') + mine + (shared ? head('Shared with you') + shared : '');
    return body || '<li class="pp-empty" role="presentation">No project matches that</li>';
  }

  function show(sel) {
    close();
    const btn = sel._ppBtn;
    const pop = document.createElement('div');
    pop.className = 'pp-pop';
    const many = (sel._ppProjects || []).length > 7;
    pop.innerHTML = `${many ? `<div class="pp-search">${icon('search', 'tiny')}<input type="text" placeholder="Find a project" aria-label="Find a project"></div>` : ''}<ul class="pp-list" role="listbox" tabindex="-1" aria-label="${esc(sel.getAttribute('aria-label') || 'Project')}">${rows(sel, '')}</ul>`;
    document.body.appendChild(pop);
    place(pop, btn);
    btn.setAttribute('aria-expanded', 'true');
    open = { sel, pop, btn };
    const list = pop.querySelector('.pp-list');
    const input = pop.querySelector('input');
    list.addEventListener('click', e => { const li = e.target.closest('[role="option"]'); if (li) choose(li.dataset.value); });
    list.addEventListener('mousemove', e => { const li = e.target.closest('[role="option"]'); if (li) focusRow(li); });
    if (input) input.addEventListener('input', () => { list.innerHTML = rows(sel, input.value.trim().toLowerCase()); focusRow(list.querySelector('[role="option"]')); });
    pop.addEventListener('keydown', onKey);
    focusRow(list.querySelector('[aria-selected="true"]') || list.querySelector('[role="option"]'));
    (input || list).focus();
  }
  function place(pop, btn) {
    if (window.innerWidth < 640) { pop.classList.add('sheet'); return; } // a sheet from the bottom on a phone
    const r = btn.getBoundingClientRect();
    const w = Math.max(r.width, 280);
    pop.style.width = `${w}px`;
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
    const below = window.innerHeight - r.bottom;
    if (below < 260 && r.top > below) { pop.style.bottom = `${window.innerHeight - r.top + 6}px`; pop.style.maxHeight = `${r.top - 16}px`; }
    else { pop.style.top = `${r.bottom + 6}px`; pop.style.maxHeight = `${below - 16}px`; }
  }
  function focusRow(li) {
    if (!open || !li) return;
    open.pop.querySelectorAll('.pp-row.active').forEach(x => x.classList.remove('active'));
    li.classList.add('active');
    open.pop.querySelector('.pp-list').setAttribute('aria-activedescendant', li.id);
    li.scrollIntoView({ block: 'nearest' });
  }
  function onKey(e) {
    const opts = [...open.pop.querySelectorAll('[role="option"]')];
    const cur = opts.indexOf(open.pop.querySelector('.pp-row.active'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); focusRow(opts[Math.max(0, Math.min(opts.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)))]); }
    else if (e.key === 'Enter') { e.preventDefault(); if (opts[cur]) choose(opts[cur].dataset.value); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); const b = open.btn; close(); b.focus(); }
  }
  function choose(value) {
    const { sel, btn } = open;
    close();
    btn.focus();
    if (sel.value === value) return;
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function close() {
    if (!open) return;
    open.btn.setAttribute('aria-expanded', 'false');
    open.pop.remove();
    open = null;
  }
  document.addEventListener('click', e => { if (open && !open.pop.contains(e.target)) close(); });
  window.addEventListener('resize', close);
  document.addEventListener('scroll', e => { if (open && !open.pop.contains(e.target)) close(); }, true);

  return { attach, close };
})();
window.ProjectPicker = ProjectPicker;
