// The web app: one page, three tabs. It uses the same engine code as the command line
// (served from ../src), so the numbers here always match the CLI's.
import { REPORT_CSS } from '../src/report/styles.js';
import { popovers } from '../src/report/glossary.js';
import { mountRate } from './rate.js';

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
  const tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'explore';
  for (const t of TABS) document.getElementById(t).hidden = t !== tab;
  for (const a of document.querySelectorAll('.tabs a')) a.setAttribute('aria-selected', String(a.dataset.tab === tab));
}
addEventListener('hashchange', show);
show();

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
    <p class="actions"><a href="${esc(at(r.report))}">Open report</a><a href="${esc(at(r.results))}" download>Download results.json</a></p>
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
    box.innerHTML = runs.length ? runs.map(runCard).join('') : '<p class="muted">No runs published yet. Publish one with <code>node src/cli.js report &lt;results.json&gt; --publish docs/runs/index.json</code>.</p>';
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
