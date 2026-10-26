// A self-contained HTML report for one run: summary first, then every conversation with its
// metrics, checks, rubric scores (with the judge's reasons) and, in mirrored mode, the shadow
// answer and verdict at each turn.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const num = (x, d = 1) => (x == null ? '–' : Number(x).toFixed(d));
const usd = (x) => (x == null ? '–' : `$${x < 0.01 && x > 0 ? x.toFixed(4) : x.toFixed(2)}`);
const signed = (x) => (x == null ? '–' : `${x > 0 ? '+' : ''}${Math.round(x * 100)} pts`);

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

  const summaryRows = METRICS.map(([k, name, f]) => `<tr><th>${esc(name)}</th>${ids.map((id) => `<td>${f(S[id]?.metrics?.[k])}</td>`).join('')}</tr>`).join('');
  const rubricRows = (meta.rubric ?? []).map((c) => `<tr><th title="${esc(c.description)}">${esc(c.id)}</th>${ids.map((id) => `<td>${num(S[id]?.rubric?.[c.id])}</td>`).join('')}</tr>`).join('');

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
.checks{list-style:none;padding:0;margin:4px 0}.pass{color:var(--ok)}.fail{color:var(--bad)}
code{font-size:.85em}
</style></head><body><main>
<h1>${esc(meta.suite.title)}</h1>
<p class="muted">${esc(meta.mode)} mode · ${meta.cases.length} case(s) × ${meta.repeats} repeat(s) × ${meta.turns} turns · judge: ${esc(meta.judge.vendor)} ${esc(meta.judge.model ?? '')} · simulated user: ${esc(meta.user.vendor)} ${esc(meta.user.model ?? '')} · ${esc(meta.startedAt)}</p>
${meta.mock ? '<div class="banner"><b>Mock run.</b> No model was called: these numbers only demonstrate the report format.</div>' : ''}
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
