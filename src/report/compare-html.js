// Rendering a comparison of two runs: the web app shows the section, and `compare` on the CLI
// writes it as a standalone page.
import { compareRuns } from '../compare.js';
import { changeChart } from './charts.js';
import { info } from './glossary.js';
import { REPORT_CSS } from './styles.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const pts = (x) => `${x > 0 ? '+' : ''}${Math.round(x * 100)} pts`;
const num = (x, d = 1) => (x == null ? '–' : Number(x).toFixed(d));
const usd = (x) => (x == null ? '–' : `$${x.toFixed(2)}`);
const sec = (ms) => (ms == null ? '–' : `${(ms / 1000).toFixed(1)} s`);
const date = (iso) => String(iso ?? '').slice(0, 10);
const METRIC_NAMES = { wordsMedian: 'Median words per turn', wordsP90: '90th-percentile words per turn', monologues: 'Monologues per conversation', stackedQuestions: 'Turns with 2+ questions', nativeShare: 'Native-language share', aboveLevelShare: 'Words above the learner\'s level', userTalkShare: 'User\'s share of the talking' };
const SHARES = new Set(['nativeShare', 'aboveLevelShare', 'userTalkShare']);

/** The comparison section. a and b are results objects (before, after); titles name the runs. */
export function comparisonSection(a, b, { titles = ['Run A', 'Run B'] } = {}) {
  const c = compareRuns(a, b);
  if (!c.ok) return `<p class="banner">${esc(c.reason)}</p>`;
  const L = c.labels;
  const beforeName = c.kind === 'same' ? `${L.challengerA}, ${date(c.runs[0].startedAt)}` : L.challengerA;
  const afterName = c.kind === 'same' ? `${L.challengerB}, ${date(c.runs[1].startedAt)}` : L.challengerB;
  const o = c.overall;
  const flipped = c.cases.filter((x) => x.flipped);
  const realCases = c.cases.filter((x) => x.real);
  const headline = !o ? 'No head-to-head numbers to compare.'
    : `Against ${esc(L.baseline)}, ${esc(afterName)} won ${pct(o.after.rate)} of ${o.after.n} turns, versus ${pct(o.before.rate)} of ${o.before.n} for ${esc(beforeName)}: ${pts(o.diff)} (95% interval ${pts(o.ci[0])} to ${pts(o.ci[1])}). ${o.real ? 'That change is more than noise.' : 'That change is within noise: the interval includes zero.'}`;
  const caseLine = flipped.length
    ? ` <b>${flipped.length === 1 ? 'One case' : `${flipped.length} cases`} changed sides:</b> ${flipped.map((x) => `${esc(x.title)} (${pct(x.before.rate)} → ${pct(x.after.rate)})`).join(', ')}.`
    : ' No case changed sides.';
  const realLine = realCases.length ? ` More than noise: ${realCases.map((x) => esc(x.title)).join(', ')}.` : ' With these sample sizes, no single case\'s change is more than noise.';
  const chart = changeChart(c.cases.map((x) => ({ label: x.title, before: x.before, after: x.after, real: x.real, note: x.flipped ? 'changed sides' : '' })), { beforeName, afterName, baselineName: L.baseline });
  const fmtM = (k, v) => (v == null ? '–' : SHARES.has(k) ? pct(v) : num(v));
  const arrow = (d) => (d === 'better' ? '<span class="change-up">better</span>' : d === 'worse' ? '<span class="change-down">worse</span>' : '<span class="muted">same</span>');
  const metricRows = c.metrics.map((m) => `<tr><th>${esc(METRIC_NAMES[m.id] ?? m.id)}</th><td>${fmtM(m.id, m.baseline)}</td><td>${fmtM(m.id, m.before)}</td><td>${fmtM(m.id, m.after)}</td><td>${arrow(m.direction)}</td></tr>`).join('');
  const rubricRows = c.rubric.map((r) => `<tr><th>${esc(r.id.replace(/_/g, ' '))}</th><td>${num(r.before)} <span class="muted small">${r.beforeCi ? `(${num(r.beforeCi[0])}–${num(r.beforeCi[1])})` : ''}</span></td><td>${num(r.after)} <span class="muted small">${r.afterCi ? `(${num(r.afterCi[0])}–${num(r.afterCi[1])})` : ''}</span></td><td>${r.separated ? (r.after > r.before ? '<span class="change-up">better</span>' : '<span class="change-down">worse</span>') : '<span class="muted">within noise</span>'}</td></tr>`).join('');
  const cb = c.cost.before;
  const ca = c.cost.after;
  return `<section class="compare">
  <h2>${esc(titles[0])} → ${esc(titles[1])}</h2>
  <p class="muted small">${c.kind === 'same' ? `The same matchup run twice: ${esc(L.baseline)} vs ${esc(L.challengerA)}.` : `Both runs pit ${esc(L.baseline)} against a challenger: ${esc(L.challengerA)} in the first, ${esc(L.challengerB)} in the second.`} Runs from ${date(c.runs[0].startedAt)} and ${date(c.runs[1].startedAt)}${c.runs.some((r) => r.extended) ? ' (one or both extended later)' : ''}.${c.sameModels ? '' : ' <b>The models differ between the runs</b>, so changes may come from the models, not only the prompts.'}</p>
  <div class="verdict ${o?.real ? 'clear' : 'leaning'}"><h3>${o ? `${o.real ? 'A real change' : 'Within noise'}: ${pct(o.before.rate)} → ${pct(o.after.rate)} ${info('interval')}` : 'Comparison'}</h3><p>${headline}${caseLine}${realLine}</p></div>
  <h3>By case</h3>
  <p class="lead">Each case's win rate against ${esc(L.baseline)}, before and after. Right of the 50% line, the challenger wins the case.</p>
  ${chart}
  <h3>Measured in code</h3>
  <div class="tw"><table><tr><th></th><th>${esc(L.baseline)}<span class="dir">baseline, in ${esc(titles[1])}</span></th><th>${esc(beforeName)}</th><th>${esc(afterName)}</th><th>Change</th></tr>${metricRows}</table></div>
  ${rubricRows ? `<h3>Judged by the rubric</h3><div class="tw"><table><tr><th>Criterion</th><th>${esc(beforeName)}</th><th>${esc(afterName)}</th><th>Change</th></tr>${rubricRows}</table></div><p class="small muted">In parentheses: 95% intervals. "Better" or "worse" only when the intervals don't overlap.</p>` : ''}
  <h3>Cost and speed</h3>
  <div class="tw"><table><tr><th></th><th>${esc(beforeName)}</th><th>${esc(afterName)}</th></tr>
  <tr><th>Cost per 1,000 replies</th><td>${usd(cb?.perThousandUsd)}</td><td>${usd(ca?.perThousandUsd)}</td></tr>
  <tr><th>Typical response time</th><td>${sec(cb?.latencyMedianMs)}</td><td>${sec(ca?.latencyMedianMs)}</td></tr>
  <tr><th>Input tokens per reply</th><td>${num(cb?.inputPerReply, 0)}</td><td>${num(ca?.inputPerReply, 0)}</td></tr></table></div>
  <p class="small muted">Two runs have different simulated conversations, so some difference between them is always chance; the intervals account for the number of turns but not for model updates between the run dates.</p>
  </section>`;
}

/** A standalone comparison page, for `compare` on the CLI. */
export function renderComparison(a, b, opts = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comparison: ${esc(a.meta.suite?.title ?? '')}</title><style>${REPORT_CSS}</style></head><body><main>
<h1>Multi-Turn LLM Eval Harness</h1><p class="subhead">Comparison: ${esc(a.meta.suite?.title ?? '')}</p>
${comparisonSection(a, b, opts)}</main></body></html>`;
}
