// The web app: one page, three tabs. It uses the same engine code as the command line
// (served from ../src), so the numbers here always match the CLI's.
import { REPORT_CSS } from '../src/report/styles.js';
import { popovers } from '../src/report/glossary.js';
import { mountRate } from './rate.js';
import { comparisonSection } from '../src/report/compare-html.js';

// Shared styles first, so app.css can build on them.
const style = document.createElement('style');
style.textContent = REPORT_CSS;
document.head.prepend(style);

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => `${Math.round(x * 100)}%`;
const usd = (x) => (x == null ? '–' : `$${x.toFixed(2)}`);
const date = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return ''; } };

// ---- Tabs (the URL hash keeps the current tab, so links and the back button work) ----
const TABS = ['explore', 'rate', 'run'];
function show() {
  const h = location.hash.slice(1);
  const tab = h.startsWith('compare') ? 'explore' : TABS.includes(h) ? h : 'explore';
  showCompare(h.startsWith('compare') ? new URLSearchParams(h.split('?')[1] ?? '') : null);
  for (const t of TABS) document.getElementById(t).hidden = t !== tab;
  for (const a of document.querySelectorAll('.tabs a')) a.setAttribute('aria-selected', String(a.dataset.tab === tab));
}
addEventListener('hashchange', show);

// ---- Explore: the gallery of saved runs ----
const INDEX = new URL('../runs/index.json', import.meta.url);

function verdictText(v) {
  if (!v) return 'No head-to-head verdict';
  const rate = v.winRate != null ? `${pct(v.winRate)} of ${v.n} ${v.unit ?? ''}`.trim() : '';
  const ci = v.ci ? `, 95% interval ${pct(v.ci[0])}–${pct(v.ci[1])}` : '';
  if (v.strength === 'clear') return `<b>Winner:</b> ${esc(v.leaderLabel)} (${rate}${ci})`;
  if (v.strength === 'leaning') return `<b>Leaning:</b> ${esc(v.leaderLabel)} (${rate}${ci})`;
  return '<b>Too close to call</b>';
}

function runCard(r) {
  const at = (p) => new URL(p, INDEX).href;
  const targets = r.targets.map((t, i) => `<span><i class="sw" style="background:var(--s${i + 1})"></i>${esc(t.label)}</span>`).join('');
  const flags = [r.mock ? 'mock run' : null, r.partial ? 'partial' : null].filter(Boolean).join(' · ');
  return `<article class="run ${esc(r.verdict?.strength ?? '')}">
    <h3>${esc(r.title)}</h3>
    <p class="suite">${esc(r.suite?.title ?? '')}</p>
    <div class="vs">${targets}</div>
    <p class="verdict-line">${verdictText(r.verdict)}</p>
    <p class="stats"><span>${esc(date(r.date))}</span><span>${esc(r.mode)} mode</span><span>${r.cases} cases × ${r.turns} turns${r.repeats > 1 ? ` × ${r.repeats}` : ''}</span><span>${usd(r.costUsd)}${r.calls ? ` · ${r.calls} calls` : ''}</span>${flags ? `<span>${esc(flags)}</span>` : ''}</p>
    <p class="actions"><a href="${esc(at(r.report))}">Open report</a><a href="${esc(at(r.results))}" download>Download results.json</a><label class="pick"><input type="checkbox" data-compare="${esc(r.id)}"> Compare</label></p>
  </article>`;
}

// Full results for a run, fetched once and kept for the session.
const cache = new Map();
async function loadResults(run) {
  if (!cache.has(run.id)) cache.set(run.id, fetch(new URL(run.results, INDEX)).then((r) => { if (!r.ok) throw new Error(`results returned ${r.status}`); return r.json(); }));
  return cache.get(run.id);
}

async function loadRuns() {
  const box = document.getElementById('runs');
  const rate = document.getElementById('rate-box');
  try {
    const res = await fetch(INDEX);
    if (!res.ok) throw new Error(`the run list returned ${res.status}`);
    const { runs = [] } = await res.json();
    RUNS = runs;
    renderGallery();
    show();
    mountRate(rate, runs, loadResults);
  } catch (e) {
    const msg = `<p class="err">Couldn't load the runs: ${esc(e.message)}. If you opened this file directly, start the local server with <code>npm run app</code> instead.</p>`;
    box.innerHTML = msg;
    rate.innerHTML = msg;
  }
}
loadRuns();

// The glossary pop-ups (ⓘ buttons) and hover tooltips, as in the report.
document.body.insertAdjacentHTML('beforeend', popovers());
const tip = document.getElementById('tip');
document.addEventListener('pointerover', (e) => { const t = e.target.closest('[data-tip]'); if (!t) return; tip.textContent = t.dataset.tip; tip.hidden = false; });
document.addEventListener('pointermove', (e) => { if (tip.hidden) return; tip.style.left = `${Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8)}px`; tip.style.top = `${e.clientY + 16}px`; });
document.addEventListener('pointerout', (e) => { if (e.target.closest('[data-tip]')) tip.hidden = true; });

// ---- Gallery: filter by suite, pick two runs to compare ----
let RUNS = [];
let suiteFilter = '';
function renderGallery() {
  const box = document.getElementById('runs');
  const suites = [...new Map(RUNS.map((r) => [r.suite?.id, r.suite?.title ?? r.suite?.id])).entries()];
  const filters = document.getElementById('filters');
  filters.innerHTML = suites.length > 1 ? `<label class="field inline"><span>Suite</span><select id="suite-filter"><option value="">All suites</option>${suites.map(([id, t]) => `<option value="${esc(id)}"${id === suiteFilter ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>` : '';
  filters.querySelector('#suite-filter')?.addEventListener('change', (e) => { suiteFilter = e.target.value; renderGallery(); });
  const shown = RUNS.filter((r) => !suiteFilter || r.suite?.id === suiteFilter);
  box.innerHTML = shown.length ? shown.map(runCard).join('') : '<p class="muted">No runs published yet. Publish one with <code>node src/cli.js report &lt;results.json&gt; --publish docs/runs/index.json</code>.</p>';
  for (const cb of box.querySelectorAll('[data-compare]')) cb.addEventListener('change', updateCompareBar);
  updateCompareBar();
}

function updateCompareBar() {
  const picked = [...document.querySelectorAll('[data-compare]:checked')].map((x) => x.dataset.compare);
  const bar = document.getElementById('compare-bar');
  if (!picked.length) { bar.hidden = true; return; }
  bar.hidden = false;
  const runs = picked.map((id) => RUNS.find((r) => r.id === id));
  const problem = picked.length > 2 ? 'Pick just two runs.' : picked.length === 2 && runs[0].suite?.id !== runs[1].suite?.id ? 'These two runs use different suites, so they can\'t be compared.' : '';
  bar.innerHTML = picked.length < 2
    ? `<span>Picked <b>${esc(runs[0].title)}</b>. Pick one more run of the same suite.</span>`
    : `<span>${problem ? esc(problem) : `Compare <b>${esc(runs[0].title)}</b> and <b>${esc(runs[1].title)}</b>`}</span>${problem ? '' : '<button type="button" class="primary" id="compare-go">Compare</button>'}`;
  bar.querySelector('#compare-go')?.addEventListener('click', () => {
    // The older run is "before".
    const [a, b] = [...runs].sort((x, y) => String(x.date).localeCompare(String(y.date)));
    location.hash = `compare?a=${encodeURIComponent(a.id)}&b=${encodeURIComponent(b.id)}`;
  });
}

async function showCompare(params) {
  const view = document.getElementById('compare-view');
  const gallery = document.getElementById('gallery');
  if (!params) { view.hidden = true; gallery.hidden = false; return; }
  gallery.hidden = true;
  view.hidden = false;
  if (!RUNS.length) { view.innerHTML = '<p class="muted">Loading…</p>'; return; } // re-shown when the runs load
  const runs = [params.get('a'), params.get('b')].map((id) => RUNS.find((r) => r.id === id));
  const back = '<p class="back"><a href="#explore">← All runs</a></p>';
  if (runs.some((r) => !r)) { view.innerHTML = `${back}<p class="err">One of those runs isn't in the gallery any more.</p>`; return; }
  view.innerHTML = `${back}<p class="muted">Loading both runs…</p>`;
  try {
    const [a, b] = await Promise.all(runs.map(loadResults));
    view.innerHTML = `${back}${comparisonSection(a, b, { titles: runs.map((r) => r.title) })}
      <p class="actions small">${runs.map((r) => `<a href="${esc(new URL(r.report, INDEX).href)}">Open the report: ${esc(r.title)}</a>`).join('')}</p>`;
    view.scrollIntoView({ block: 'start' });
  } catch (e) {
    view.innerHTML = `${back}<p class="err">Couldn't load the runs: ${esc(e.message)}</p>`;
  }
}

show();
