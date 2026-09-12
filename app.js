// ═══════════════════════════════════════════════════════════════
// APP.JS — Frontend Logic Layer
// All UI rendering, interactions, modals, Gantt, filters
// ═══════════════════════════════════════════════════════════════

// ── STATE ──────────────────────────────────────────────────────
const APP = {
  currentPage: 'dashboard',
  currentProjectId: null,
  filters: { status:'', priority:'', category:'', search:'' },
  ganttStart: new Date('2026-05-01'),
  ganttEnd: new Date('2027-05-31'),
};

// ── UTILS ──────────────────────────────────────────────────────
const fmt = n => {
  const profile = DB.getProfile();
  return (profile.currency||'£') + Math.round(n).toLocaleString();
};
const pct = (a,b) => b>0 ? Math.min(Math.round(a/b*100),100) : 0;
const uid = () => '_'+Math.random().toString(36).substr(2,9);
const esc = s => String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;');

const STATUS_BADGE = {
  'Completed':  ['#E6F5EE','#1A7A4A'],
  'In Progress':['#FEF0E6','#C0642A'],
  'Not Started':['#F3F4F6','#6B7280'],
};
const PRIORITY_BADGE = {
  'High':  ['#FEE2E2','#B03020'],
  'Medium':['#FFFDE7','#B8860B'],
  'Low':   ['#E6F5EE','#1A7A4A'],
};

function badge(text, colors) {
  if(!colors) return `<span style="background:#F3F4F6;color:#6B7280;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600">${esc(text)}</span>`;
  return `<span style="background:${colors[0]};color:${colors[1]};padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600">${esc(text)}</span>`;
}

function showToast(msg, type='success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = type==='error'?'#B03020':'#0D1B2A';
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2800);
}

function confirm_action(msg, cb) {
  if(window.confirm(msg)) cb();
}

// ── NAVIGATION ────────────────────────────────────────────────
function showPage(id, projectId=null) {
  APP.currentPage = id;
  APP.currentProjectId = projectId;
  APP.filters = { status:'', priority:'', category:'', search:'' };

  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));

  const pg = document.getElementById('page-'+id);
  if(pg) pg.classList.add('active');

  const navEl = document.querySelector(`[data-page="${id}"]`);
  if(navEl) navEl.classList.add('active');

  const titles = {
    dashboard:'Dashboard', projects:'Projects',
    gantt:'Gantt Chart', wealth:'Wealth Tracker',
    actions:'Actions', settings:'Settings'
  };

  document.getElementById('topbar-title').textContent =
    projectId ? (DB.getProject(projectId)?.title||'Project') : (titles[id]||id);

  // Render relevant page
  if(id==='dashboard')  renderDashboard();
  if(id==='projects')   renderProjects();
  if(id==='project-detail') renderProjectDetail(projectId);
  if(id==='gantt')      renderGantt();
  if(id==='wealth')     renderWealth();
  if(id==='actions')    renderActions();
  if(id==='settings')   renderSettings();

  updateSidebar();
}

// ── SIDEBAR ───────────────────────────────────────────────────
function updateSidebar() {
  const stats = DB.getStats();
  const nw = stats.netWorth;
  const target = stats.targetNetWorth;
  const p = DB.getProfile();

  document.getElementById('sidebar-name').textContent = p.name;
  document.getElementById('sidebar-nw').textContent = fmt(nw);
  document.getElementById('sidebar-prog').style.width = pct(nw,target)+'%';
  document.getElementById('sidebar-sub').textContent = fmt(nw)+' of '+fmt(target);

  // Rebuild project nav items
  const projectNav = document.getElementById('project-nav');
  projectNav.innerHTML = DB.getProjects().map(p => `
    <button class="nav-item ${APP.currentProjectId===p.id?'active':''}"
      data-page="project-detail"
      onclick="showPage('project-detail','${p.id}')"
      style="--proj-color:${p.color}">
      <span class="icon">${p.icon}</span>
      <span style="flex:1;text-align:left">${esc(p.title)}</span>
    </button>`).join('');
}

// ── DASHBOARD ─────────────────────────────────────────────────
function renderDashboard() {
  const stats = DB.getStats();
  const profile = DB.getProfile();
  const nw = stats.netWorth;
  const target = stats.targetNetWorth;
  const p = pct(nw, target);

  // KPI cards
  document.getElementById('kpi-total').textContent   = stats.total;
  document.getElementById('kpi-done').textContent    = stats.completed;
  document.getElementById('kpi-inprog').textContent  = stats.inProgress;
  document.getElementById('kpi-nw').textContent      = fmt(nw);

  // Hero
  document.getElementById('hero-nw').textContent = fmt(nw);
  document.getElementById('hero-pct').textContent = p+'%';
  document.getElementById('hero-prog').style.width = p+'%';
  document.getElementById('hero-left').textContent = fmt(Math.max(0,target-nw))+' to go · Target: '+fmt(target);
  document.getElementById('hero-name').textContent = profile.name.split(' ')[0];

  // Per-project stats
  const projects = DB.getProjects();
  document.getElementById('project-stats').innerHTML = projects.map(proj => {
    const tasks = DB.getTasks({projectId:proj.id});
    const done = tasks.filter(t=>t.status==='Completed').length;
    const tot = tasks.length;
    const pp = pct(done,tot);
    return `<div class="proj-stat-card" onclick="showPage('project-detail','${proj.id}')">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <span style="font-size:20px">${proj.icon}</span>
        <div>
          <div style="font-weight:700;font-size:13px;color:#0D1B2A">${esc(proj.title)}</div>
          <div style="font-size:11px;color:#6B7280">${tot} tasks · ${done} done</div>
        </div>
      </div>
      <div style="height:6px;background:#E5E7EB;border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pp}%;background:${proj.color};border-radius:3px;transition:width .4s"></div>
      </div>
      <div style="font-size:11px;color:#6B7280;margin-top:5px;text-align:right">${pp}% complete</div>
    </div>`;
  }).join('');

  // Urgent tasks
  const urgent = DB.getTasks({status:'In Progress'})
    .filter(t=>t.priority==='High').slice(0,6);
  document.getElementById('urgent-tasks').innerHTML = urgent.length
    ? urgent.map(t => {
        const proj = DB.getProject(t.projectId);
        return `<tr>
          <td><span style="font-size:16px">${proj?.icon||'📌'}</span></td>
          <td style="font-weight:500">${esc(t.title)}</td>
          <td style="font-size:12px;color:#6B7280">${proj?.title||''}</td>
          <td style="white-space:nowrap;font-size:12px">${t.endDate||'—'}</td>
          <td>${badge(t.status, STATUS_BADGE[t.status])}</td>
        </tr>`;}).join('')
    : `<tr><td colspan="5" style="text-align:center;padding:20px;color:#9CA3AF">No urgent tasks in progress</td></tr>`;
}

// ── PROJECTS LIST ──────────────────────────────────────────────
function renderProjects() {
  const projects = DB.getProjects();
  document.getElementById('projects-grid').innerHTML = projects.map(proj => {
    const tasks = DB.getTasks({projectId:proj.id});
    const done = tasks.filter(t=>t.status==='Completed').length;
    const inp  = tasks.filter(t=>t.status==='In Progress').length;
    const tot  = tasks.length;
    const pp   = pct(done,tot);
    const totalCost = tasks.reduce((s,t)=>s+(t.cost||0),0);
    return `
    <div class="project-card" style="--proj-color:${proj.color}">
      <div class="project-card-header">
        <span style="font-size:28px">${proj.icon}</span>
        <div class="project-card-actions">
          <button class="icon-btn" onclick="event.stopPropagation();editProject('${proj.id}')" title="Edit">✏️</button>
          <button class="icon-btn" onclick="event.stopPropagation();deleteProjectConfirm('${proj.id}')" title="Delete">🗑️</button>
        </div>
      </div>
      <h3 onclick="showPage('project-detail','${proj.id}')" style="cursor:pointer">${esc(proj.title)}</h3>
      <p style="font-size:12px;color:#6B7280;margin:4px 0 14px">${esc(proj.description)}</p>
      <div style="display:flex;gap:12px;margin-bottom:12px">
        <div class="stat-pill">${tot} tasks</div>
        <div class="stat-pill" style="background:#E6F5EE;color:#1A7A4A">${done} done</div>
        <div class="stat-pill" style="background:#FEF0E6;color:#C0642A">${inp} active</div>
      </div>
      <div style="height:6px;background:#E5E7EB;border-radius:3px;overflow:hidden;margin-bottom:6px">
        <div style="height:100%;width:${pp}%;background:${proj.color};border-radius:3px;transition:width .4s"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#9CA3AF">
        <span>${pp}% complete</span>
        <span>Est. cost: ${fmt(totalCost)}</span>
      </div>
      <button class="btn-primary" style="margin-top:14px;width:100%;background:${proj.color}" onclick="showPage('project-detail','${proj.id}')">
        Open Project →
      </button>
    </div>`;
  }).join('');
}

// ── PROJECT DETAIL ─────────────────────────────────────────────
function renderProjectDetail(projectId) {
  const proj = DB.getProject(projectId);
  if(!proj) return;

  // Header
  document.getElementById('detail-icon').textContent = proj.icon;
  document.getElementById('detail-title').textContent = proj.title;
  document.getElementById('detail-desc').textContent = proj.description;
  document.getElementById('detail-color').style.background = proj.color;

  // Category filter options
  const cats = DB.getCategories(projectId);
  const catFilter = document.getElementById('filter-category');
  catFilter.innerHTML = '<option value="">All Categories</option>' +
    cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');

  renderTaskTable(projectId);
}

function renderTaskTable(projectId) {
  const tasks = DB.getTasks({
    projectId,
    status:   APP.filters.status   || undefined,
    priority: APP.filters.priority || undefined,
    category: APP.filters.category || undefined,
    search:   APP.filters.search   || undefined,
  });

  const stats = {
    total: tasks.length,
    done:  tasks.filter(t=>t.status==='Completed').length,
    inp:   tasks.filter(t=>t.status==='In Progress').length,
    cost:  tasks.reduce((s,t)=>s+(t.cost||0),0),
  };

  document.getElementById('detail-stats').innerHTML = `
    <div class="mini-kpi"><div class="mk-val">${stats.total}</div><div class="mk-lab">Tasks</div></div>
    <div class="mini-kpi"><div class="mk-val" style="color:#1A7A4A">${stats.done}</div><div class="mk-lab">Done</div></div>
    <div class="mini-kpi"><div class="mk-val" style="color:#C0642A">${stats.inp}</div><div class="mk-lab">Active</div></div>
    <div class="mini-kpi"><div class="mk-val" style="color:#B8860B">${fmt(stats.cost)}</div><div class="mk-lab">Est. Cost</div></div>`;

  document.getElementById('task-table-body').innerHTML = tasks.length
    ? tasks.map(t => `
      <tr>
        <td style="font-weight:600;max-width:240px">${esc(t.title)}</td>
        <td><span style="font-size:11px;background:#F3F4F6;padding:2px 8px;border-radius:12px">${esc(t.category||'—')}</span></td>
        <td>
          <select class="inline-select" onchange="DB.updateTask('${t.id}',{status:this.value});renderTaskTable('${projectId}');updateSidebar();renderDashboard();">
            ${['Not Started','In Progress','Completed'].map(s=>`<option ${t.status===s?'selected':''} style="background:${STATUS_BADGE[s]?.[0]||'#fff'}">${s}</option>`).join('')}
          </select>
        </td>
        <td>
          <select class="inline-select" onchange="DB.updateTask('${t.id}',{priority:this.value});renderTaskTable('${projectId}');">
            ${['High','Medium','Low'].map(p=>`<option ${t.priority===p?'selected':''}>${p}</option>`).join('')}
          </select>
        </td>
        <td style="font-size:12px;color:#6B7280;white-space:nowrap">${t.startDate||'—'}</td>
        <td style="font-size:12px;color:#6B7280;white-space:nowrap">${t.endDate||'—'}</td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:12px;color:${(t.cost||0)>0?'#1A7A4A':'#9CA3AF'}">${(t.cost||0)>0?fmt(t.cost):'—'}</td>
        <td>
          <div style="display:flex;gap:4px">
            <button class="icon-btn" onclick="editTask('${t.id}')" title="Edit">✏️</button>
            <button class="icon-btn" onclick="deleteTaskConfirm('${t.id}','${projectId}')" title="Delete">🗑️</button>
          </div>
        </td>
      </tr>`).join('')
    : `<tr><td colspan="8" style="text-align:center;padding:30px;color:#9CA3AF">No tasks match your filters. <a href="#" onclick="clearFilters('${projectId}')">Clear filters</a> or add a new task.</td></tr>`;
}

function clearFilters(projectId) {
  APP.filters = { status:'', priority:'', category:'', search:'' };
  document.getElementById('filter-status').value = '';
  document.getElementById('filter-priority').value = '';
  document.getElementById('filter-category').value = '';
  document.getElementById('filter-search').value = '';
  renderTaskTable(projectId);
}

function applyFilters(projectId) {
  APP.filters.status   = document.getElementById('filter-status').value;
  APP.filters.priority = document.getElementById('filter-priority').value;
  APP.filters.category = document.getElementById('filter-category').value;
  APP.filters.search   = document.getElementById('filter-search').value;
  renderTaskTable(projectId);
}

// ── GANTT CHART ────────────────────────────────────────────────
function renderGantt() {
  const projects = DB.getProjects();
  const start = APP.ganttStart;
  const end   = APP.ganttEnd;
  const totalDays = Math.ceil((end-start)/86400000);

  // Build month headers
  const months = [];
  let cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while(cur <= end) {
    months.push(new Date(cur));
    cur.setMonth(cur.getMonth()+1);
  }

  const monthHeaderHTML = months.map(m => {
    const days = new Date(m.getFullYear(), m.getMonth()+1, 0).getDate();
    const widthPct = (days / totalDays) * 100;
    return `<div class="gantt-month" style="width:${widthPct}%">${m.toLocaleString('default',{month:'short'})} '${String(m.getFullYear()).slice(2)}</div>`;
  }).join('');

  // Today line position
  const today = new Date();
  const todayPct = Math.max(0,Math.min(100, ((today-start)/86400000/totalDays)*100));

  // Build rows
  let rowsHTML = '';
  projects.forEach(proj => {
    const tasks = DB.getTasks({projectId: proj.id});
    if(!tasks.length) return;

    rowsHTML += `<div class="gantt-group-label">
      <div class="gantt-label-cell" style="color:${proj.color};font-weight:700">${proj.icon} ${esc(proj.title)}</div>
      <div class="gantt-bar-area" style="position:relative">
        <div class="today-line" style="left:${todayPct}%"></div>
      </div>
    </div>`;

    tasks.forEach(t => {
      const ts = t.startDate ? new Date(t.startDate) : null;
      const te = t.endDate   ? new Date(t.endDate)   : null;
      let barLeft = 0, barWidth = 0;
      if(ts && te) {
        barLeft  = Math.max(0, ((ts-start)/86400000/totalDays)*100);
        barWidth = Math.min(100-barLeft, ((te-ts)/86400000/totalDays)*100 + 0.5);
        barWidth = Math.max(barWidth, 0.5);
      }

      const statusColor = {
        'Completed':  '#1A7A4A',
        'In Progress': proj.color,
        'Not Started': '#9CA3AF',
      }[t.status] || '#9CA3AF';

      rowsHTML += `<div class="gantt-row">
        <div class="gantt-label-cell">
          <span style="font-size:12px;color:#374151;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(t.title)}">${esc(t.title)}</span>
          ${badge(t.status, STATUS_BADGE[t.status])}
        </div>
        <div class="gantt-bar-area">
          <div class="today-line" style="left:${todayPct}%"></div>
          ${(ts&&te) ? `<div class="gantt-bar" style="left:${barLeft}%;width:${barWidth}%;background:${statusColor}" title="${esc(t.title)}: ${t.startDate} → ${t.endDate}">
            <span class="gantt-bar-label">${esc(t.title)}</span>
          </div>` : ''}
        </div>
      </div>`;
    });
  });

  document.getElementById('gantt-months').innerHTML = monthHeaderHTML;
  document.getElementById('gantt-rows').innerHTML = rowsHTML;

  // Legend
  document.getElementById('gantt-legend').innerHTML = `
    <div style="display:flex;gap:16px;align-items:center;font-size:12px;color:#6B7280">
      <span><span style="display:inline-block;width:14px;height:8px;background:#1A7A4A;border-radius:3px;margin-right:4px"></span>Completed</span>
      <span><span style="display:inline-block;width:14px;height:8px;background:#0A7E8C;border-radius:3px;margin-right:4px"></span>In Progress</span>
      <span><span style="display:inline-block;width:14px;height:8px;background:#9CA3AF;border-radius:3px;margin-right:4px"></span>Not Started</span>
      <span><span style="display:inline-block;width:2px;height:14px;background:#EF4444;border-radius:1px;margin-right:4px;vertical-align:middle"></span>Today</span>
    </div>`;
}

// ── WEALTH ────────────────────────────────────────────────────
function renderWealth() {
  const entries  = DB.getWealthEntries();
  const targets  = DB.getWealthTargets();
  const total    = DB.getTotalNetWorth();
  const targetNW = DB.getProfile().targetNetWorth;
  const p        = pct(total, targetNW);

  document.getElementById('wealth-total').textContent = fmt(total);
  document.getElementById('wealth-pct').textContent   = p+'%';
  document.getElementById('wealth-prog').style.width  = p+'%';
  document.getElementById('wealth-left').textContent  = fmt(Math.max(0,targetNW-total))+' to go';

  document.getElementById('wealth-cards').innerHTML = Object.entries(targets).map(([key, wt]) => {
    const val = parseFloat(entries[key])||0;
    const pp  = pct(val, wt.target);
    return `<div class="wealth-card">
      <h4>${wt.label}</h4>
      <div class="input-row">
        <label>Current (${DB.getProfile().currency||'£'})</label>
        <input type="number" min="0" placeholder="0" value="${val||''}"
          oninput="DB.updateWealthEntry('${key}',this.value);updateWealthTotals()">
      </div>
      <div class="input-row">
        <label>Target</label>
        <span style="font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:#1A7A4A">${fmt(wt.target)}</span>
      </div>
      <div style="height:6px;background:#E5E7EB;border-radius:3px;overflow:hidden;margin-top:8px">
        <div style="height:100%;width:${pp}%;background:${pp>=100?'#1A7A4A':pp>50?'#0A7E8C':'#D4AC0D'};transition:width .3s;border-radius:3px"></div>
      </div>
      <div style="text-align:right;font-size:11px;color:#9CA3AF;margin-top:4px">${pp}%</div>
    </div>`;
  }).join('');

  // Monthly log table
  renderMonthlyLog();
}

function updateWealthTotals() {
  const total    = DB.getTotalNetWorth();
  const targetNW = DB.getProfile().targetNetWorth;
  const p        = pct(total, targetNW);
  document.getElementById('wealth-total').textContent = fmt(total);
  document.getElementById('wealth-pct').textContent   = p+'%';
  document.getElementById('wealth-prog').style.width  = p+'%';
  document.getElementById('wealth-left').textContent  = fmt(Math.max(0,targetNW-total))+' to go';
  updateSidebar();
}

function renderMonthlyLog() {
  const log = DB.getMonthlyLog();
  document.getElementById('monthly-log').innerHTML = log.length
    ? log.map(e=>`<tr>
        <td style="font-size:12px;color:#6B7280;white-space:nowrap">${e.month||new Date(e.date).toLocaleDateString('en-GB',{month:'short',year:'numeric'})}</td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:600">${fmt(e.income||0)}</td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:600;color:#C0642A">${fmt(e.business||0)}</td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:12px">${fmt(e.expenses||0)}</td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;color:#1A7A4A">${fmt(e.saved||0)}</td>
        <td style="font-size:12px;color:#6B7280">${esc(e.notes||'')}</td>
        <td><button class="icon-btn" onclick="DB.deleteMonthlyEntry('${e.id}');renderMonthlyLog()">🗑️</button></td>
      </tr>`).join('')
    : `<tr><td colspan="7" style="text-align:center;padding:20px;color:#9CA3AF">No entries yet. Log your first month above.</td></tr>`;
}

// ── ACTIONS ───────────────────────────────────────────────────
function renderActions() {
  const actions = DB.getActions();
  const done = actions.filter(a=>a.done).length;
  document.getElementById('act-total').textContent = actions.length;
  document.getElementById('act-done').textContent  = done;
  document.getElementById('act-rem').textContent   = actions.length - done;

  const PRI = {'Do Now':'#FEE2E2|#B03020','High':'#FEF0E6|#C0642A','Medium':'#FFFDE7|#B8860B','Low':'#E6F5EE|#1A7A4A'};
  document.getElementById('action-list').innerHTML = actions.map(a => {
    const [bg,fg] = (PRI[a.priority]||'#F3F4F6|#6B7280').split('|');
    return `<div class="action-item ${a.done?'done':''}">
      <div class="action-check ${a.done?'checked':''}" onclick="DB.toggleAction('${a.id}');renderActions()"></div>
      <div class="action-text">
        <h5>${esc(a.text)}</h5>
        <p>${esc(a.area)} · By ${esc(a.by)}</p>
      </div>
      <span style="background:${bg};color:${fg};padding:3px 9px;border-radius:20px;font-size:10px;font-weight:700;white-space:nowrap">${esc(a.priority)}</span>
      <button class="icon-btn" onclick="DB.deleteAction('${a.id}');renderActions()">🗑️</button>
    </div>`;
  }).join('');
}

// ── SETTINGS ──────────────────────────────────────────────────
function renderSettings() {
  const p = DB.getProfile();
  document.getElementById('set-name').value     = p.name;
  document.getElementById('set-tagline').value  = p.tagline;
  document.getElementById('set-currency').value = p.currency||'£';
  document.getElementById('set-target').value   = p.targetNetWorth;
  document.getElementById('set-date').value     = p.targetDate;
}

function saveSettings() {
  DB.updateProfile({
    name:          document.getElementById('set-name').value,
    tagline:       document.getElementById('set-tagline').value,
    currency:      document.getElementById('set-currency').value,
    targetNetWorth:parseFloat(document.getElementById('set-target').value)||100000,
    targetDate:    document.getElementById('set-date').value,
  });
  document.getElementById('sidebar-tagline').textContent = DB.getProfile().tagline;
  updateSidebar();
  showToast('✅ Settings saved!');
}

// ── MODALS ────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// PROJECT MODAL
function openAddProject() {
  document.getElementById('modal-project-title').textContent = 'New Project';
  document.getElementById('proj-id').value    = '';
  document.getElementById('proj-title').value = '';
  document.getElementById('proj-desc').value  = '';
  document.getElementById('proj-icon').value  = '📁';
  document.getElementById('proj-color').value = '#0A7E8C';
  openModal('modal-project');
}

function editProject(id) {
  const p = DB.getProject(id);
  if(!p) return;
  document.getElementById('modal-project-title').textContent = 'Edit Project';
  document.getElementById('proj-id').value    = id;
  document.getElementById('proj-title').value = p.title;
  document.getElementById('proj-desc').value  = p.description;
  document.getElementById('proj-icon').value  = p.icon;
  document.getElementById('proj-color').value = p.color;
  openModal('modal-project');
}

function saveProject() {
  const id    = document.getElementById('proj-id').value;
  const data  = {
    title:       document.getElementById('proj-title').value.trim(),
    description: document.getElementById('proj-desc').value.trim(),
    icon:        document.getElementById('proj-icon').value.trim()||'📁',
    color:       document.getElementById('proj-color').value,
  };
  if(!data.title) { showToast('Project title is required','error'); return; }
  if(id) { DB.updateProject(id, data); showToast('✅ Project updated'); }
  else   { DB.addProject(data);        showToast('✅ Project created'); }
  closeModal('modal-project');
  renderProjects(); updateSidebar();
}

function deleteProjectConfirm(id) {
  const p = DB.getProject(id);
  confirm_action(`Delete "${p?.title}"? All its tasks will be deleted too.`, () => {
    DB.deleteProject(id);
    showToast('🗑️ Project deleted');
    renderProjects(); updateSidebar();
  });
}

// TASK MODAL
function openAddTask(projectId) {
  document.getElementById('modal-task-title').textContent = 'New Task';
  document.getElementById('task-id').value         = '';
  document.getElementById('task-project').value    = projectId || (DB.getProjects()[0]?.id||'');
  document.getElementById('task-title-in').value   = '';
  document.getElementById('task-category').value   = '';
  document.getElementById('task-status').value     = 'Not Started';
  document.getElementById('task-priority').value   = 'High';
  document.getElementById('task-start').value      = '';
  document.getElementById('task-end').value        = '';
  document.getElementById('task-cost').value       = '';
  document.getElementById('task-notes').value      = '';
  populateTaskProjectSelect();
  openModal('modal-task');
}

function editTask(id) {
  const t = DB.getTask(id);
  if(!t) return;
  document.getElementById('modal-task-title').textContent = 'Edit Task';
  document.getElementById('task-id').value         = id;
  document.getElementById('task-project').value    = t.projectId;
  document.getElementById('task-title-in').value   = t.title;
  document.getElementById('task-category').value   = t.category||'';
  document.getElementById('task-status').value     = t.status;
  document.getElementById('task-priority').value   = t.priority;
  document.getElementById('task-start').value      = t.startDate||'';
  document.getElementById('task-end').value        = t.endDate||'';
  document.getElementById('task-cost').value       = t.cost||'';
  document.getElementById('task-notes').value      = t.notes||'';
  populateTaskProjectSelect();
  openModal('modal-task');
}

function populateTaskProjectSelect() {
  document.getElementById('task-project').innerHTML =
    DB.getProjects().map(p=>`<option value="${p.id}">${p.icon} ${esc(p.title)}</option>`).join('');
  if(APP.currentProjectId) document.getElementById('task-project').value = APP.currentProjectId;
}

function saveTask() {
  const id   = document.getElementById('task-id').value;
  const data = {
    projectId: document.getElementById('task-project').value,
    title:     document.getElementById('task-title-in').value.trim(),
    category:  document.getElementById('task-category').value.trim(),
    status:    document.getElementById('task-status').value,
    priority:  document.getElementById('task-priority').value,
    startDate: document.getElementById('task-start').value,
    endDate:   document.getElementById('task-end').value,
    cost:      parseFloat(document.getElementById('task-cost').value)||0,
    notes:     document.getElementById('task-notes').value.trim(),
  };
  if(!data.title)     { showToast('Task title is required','error'); return; }
  if(!data.projectId) { showToast('Please select a project','error'); return; }
  if(id) { DB.updateTask(id, data); showToast('✅ Task updated'); }
  else   { DB.addTask(data);        showToast('✅ Task added'); }
  closeModal('modal-task');
  if(APP.currentProjectId) renderTaskTable(APP.currentProjectId);
  renderDashboard(); updateSidebar(); renderGantt();
}

function deleteTaskConfirm(id, projectId) {
  const t = DB.getTask(id);
  confirm_action(`Delete "${t?.title}"?`, () => {
    DB.deleteTask(id);
    showToast('🗑️ Task deleted');
    renderTaskTable(projectId);
    updateSidebar();
  });
}

// ACTION MODAL
function openAddAction() {
  document.getElementById('act-text').value     = '';
  document.getElementById('act-area').value     = '';
  document.getElementById('act-by').value       = '';
  document.getElementById('act-priority').value = 'High';
  openModal('modal-action');
}

function saveAction() {
  const data = {
    text:     document.getElementById('act-text').value.trim(),
    area:     document.getElementById('act-area').value.trim(),
    by:       document.getElementById('act-by').value.trim(),
    priority: document.getElementById('act-priority').value,
  };
  if(!data.text) { showToast('Action text is required','error'); return; }
  DB.addAction(data);
  closeModal('modal-action');
  renderActions();
  showToast('✅ Action added');
}

// MONTHLY LOG MODAL
function openAddLog() {
  const now = new Date();
  document.getElementById('log-month').value    = now.toLocaleString('default',{month:'long',year:'numeric'});
  document.getElementById('log-income').value   = '';
  document.getElementById('log-business').value = '';
  document.getElementById('log-expenses').value = '';
  document.getElementById('log-saved').value    = '';
  document.getElementById('log-notes').value    = '';
  openModal('modal-log');
}

function saveLog() {
  const income   = parseFloat(document.getElementById('log-income').value)||0;
  const business = parseFloat(document.getElementById('log-business').value)||0;
  const expenses = parseFloat(document.getElementById('log-expenses').value)||0;
  const saved    = parseFloat(document.getElementById('log-saved').value)||(income+business-expenses);
  DB.addMonthlyEntry({
    month:    document.getElementById('log-month').value,
    income, business, expenses, saved,
    notes:    document.getElementById('log-notes').value.trim(),
  });
  closeModal('modal-log');
  renderMonthlyLog();
  showToast('✅ Month logged');
}

// WEALTH CATEGORY MODAL
function openAddWealthCat() {
  document.getElementById('wcat-key').value    = '';
  document.getElementById('wcat-label').value  = '';
  document.getElementById('wcat-target').value = '';
  openModal('modal-wcat');
}

function saveWealthCat() {
  const label  = document.getElementById('wcat-label').value.trim();
  const target = parseFloat(document.getElementById('wcat-target').value)||0;
  const key    = 'w_'+Date.now();
  if(!label) { showToast('Label is required','error'); return; }
  DB.addWealthCategory(key, label, target);
  closeModal('modal-wcat');
  renderWealth();
  showToast('✅ Wealth category added');
}

// EXPORT / IMPORT
function exportData() {
  const blob = new Blob([DB.exportData()], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'lifetracker_backup_'+new Date().toISOString().slice(0,10)+'.json';
  a.click();
  showToast('✅ Data exported!');
}

function importData() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      if(DB.importData(ev.target.result)) {
        showToast('✅ Data imported!');
        init();
      } else { showToast('❌ Invalid file','error'); }
    };
    reader.readAsText(file);
  };
  input.click();
}

function resetData() {
  confirm_action('Reset ALL data to defaults? This cannot be undone.', () => {
    DB.reset();
    init();
    showToast('✅ Data reset to defaults');
  });
}

// ── INIT ──────────────────────────────────────────────────────
function init() {
  
  const p = DB.getProfile();
  document.getElementById('sidebar-name').textContent    = p.name;
  document.getElementById('sidebar-tagline').textContent = p.tagline;
  document.getElementById('topbar-date').textContent     =
    new Date().toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
  showPage('dashboard');
}

document.addEventListener('DOMContentLoaded', init);
