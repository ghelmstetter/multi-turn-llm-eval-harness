// A self-contained HTML report for one run: summary first, then every conversation with its
// metrics, checks, rubric scores (with the judge's reasons) and, in mirrored mode, the shadow
// answer and verdict at each turn.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const num = (x, d = 1) => (x == null ? '–' : Number(x).toFixed(d));
const usd = (x) => (x == null ? '–' : `$${x < 0.01 && x > 0 ? x.toFixed(4) : x.toFixed(2)}`);
const signed = (x) => (x == null ? '–' : `${x > 0 ? '+' : ''}${Math.round(x * 100)} pts`);

import { METRIC_BETTER, metricScore } from '../run.js';

const metricName = (m, rule) => ({
  wordsMedian: 'shorter turns', wordsP90: 'fewer long turns', monologues: 'fewer monologues', stackedQuestions: 'fewer stacked questions',
  nativeShare: Array.isArray(rule) ? `English share closer to ${pct(rule[0])}–${pct(rule[1])}` : rule > 0 ? 'more English' : 'less English',
  aboveLevelShare: 'fewer words above level', userTalkShare: 'more learner talk',
}[m] ?? m);
const ruleText = (rule) => (Array.isArray(rule) ? `best between ${pct(rule[0])} and ${pct(rule[1])}` : rule > 0 ? 'higher is better' : 'lower is better');

/** The bottom line at the top of the report: who won, how sure, and what supports or contradicts it. */
function verdictBox(v, label, meta, better) {
  if (!v) return '';
  const L = (id) => esc(label[id] ?? id);
  const head = v.strength === 'clear' ? `Winner: ${L(v.leader)}`
    : v.strength === 'leaning' ? `Leaning: ${L(v.leader)}, but not conclusive yet`
      : 'Too close to call';
  const sample = `${v.n} ${v.unit}`;
  const rate = `${L(v.leader)} won ${pct(v.winRate)} of ${sample} judged head to head (95% interval ${pct(v.ci[0])}–${pct(v.ci[1])})`;
  const why = v.strength === 'clear' ? `${rate}.`
    : v.strength === 'leaning' ? `${rate}. The interval includes 50%, so more turns or repeats could change the result.`
      : `${rate}: not distinguishable from a coin flip at this sample size.`;
  const lines = [];
  if (v.rubric[v.leader] != null && v.rubric[v.other] != null) {
    const agree = v.rubricLead == null ? 'about even' : v.rubricLead === v.leader ? 'agrees' : `<b>disagrees</b> (favors ${L(v.other)})`;
    lines.push(`Rubric judge: ${num(v.rubric[v.leader])} vs ${num(v.rubric[v.other])} out of 5, ${agree}.`);
  }
  const mw = (id) => v.metricWins[id].map((m) => metricName(m, better[m]));
  if (mw(v.leader).length) lines.push(`${L(v.leader)} is better on ${mw(v.leader).join(', ')}.`);
  if (mw(v.other).length) lines.push(`${L(v.other)} is better on ${mw(v.other).join(', ')}.`);
  const c = v.checks;
  if (c[v.leader].total || c[v.other].total) lines.push(`Case checks passed: ${L(v.leader)} ${c[v.leader].passed}/${c[v.leader].total}, ${L(v.other)} ${c[v.other].passed}/${c[v.other].total}.`);
  return `<section class="verdict ${v.strength}"><h2>${head}</h2><p>${why}</p><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
  <p class="muted small">The headline comes from the pairwise judge. Turns within one conversation aren't fully independent, so treat the interval as approximate.${meta.mock ? ' <b>Mock run: these results are placeholders.</b>' : ''}</p></section>`;
}

/** Bold the better value in a row (rule: -1 lower is better, 1 higher, or a [low, high] range). */
function bestCells(values, rule, fmt) {
  const scores = values.map((x) => (x == null ? null : metricScore(x, rule)));
  const ok = scores.filter((x) => x != null);
  const best = ok.length > 1 && new Set(ok).size > 1 ? Math.max(...ok) : null;
  return values.map((x, i) => `<td${best != null && scores[i] === best ? ' class="best"' : ''}>${fmt(x)}</td>`).join('');
}

const METRICS = [
  ['wordsMedian', 'Median words per turn', (x) => num(x, 0)],
  ['wordsP90', '90th-percentile words per turn', (x) => num(x, 0)],
  ['monologues', 'Monologues per conversation', (x) => num(x, 1)],
  ['stackedQuestions', 'Turns with 2+ questions', (x) => num(x, 1)],
  ['nativeShare', 'Native-language (English) share', pct],
  ['aboveLevelShare', 'Words above the learner\'s level', pct],
  ['userTalkShare', 'Learner\'s share of the talking', pct],
];

export function renderReport(results) {
  const { meta, summary, conversations } = results;
  const ids = meta.targets.map((t) => t.id);
  const label = Object.fromEntries(meta.targets.map((t) => [t.id, t.label ?? t.id]));
  const cmp = summary.comparison;
  const S = summary.targets;

  const better = summary.better ?? METRIC_BETTER;
  const summaryRows = METRICS.map(([k, name, f]) => `<tr><th>${esc(name)}<span class="dir">${ruleText(better[k])}</span></th>${bestCells(ids.map((id) => S[id]?.metrics?.[k] ?? null), better[k], f)}</tr>`).join('');
  const rubricRows = (meta.rubric ?? []).map((c) => `<tr><th title="${esc(c.description)}">${esc(c.id)}</th>${bestCells(ids.map((id) => S[id]?.rubric?.[c.id] ?? null), 1, (x) => num(x))}</tr>`).join('');

  let cmpHtml = '';
  if (cmp && meta.mode === 'mirrored') {
    cmpHtml = `<h2>Turn-by-turn comparison (mirrored runs)</h2>
    <p class="muted">${cmp.turnsCompared} turns compared, each judged in both orders. A position-inconsistent verdict counts as a tie.</p>
    <table><tr><th></th>${ids.map((id) => `<th>${esc(label[id])}</th>`).join('')}</tr>
      <tr><th>Win rate (ties count half)</th>${ids.map((id) => `<td><b>${pct(cmp[id]?.winRate)}</b></td>`).join('')}</tr>
      <tr><th>…continuing its own conversation</th>${ids.map((id) => `<td>${pct(cmp[id]?.onOwnTrack)}</td>`).join('')}</tr>
      <tr><th>…continuing its rival's conversation</th>${ids.map((id) => `<td>${pct(cmp[id]?.onRivalTrack)}</td>`).join('')}</tr>
      <tr><th>Home-field effect</th>${ids.map((id) => `<td>${signed(cmp[id]?.homeField)}</td>`).join('')}</tr>
      <tr><th>Mean words per answer</th>${ids.map((id) => `<td>${num(cmp.meanWords?.[id], 0)}</td>`).join('')}</tr>
    </table>
    <p>Judge position consistency: <b>${pct(cmp.positionConsistency)}</b> of verdicts were the same in both orders (${cmp.ties} ties).</p>`;
  } else if (cmp) {
    cmpHtml = `<h2>Whole-conversation comparison</h2>
    <p>${cmp.conversationsCompared} pairs of conversations, judged in both orders. ${ids.slice(0, 2).map((id) => `${esc(label[id])}: <b>${pct(cmp[id]?.winRate)}</b>`).join(' · ')}. Judge position consistency: <b>${pct(cmp.positionConsistency)}</b>.</p>`;
  }

  const convHtml = conversations.map((c, i) => {
    const turns = c.history.map((h) => {
      if (h.role === 'user') return `<div class="msg user"><span class="who">${esc(meta.roleNames?.user ?? 'user')}${h.scripted ? ' · scripted' : h.beat ? ' · beat' : ''}</span>${esc(h.text)}${h.beat ? `<div class="note">beat: ${esc(h.beat)}</div>` : ''}</div>`;
      const v = h.verdict;
      const shadow = h.shadow ? `<details class="shadow"><summary>Shadow answer from ${esc(label[h.shadow.by] ?? h.shadow.by)} · verdict: <b>${esc(v.winner === 'tie' ? 'tie' : label[v.winner] ?? v.winner)}</b>${v.consistent ? '' : ' (orders disagreed)'}</summary><div class="msg assistant alt">${esc(h.shadow.text)}</div><div class="note">Judge, order 1: ${esc(v.reasons[0])}<br>Judge, order 2: ${esc(v.reasons[1])}</div></details>` : '';
      return `<div class="msg assistant"><span class="who">${esc(label[h.by] ?? h.by)} · ${h.text.split(/\s+/).filter(Boolean).length} words</span>${esc(h.text)}${shadow}</div>`;
    }).join('');
    const checks = (c.checks ?? []).map((k) => `<li class="${k.pass ? 'pass' : 'fail'}">${k.pass ? '✓' : '✗'} ${esc(k.id)}: ${esc(k.description)}</li>`).join('');
    const rub = c.rubric ? `<table class="small">${Object.entries(c.rubric.scores).map(([k, s]) => `<tr><th>${esc(k)}</th><td>${s.score ?? '–'}</td><td>${esc(s.why)}</td></tr>`).join('')}</table><p class="muted small">${esc(c.rubric.summary)}</p>` : (c.rubricError ? `<p class="fail">Rubric failed: ${esc(c.rubricError)}</p>` : '');
    const m = c.metrics ?? {};
    return `<details class="conv"${i === 0 ? ' open' : ''}><summary><b>${esc(c.case)}</b> #${c.repeat + 1} · ${meta.mode === 'mirrored' ? `continues with ${esc(label[c.main])}` : esc(label[c.main])}${c.partial ? ' · <span class="fail">partial</span>' : ''}</summary>
      <p class="small muted">median ${m.wordsMedian} words/turn · max ${m.wordsMax} · English ${pct(m.nativeShare)} · above level ${pct(m.aboveLevelShare)}${m.aboveLevelWords?.length ? ` (${esc(m.aboveLevelWords.slice(0, 8).join(', '))})` : ''} · learner talk ${pct(m.userTalkShare)}</p>
      ${checks ? `<ul class="checks">${checks}</ul>` : ''}
      <div class="transcript">${turns}</div>${rub}</details>`;
  }).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.suite.title)}: ${esc(meta.mode)} run</title>
<style>
:root{--bg:#fafaf8;--fg:#1d1d1b;--muted:#6a6a64;--card:#fff;--line:#e2e1dc;--a:#eef2f8;--u:#f8efe6;--ok:#1f7a3a;--bad:#b42318;--accent:#1c5cab}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe7;--muted:#a3a29b;--card:#201f1d;--line:#3a3935;--a:#1f2733;--u:#33281e;--ok:#5bc27a;--bad:#ff8a80;--accent:#7fb0ef}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:1.4rem;margin:0 0 4px}h2{font-size:1.1rem;margin:28px 0 8px}
.muted{color:var(--muted)}.small{font-size:.85rem}
.banner{border:2px solid var(--bad);color:var(--bad);border-radius:10px;padding:8px 12px;margin:12px 0}
table{border-collapse:collapse;width:100%;margin:8px 0;background:var(--card)}th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
td{font-variant-numeric:tabular-nums}
details.conv{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin:8px 0}
.transcript{display:flex;flex-direction:column;gap:6px;margin:8px 0}
.msg{padding:8px 12px;border-radius:10px;max-width:85%;white-space:pre-wrap}.msg.assistant{background:var(--a)}.msg.user{background:var(--u);margin-left:auto}
.msg.alt{opacity:.85;margin-top:6px;max-width:100%}.who{display:block;font-size:.75rem;color:var(--muted)}
.note{font-size:.8rem;color:var(--muted);margin-top:4px;white-space:normal}.shadow summary{font-size:.8rem;color:var(--muted);cursor:pointer;margin-top:6px}
.verdict{background:var(--card);border:2px solid var(--line);border-left:6px solid var(--muted);border-radius:10px;padding:4px 16px;margin:16px 0}
.verdict.clear{border-left-color:var(--ok)}.verdict.leaning{border-left-color:var(--accent)}.verdict h2{margin:10px 0 4px;font-size:1.25rem}.verdict ul{margin:4px 0 8px;padding-left:20px}
td.best{font-weight:700}th .dir{display:block;font-weight:400;font-size:.75rem;color:var(--muted)}
.checks{list-style:none;padding:0;margin:4px 0}.pass{color:var(--ok)}.fail{color:var(--bad)}
code{font-size:.85em}
</style></head><body><main>
<h1>${esc(meta.suite.title)}</h1>
<p class="muted">${esc(meta.mode)} mode · ${meta.cases.length} case(s) × ${meta.repeats} repeat(s) × ${meta.turns} turns · judge: ${esc(meta.judge.vendor)} ${esc(meta.judge.model ?? '')} · simulated user: ${esc(meta.user.vendor)} ${esc(meta.user.model ?? '')} · ${esc(meta.startedAt)}</p>
${meta.mock ? '<div class="banner"><b>Mock run.</b> No model was called: these numbers only demonstrate the report format.</div>' : ''}
${verdictBox(summary.verdict, label, meta, summary.better ?? METRIC_BETTER)}
${results.partial ? `<div class="banner"><b>Partial run:</b> ${esc(results.stopReason)}. Results so far are kept.</div>` : ''}
<h2>Targets</h2>
<table><tr><th>Target</th><th>Vendor / model</th><th>Prompt variant</th></tr>${meta.targets.map((t) => `<tr><td>${esc(t.label ?? t.id)}</td><td>${esc(t.vendor)} / ${esc(t.model ?? '')}</td><td>${esc(t.prompt ?? '')}</td></tr>`).join('')}</table>
${cmpHtml}
<h2>Code-measured metrics (mean over each target's own conversations)</h2>
<table><tr><th></th>${ids.map((id) => `<th>${esc(label[id])}</th>`).join('')}</tr>${summaryRows}
<tr><th>Case checks passed</th>${ids.map((id) => `<td>${S[id].checksPassed} / ${S[id].checksTotal}</td>`).join('')}</tr></table>
${rubricRows ? `<h2>Rubric (LLM judge, 1–5, mean)</h2><table><tr><th></th>${ids.map((id) => `<th>${esc(label[id])}</th>`).join('')}</tr>${rubricRows}<tr><th>Mean</th>${ids.map((id) => `<td><b>${num(S[id]?.rubricMean)}</b></td>`).join('')}</tr></table>` : ''}
<h2>Cost</h2><p>${usd(meta.budget.spentUsd)} over ${meta.budget.calls} model calls (assistant ${usd(meta.budget.byRole.assistant)}, simulated user ${usd(meta.budget.byRole.user)}, judge ${usd(meta.budget.byRole.judge)}). Caps: ${usd(meta.budget.runCapUsd)} per run, ${usd(meta.budget.dailyCapUsd)} per day.</p>
<h2>Conversations</h2>${convHtml}
<p class="muted small">Generated by multi-turn-llm-eval-harness v${esc(meta.harnessVersion)}.</p>
</main></body></html>`;
}
