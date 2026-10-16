const fs = require('fs');
const path = require('path');

// Fills the landing page's <!--@name--> markers from
// frontend/data/product.json: the Journey stages (with their live
// screenshots, see backend/showcase.js) and the "What's new" log. Both are
// read once per process, so a deploy that changes them changes the page.
const FRONTEND = path.join(__dirname, '../frontend');
const { icon, emojiIcon } = require('../frontend/js/icons.js');
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const longDate = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// The landing page's try-it demo plays the real starter templates
// (backend/templates.js): phases, tasks, durations and one blocker each,
// so it shows the product without an account or an AI call.
const DEMO_BLOCKERS = { 'job-hunt': 'Waiting on a reference', exam: 'Missing the past papers', 'side-project': 'Domain name taken', 'move-home': 'Landlord not replying', event: 'Venue not confirmed', fitness: 'Shin splints' };
function demoData() {
  const { TEMPLATES } = require('./templates');
  return TEMPLATES.map(t => ({
    id: t.id, icon: t.icon, title: t.title,
    blocker: DEMO_BLOCKERS[t.id] || 'Something in the way',
    phases: t.phases.map(p => ({ title: p.title, tasks: p.tasks.map(k => ({ title: k.title, start: k.start, days: k.days })) })),
  }));
}
// JSON inside a <script> block: "<" escaped so no text can close the tag.
const jsonForScript = v => JSON.stringify(v).replace(/</g, '\\u003c');

function sections(product) {
  const stages = product.stages.map(s => `
        <figure class="reveal group overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
          <div class="stage-shot" data-view="${s.view === '3d' && !s.only2d ? '3d' : '2d'}">
            <img data-v="2d" src="/showcase/stage-${esc(s.id)}.webp" alt="The ${esc(s.name)} stage of the Journey in 2D" width="640" height="400" loading="lazy" class="aspect-[16/10] w-full bg-gray-100 object-cover">${s.only2d ? '' : `
            <img data-v="3d" src="/showcase/stage-${esc(s.id)}-3d.webp" alt="The ${esc(s.name)} stage of the Journey in 3D" width="640" height="400" loading="lazy" class="aspect-[16/10] w-full bg-gray-100 object-cover">
            <div class="stage-views" role="group" aria-label="${esc(s.name)} view">
              <button type="button" data-v="2d">2D</button><button type="button" data-v="3d">3D</button>
            </div>`}
          </div>
          <figcaption class="p-5">
            <p class="font-bold text-navy flex items-center gap-2"><span class="stage-ic">${emojiIcon(s.emoji)}</span>${esc(s.name)}</p>
            <p class="mt-1 text-sm leading-relaxed text-gray-600">${esc(s.line)}</p>
          </figcaption>
        </figure>`).join('');
  const whatsNew = product.whatsNew.slice(0, 6).map(n => `
        <li class="reveal rounded-2xl border border-white/10 bg-white/5 p-6">
          <p class="text-xs font-semibold uppercase tracking-widest text-teal-light"><time datetime="${esc(n.date)}">${esc(longDate(n.date))}</time></p>
          <p class="mt-2 font-bold text-white">${esc(n.title)}</p>
          <p class="mt-2 text-sm leading-relaxed text-white/70">${esc(n.text)}</p>
        </li>`).join('');
  // The feature tour: one slide per feature, in the style of the app's
  // "This week" card. Every slide is in the page, so it reads without JS.
  const tour = product.tour || [];
  const tourHtml = `
        <div class="tour-player" id="tour-player" role="region" aria-roledescription="carousel" aria-label="What Waypoint does">
          <div class="tour-progress" aria-hidden="true">${tour.map(() => '<span></span>').join('')}</div>${tour.map((t, i) => `
          <article class="tour-slide" id="tour-${esc(t.id)}" style="background:${esc(t.bg)}" aria-roledescription="slide" aria-label="${i + 1} of ${tour.length}: ${esc(t.name)}">
            ${t.shot ? '' : `<span class="tour-bg" aria-hidden="true">${icon(t.icon)}</span>`}
            <div class="tour-text">
              <p class="tour-kicker"><span class="tour-ic" aria-hidden="true">${icon(t.icon)}</span>${esc(t.name)}</p>
              <h3 class="tour-big">${esc(t.title)}</h3>
              <p class="tour-sub">${esc(t.text)}</p>
            </div>
            ${t.shot ? `<div class="tour-shot"><img src="/showcase/${esc(t.shot)}.webp" alt="" width="1280" height="800" ${i ? 'loading="lazy"' : 'fetchpriority="high"'} style="object-position:${esc(t.focus || '50% 0')}"></div>` : ''}
          </article>`).join('')}
          <button type="button" class="tour-nav prev" aria-label="Previous feature"></button><button type="button" class="tour-nav next" aria-label="Next feature"></button>
        </div>
        <div class="tour-list" role="group" aria-label="Pick a feature">${tour.map((t, i) => `
          <button type="button" data-i="${i}" aria-controls="tour-${esc(t.id)}">${icon(t.icon)}<span>${esc(t.name)}</span></button>`).join('')}
        </div>`;
  return {
    tour: tourHtml,
    stages,
    whatsnew: whatsNew,
    stagecount: String(product.stages.length),
    demo: jsonForScript(demoData()),
    updated: product.whatsNew.length ? `Updated ${esc(longDate(product.whatsNew[0].date))}` : '',
  };
}

let cached = null;
function renderLanding() {
  if (cached) return cached;
  const template = fs.readFileSync(path.join(FRONTEND, 'landing.html'), 'utf8');
  const fill = sections(JSON.parse(fs.readFileSync(path.join(FRONTEND, 'data/product.json'), 'utf8')));
  cached = template.replace(/<!--@([a-z]+)-->/g, (m, key) => (key in fill ? fill[key] : m));
  return cached;
}

module.exports = { renderLanding };
