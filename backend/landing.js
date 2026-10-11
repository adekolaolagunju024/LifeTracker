const fs = require('fs');
const path = require('path');

// Fills the landing page's <!--@name--> markers from
// frontend/data/product.json: the Journey stages (with their live
// screenshots, see backend/showcase.js) and the "What's new" log. Both are
// read once per process, so a deploy that changes them changes the page.
const FRONTEND = path.join(__dirname, '../frontend');
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
          <img src="/showcase/stage-${esc(s.id)}.webp" alt="The ${esc(s.name)} stage of the Journey" width="640" height="400" loading="lazy" class="aspect-[16/10] w-full bg-gray-100 object-cover">
          <figcaption class="p-5">
            <p class="font-bold text-navy">${esc(s.emoji)} ${esc(s.name)}</p>
            <p class="mt-1 text-sm leading-relaxed text-gray-600">${esc(s.line)}</p>
          </figcaption>
        </figure>`).join('');
  const whatsNew = product.whatsNew.slice(0, 6).map(n => `
        <li class="reveal rounded-2xl border border-white/10 bg-white/5 p-6">
          <p class="text-xs font-semibold uppercase tracking-widest text-teal-light"><time datetime="${esc(n.date)}">${esc(longDate(n.date))}</time></p>
          <p class="mt-2 font-bold text-white">${esc(n.title)}</p>
          <p class="mt-2 text-sm leading-relaxed text-white/70">${esc(n.text)}</p>
        </li>`).join('');
  return {
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
