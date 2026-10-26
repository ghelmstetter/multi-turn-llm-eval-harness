// A self-contained HTML report for one run. Order: the verdict (who won, how sure, at what
// cost), what was compared, charts of each kind of evidence (each with its table view), then
// every conversation, and a glossary. Every term has an ⓘ pop-up explaining what it is, how to
// read it and why it matters.
import { METRIC_BETTER, metricScore } from '../run.js';
import { GLOSSARY, info, popovers, glossarySection } from './glossary.js';
import { winShareChart, pairBars, lengthStrip, splitBar, legend, TOOLTIP_SCRIPT } from './charts.js';
import { byCase, findings, markdownToHtml } from '../analysis.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const num = (x, d = 1) => (x == null ? '–' : Number(x).toFixed(d));
const usd = (x) => (x == null ? '–' : `$${x > 0 && x < 0.01 ? x.toFixed(4) : x.toFixed(2)}`);
const signed = (x) => (x == null ? '–' : `${x > 0 ? '+' : ''}${Math.round(x * 100)} pts`);
const words = (t) => String(t ?? '').split(/\s+/).filter(Boolean).length;

const metricName = (m, rule, roles = {}) => ({
  wordsMedian: 'shorter turns', wordsP90: 'fewer long turns', monologues: 'fewer monologues', stackedQuestions: 'fewer stacked questions',
  nativeShare: Array.isArray(rule) ? `English share closer to ${pct(rule[0])}–${pct(rule[1])}` : rule > 0 ? 'more English' : 'less English',
  aboveLevelShare: 'fewer words above level', userTalkShare: `more ${roles.user ?? 'user'} talk`,
}[m] ?? m);
const ruleText = (rule) => (Array.isArray(rule) ? `best between ${pct(rule[0])} and ${pct(rule[1])}` : rule > 0 ? 'higher is better' : 'lower is better');

const METRICS = [
  ['wordsMedian', 'Median words per turn', (x) => num(x, 0)],
  ['wordsP90', '90th-percentile words per turn', (x) => num(x, 0)],
  ['monologues', 'Monologues per conversation', (x) => num(x, 1)],
  ['stackedQuestions', 'Turns with 2+ questions', (x) => num(x, 1)],
  ['nativeShare', 'Native-language share', pct],
  ['aboveLevelShare', 'Words above the user\'s level', pct],
  ['userTalkShare', 'User\'s share of the talking', pct],
];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** The metrics this suite uses, with names in its own terms (e.g. "learner", "English"). */
function metricsFor(meta, better) {
  const user = meta.roleNames?.user ?? 'user';
  const native = { en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese' }[meta.suite.metrics?.native] ?? 'native-language';
  return METRICS.filter(([k]) => k in better).map(([k, name, f]) => [k, name.replace('Native-language', native).replace("user's", `${user}'s`).replace("User's", `${cap(user)}'s`), f]);
}

/** Bold the better value in a row (rule: -1 lower is better, 1 higher, or a [low, high] range). */
function bestCells(values, rule, fmt) {
  const scores = values.map((x) => (x == null ? null : metricScore(x, rule)));
  const ok = scores.filter((x) => x != null);
  const best = ok.length > 1 && new Set(ok).size > 1 ? Math.max(...ok) : null;
  return values.map((x, i) => `<td${best != null && scores[i] === best ? ' class="best"' : ''}>${fmt(x)}</td>`).join('');
}

/** Quality against cost, in one or two sentences. */
function valueLine(v, L, mock) {
  const val = v?.value;
  if (!val) return '';
  const a = usd(val.leaderPerThousand);
  const b = usd(val.otherPerThousand);
  const per = `${a} vs ${b} per 1,000 replies`;
  const d = `${Math.round(Math.abs(val.diff) * 100)}%`;
  const monthly = Math.abs(val.leaderPerThousand - val.otherPerThousand) * 1000; // per 1M replies
  const text = {
    'better-cheaper': `${L(v.leader)} is better <b>and cheaper</b> (${per}): an easy call.`,
    'better-same': `${L(v.leader)} is better at <b>about the same cost</b> (${per}).`,
    'better-pricier': `${L(v.leader)} is better but costs <b>${d} more</b> (${per}), about ${usd(monthly)} more per million replies. Whether that's worth it depends on volume and margins.`,
    'tie-same': `Quality is about even, and so is cost (${per}).`,
    'tie-leader-cheaper': `Quality is about even, so the cheaper one is the better value: ${L(v.leader)} (${per}).`,
    'tie-other-cheaper': `Quality is about even, so the cheaper one is the better value: ${L(v.other)} (${b} vs ${a} per 1,000 replies).`,
  }[val.kind];
  const sp = val.speed;
  const fmtS = (ms) => `${(ms / 1000).toFixed(1)} s`;
  const speed = !sp ? '' : Math.abs(sp.diff) < 0.1
    ? `<p class="value"><b>Speed:</b> about the same (typical reply ${fmtS(sp.leaderMs)} vs ${fmtS(sp.otherMs)}). ${info('latency')}</p>`
    : `<p class="value"><b>Speed:</b> ${L(v.leader)} is <b>${Math.round(Math.abs(sp.diff) * 100)}% ${sp.diff < 0 ? 'faster' : 'slower'}</b> (typical reply ${fmtS(sp.leaderMs)} vs ${fmtS(sp.otherMs)}). ${info('latency')}</p>`;
  return `<p class="value"><b>Cost:</b> ${text} ${info('qualityPerDollar')}${mock ? ' <span class="muted small">(from mock token counts at the configured prices)</span>' : ''}</p>${speed}${mock && sp ? '<p class="muted small">Mock response times are simulated from reply length.</p>' : ''}`;
}

/** The bottom line at the top of the report. */
function verdictBox(v, L, meta, better, chart = '') {
  if (!v) return '';
  const head = v.strength === 'clear' ? `Winner: ${L(v.leader)}`
    : v.strength === 'leaning' ? `Leaning: ${L(v.leader)}, but not conclusive yet`
      : 'Too close to call';
  const rate = `${L(v.leader)} won ${pct(v.winRate)} of ${v.n} ${v.unit} judged head to head (95% interval ${info('interval')} ${pct(v.ci[0])}–${pct(v.ci[1])})`;
  const why = v.strength === 'clear' ? `${rate}.`
    : v.strength === 'leaning' ? `${rate}. The interval includes 50%, so more turns or repeats could change the result.`
      : `${rate}: not distinguishable from a coin flip at this sample size.`;
  const lines = [];
  if (v.rubric[v.leader] != null && v.rubric[v.other] != null) {
    const agree = v.rubricLead == null ? 'about even' : v.rubricLead === v.leader ? 'agrees' : `<b>disagrees</b> (favors ${L(v.other)})`;
    lines.push(`Rubric judge ${info('rubric')}: ${num(v.rubric[v.leader])} vs ${num(v.rubric[v.other])} out of 5, ${agree}.`);
  }
  const mw = (id) => v.metricWins[id].map((m) => metricName(m, better[m], meta.roleNames));
  if (mw(v.leader).length) lines.push(`${L(v.leader)} is better on ${mw(v.leader).join(', ')}.`);
  if (mw(v.other).length) lines.push(`${L(v.other)} is better on ${mw(v.other).join(', ')}.`);
  const c = v.checks;
  if (c[v.leader].total || c[v.other].total) lines.push(`Case checks ${info('checks')} passed: ${L(v.leader)} ${c[v.leader].passed}/${c[v.leader].total}, ${L(v.other)} ${c[v.other].passed}/${c[v.other].total}.`);
  return `<section class="verdict ${v.strength}"><h2>${head} ${info('verdict')}</h2><p>${why}</p>${chart ? `<div class="v-chart">${chart}</div>` : ''}${valueLine(v, L, meta.mock)}<ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
  <p class="muted small">The headline comes from the pairwise judge, the most direct comparison; the rest is supporting evidence. Turns within one conversation aren't fully independent, so treat the interval as approximate.${meta.mock ? ' <b>Mock run: these results are placeholders.</b>' : ''}</p></section>`;
}

/** Head-to-head shares per row, from the verdicts stored on each turn. */
function shareRows(meta, conversations, results, label) {
  const [X, Y] = meta.targets.map((t) => t.id);
  const tally = (vs) => {
    const n = vs.length || 1;
    return { a: vs.filter((v) => v.winner === X).length / n, tie: vs.filter((v) => v.winner === 'tie').length / n, b: vs.filter((v) => v.winner === Y).length / n, n: vs.length };
  };
  if (meta.mode === 'mirrored') {
    const vs = (main) => conversations.filter((c) => !main || c.main === main).flatMap((c) => c.history.filter((h) => h.verdict).map((h) => h.verdict));
    return [
      { label: 'All turns', ...tally(vs()) },
      { label: `On ${label[X]}'s conversations`, ...tally(vs(X)) },
      { label: `On ${label[Y]}'s conversations`, ...tally(vs(Y)) },
    ];
  }
  return [{ label: 'Whole conversations', ...tally(results.pairs ?? []) }];
}

export function renderReport(results) {
  const { meta, summary, conversations } = results;
  const ids = meta.targets.map((t) => t.id);
  const label = Object.fromEntries(meta.targets.map((t) => [t.id, t.label ?? t.id]));
  const L = (id) => esc(label[id] ?? id);
  const names = ids.map((id) => label[id]);
  const cmp = summary.comparison;
  const S = summary.targets;
  const better = summary.better ?? METRIC_BETTER;
  const two = ids.length >= 2;

  // ---- what was compared ----
  const targetCards = meta.targets.map((t, i) => `<div class="tcard"><h3><i class="sw" style="background:var(--s${i + 1})"></i>${esc(t.label ?? t.id)}</h3>
    ${t.description || meta.promptNotes?.[t.prompt] ? `<p>${esc([t.description, meta.promptNotes?.[t.prompt]].filter(Boolean).join(' '))}</p>` : ''}
    <p class="muted small">${esc(t.vendor)} / ${esc(t.model ?? '')} · prompt variant ${info('promptVariant')} "${esc(t.prompt ?? '')}"${t.temperature != null ? ` · temperature ${t.temperature}` : ''}${t.price ? ` · $${t.price.input} / $${t.price.output} per 1M input / output tokens` : ''}</p>
    ${meta.prompts?.[t.prompt] ? `<details><summary class="small">See the full prompt</summary><pre>${esc(meta.prompts[t.prompt])}</pre></details>` : ''}</div>`).join('');
  const caseList = (meta.caseInfo ?? []).map((c) => `<li><b>${esc(c.title)}</b> <span class="muted">(${esc(c.id)})</span>: ${esc(c.goal)}</li>`).join('');

  // ---- head to head ----
  let h2h = '';
  if (cmp && two) {
    const rows = shareRows(meta, conversations, results, label);
    const tiles = meta.mode === 'mirrored'
      ? `<div class="tiles">${ids.map((id) => `<div class="tile"><span class="k">Home-field effect ${info('homeField')}</span><span class="v">${signed(cmp[id]?.homeField)}</span><span class="small muted">${L(id)}</span></div>`).join('')}
        <div class="tile"><span class="k">Judge position consistency ${info('positionConsistency')}</span><span class="v">${pct(cmp.positionConsistency)}</span><span class="small muted">${cmp.ties} tie(s) ${info('ties')}</span></div></div>`
      : `<div class="tiles"><div class="tile"><span class="k">Judge position consistency ${info('positionConsistency')}</span><span class="v">${pct(cmp.positionConsistency)}</span><span class="small muted">${cmp.ties} tie(s) ${info('ties')}</span></div></div>`;
    const table = meta.mode === 'mirrored'
      ? `<table><tr><th></th>${ids.map((id) => `<th>${L(id)}</th>`).join('')}</tr>
        <tr><th>Win rate ${info('winRate')}</th>${ids.map((id) => `<td>${pct(cmp[id]?.winRate)}</td>`).join('')}</tr>
        <tr><th>…on its own conversations ${info('ownTrack')}</th>${ids.map((id) => `<td>${pct(cmp[id]?.onOwnTrack)}</td>`).join('')}</tr>
        <tr><th>…on its rival's conversations</th>${ids.map((id) => `<td>${pct(cmp[id]?.onRivalTrack)}</td>`).join('')}</tr>
        <tr><th>Home-field effect ${info('homeField')}</th>${ids.map((id) => `<td>${signed(cmp[id]?.homeField)}</td>`).join('')}</tr>
        <tr><th>Mean words per answer</th>${ids.map((id) => `<td>${num(cmp.meanWords?.[id], 0)}</td>`).join('')}</tr></table>`
      : `<table><tr><th></th>${ids.slice(0, 2).map((id) => `<th>${L(id)}</th>`).join('')}</tr><tr><th>Win rate ${info('winRate')}</th>${ids.slice(0, 2).map((id) => `<td>${pct(cmp[id]?.winRate)}</td>`).join('')}</tr></table>`;
    h2h = `<h2>Head to head ${meta.mode === 'mirrored' ? info('mirrored') : ''}</h2>
    <p class="lead">${meta.mode === 'mirrored'
    ? `Who gave the better reply, turn by turn: ${cmp.turnsCompared} turns, each judged twice with the replies in opposite orders. The two lower bars split the turns by whose conversation was being continued ${info('ownTrack')}.`
    : `Which whole conversation was better: ${cmp.conversationsCompared} pairs of conversations with the same scripted user, each judged twice in opposite orders.`}</p>
    ${winShareChart(rows, names)}${tiles}
    <details class="tv"><summary>Show as a table</summary>${table}</details>`;
  }

  // ---- turn lengths ----
  const lengthsOf = (id) => conversations.flatMap((c) => c.history.flatMap((h) => {
    if (h.role !== 'assistant') return [];
    const out = [];
    if (h.by === id) out.push(words(h.text));
    if (h.shadow?.by === id) out.push(words(h.shadow.text));
    return out;
  }));
  const limit = meta.suite.metrics?.maxWords ?? 50;
  const lengths = `<h2>How long the replies are ${info('wordsMedian')}</h2>
  <p class="lead">Every reply as a dot. Short, consistent replies sit at the left; anything past the line is a monologue ${info('monologues')}.</p>
  ${legend(ids.map((id, i) => ({ label: label[id], color: `--s${i + 1}` })))}${lengthStrip(ids.map(lengthsOf), names, limit)}`;

  // ---- code metrics ----
  const M = metricsFor(meta, better);
  const metricCharts = M.map(([k, name, f]) => {
    const vals = ids.map((id) => S[id]?.metrics?.[k] ?? null);
    const rule = better[k];
    const isShare = f === pct;
    return pairBars(`${esc(name)} ${info(k)}<span class="dir">${ruleText(rule)}</span>`, vals, names, { fmt: (x) => f(x), max: isShare ? 1 : undefined, range: Array.isArray(rule) ? rule : null });
  }).join('');
  const metricTable = `<table><tr><th></th>${ids.map((id) => `<th>${L(id)}</th>`).join('')}</tr>${M.map(([k, name, f]) => `<tr><th>${esc(name)}<span class="dir">${ruleText(better[k])}</span></th>${bestCells(ids.map((id) => S[id]?.metrics?.[k] ?? null), better[k], f)}</tr>`).join('')}
  <tr><th>Case checks passed ${info('checks')}</th>${ids.map((id) => `<td>${S[id].checksPassed} / ${S[id].checksTotal}</td>`).join('')}</tr></table>`;
  const metrics = `<h2>Measured in code</h2><p class="lead">Free, deterministic measurements of every conversation, averaged over each target's own conversations.</p>
  ${legend(ids.map((id, i) => ({ label: label[id], color: `--s${i + 1}` })))}<div class="grid">${metricCharts}</div>
  <details class="tv"><summary>Show as a table</summary>${metricTable}</details>`;

  // ---- rubric ----
  let rubric = '';
  if ((meta.rubric ?? []).some((c) => ids.some((id) => S[id]?.rubric?.[c.id] != null))) {
    const charts = meta.rubric.map((c) => pairBars(`${esc(c.id.replace(/_/g, ' '))}`, ids.map((id) => S[id]?.rubric?.[c.id] ?? null), names, { max: 5, fmt: (x) => num(x), note: esc(c.description) })).join('');
    const table = `<table><tr><th></th>${ids.map((id) => `<th>${L(id)}</th>`).join('')}</tr>${meta.rubric.map((c) => `<tr><th>${esc(c.id)}<span class="dir">${esc(c.description)}</span></th>${bestCells(ids.map((id) => S[id]?.rubric?.[c.id] ?? null), 1, (x) => num(x))}</tr>`).join('')}
    <tr><th>Mean</th>${bestCells(ids.map((id) => S[id]?.rubricMean ?? null), 1, (x) => num(x))}</tr></table>`;
    rubric = `<h2>Judged by the rubric ${info('rubric')}</h2><p class="lead">An LLM judge's scores from 1 to 5 for each whole conversation, averaged. Every score comes with a reason: see the conversations below.</p>
    ${legend(ids.map((id, i) => ({ label: label[id], color: `--s${i + 1}` })))}<div class="grid">${charts}</div>
    <details class="tv"><summary>Show as a table</summary>${table}</details>`;
  }

  // ---- cost ----
  const cost = summary.cost ?? {};
  const costVals = ids.map((id) => cost[id]?.perThousandUsd ?? null);
  const b = meta.budget;
  const sec = (ms) => (ms == null ? '–' : `${(ms / 1000).toFixed(1)} s`);
  const costSection = `<h2>Cost, speed and value ${info('qualityPerDollar')}</h2>
  ${valueLine(summary.verdict, L, meta.mock) || ''}
  ${legend(ids.map((id, i) => ({ label: label[id], color: `--s${i + 1}` })))}
  <div class="grid">${pairBars(`Cost per 1,000 replies ${info('costPerThousand')}<span class="dir">lower is better</span>`, costVals, names, { fmt: (x) => usd(x) })}
  ${pairBars('Tokens per reply, input <span class="dir">the prompt and conversation so far</span>', ids.map((id) => cost[id]?.inputPerReply ?? null), names, { fmt: (x) => num(x, 0) })}
  ${pairBars(`Typical response time ${info('latency')}<span class="dir">median; lower is better</span>`, ids.map((id) => cost[id]?.latencyMedianMs ?? null), names, { fmt: sec })}
  ${pairBars(`Slow-end response time ${info('latency')}<span class="dir">90th percentile; lower is better</span>`, ids.map((id) => cost[id]?.latencyP90Ms ?? null), names, { fmt: sec })}</div>
  <h3>What this evaluation cost ${info('evalSpend')}</h3>
  ${splitBar([{ label: 'Targets\' replies', value: b.byRole.assistant ?? 0, color: '--r1' }, { label: 'Simulated user', value: b.byRole.user ?? 0, color: '--r2' }, { label: 'Judge', value: b.byRole.judge ?? 0, color: '--r3' }], usd)}
  <p class="small muted">${usd(b.spentUsd)} in total over ${b.calls} model calls. Caps: ${usd(b.runCapUsd)} per run, ${usd(b.dailyCapUsd)} per day.</p>
  <details class="tv"><summary>Show as a table</summary><table><tr><th></th>${ids.map((id) => `<th>${L(id)}</th>`).join('')}</tr>
  <tr><th>Replies</th>${ids.map((id) => `<td>${cost[id]?.replies ?? '–'}</td>`).join('')}</tr>
  <tr><th>Cost per 1,000 replies</th>${bestCells(costVals, -1, usd)}</tr>
  <tr><th>Input tokens per reply</th>${ids.map((id) => `<td>${num(cost[id]?.inputPerReply, 0)}</td>`).join('')}</tr>
  <tr><th>Output tokens per reply</th>${ids.map((id) => `<td>${num(cost[id]?.outputPerReply, 0)}</td>`).join('')}</tr>
  <tr><th>Typical response time (median)</th>${bestCells(ids.map((id) => cost[id]?.latencyMedianMs ?? null), -1, sec)}</tr>
  <tr><th>Slow-end response time (90th percentile)</th>${bestCells(ids.map((id) => cost[id]?.latencyP90Ms ?? null), -1, sec)}</tr></table></details>`;

  // ---- the verdict's chart: the overall head-to-head split ----
  let verdictChart = '';
  if (cmp && two) {
    const all = shareRows(meta, conversations, results, label)[0];
    verdictChart = winShareChart([{ ...all, label: meta.mode === 'mirrored' ? 'Head to head, all turns' : 'Head to head, whole conversations' }], names);
  }

  // ---- findings ----
  const F = two ? findings(results) : [];
  const findingsHtml = F.length ? `<h2>Findings ${info('findings')}</h2><ul class="findings">${F.map((f) => `<li class="f-${f.kind}">${esc(f.text)}</li>`).join('')}</ul>` : '';

  // ---- by case ----
  let caseHtml = '';
  const BC = two ? byCase(results) : [];
  if (BC.some((c) => c.share)) {
    const title = (id) => (meta.caseInfo ?? []).find((x) => x.id === id)?.title ?? id;
    const lead = summary.verdict?.leader;
    const rows = BC.filter((c) => c.share).map((c) => ({ label: title(c.case), ...c.share }));
    const table = `<table><tr><th>Case</th>${ids.map((id) => `<th>${L(id)}: rubric</th>`).join('')}${ids.map((id) => `<th>${L(id)}: failed checks</th>`).join('')}</tr>
      ${BC.map((c) => `<tr><th>${esc(title(c.case))}</th>${bestCells(ids.map((id) => c.per[id]?.rubric ?? null), 1, (x) => num(x))}${ids.map((id) => `<td>${c.per[id]?.failed.length ? `<span class="fail">${c.per[id].failed.map((k) => esc(k.id)).join(', ')}</span>` : c.per[id]?.checks ? '<span class="pass">none</span>' : '–'}</td>`).join('')}</tr>`).join('')}</table>`;
    const flagged = BC.filter((c) => {
      if (!c.share || !lead) return false;
      const ls = lead === ids[0] ? c.share.a : c.share.b;
      const os = lead === ids[0] ? c.share.b : c.share.a;
      return os > ls;
    }).map((c) => title(c.case));
    caseHtml = `<h2>By case ${info('byCase')}</h2>
    <p class="lead">Who won each case, turn by turn.${flagged.length ? ` <b>${L(summary.verdict.other)} won ${flagged.length === 1 ? 'one case' : `${flagged.length} cases`}</b> despite the overall result: ${flagged.map((t) => esc(t)).join(', ')}.` : ''}</p>
    ${winShareChart(rows, names)}
    <details class="tv"><summary>Rubric and checks by case</summary>${table}</details>`;
  }

  // ---- conversations ----
  const convHtml = conversations.map((c, i) => {
    const turns = c.history.map((h) => {
      if (h.role === 'user') return `<div class="msg user"><span class="who">${esc(meta.roleNames?.user ?? 'user')}${h.scripted ? ' · scripted' : h.beat ? ' · beat' : ''}</span>${esc(h.text)}${h.beat ? `<div class="note">beat: ${esc(h.beat)}</div>` : ''}</div>`;
      const v = h.verdict;
      const k = ids.indexOf(h.by) + 1;
      const shadow = h.shadow ? `<details class="shadow"><summary>Shadow answer from ${L(h.shadow.by)} · verdict: <b>${v.winner === 'tie' ? 'tie' : L(v.winner)}</b>${v.consistent ? '' : ' (the two orders disagreed)'}</summary><div class="msg assistant alt s${ids.indexOf(h.shadow.by) + 1}">${esc(h.shadow.text)}</div><div class="note">Judge, order 1: ${esc(v.reasons[0])}<br>Judge, order 2: ${esc(v.reasons[1])}</div></details>` : '';
      return `<div class="msg assistant s${k}"><span class="who">${L(h.by)} · ${words(h.text)} words</span>${esc(h.text)}${shadow}</div>`;
    }).join('');
    const checks = (c.checks ?? []).map((k) => `<li class="${k.pass ? 'pass' : 'fail'}">${k.pass ? '✓ pass' : '✗ fail'}: ${esc(k.description || k.id)}${!k.pass && k.turns?.length ? ` (turn ${k.turns.map((t) => t + 1).join(', ')})` : ''}</li>`).join('');
    const rub = c.rubric ? `<table class="small"><tr><th>Rubric</th><th>Score</th><th>Judge's reason</th></tr>${Object.entries(c.rubric.scores).map(([k, s]) => `<tr><th>${esc(k)}</th><td>${s.score ?? '–'}</td><td>${esc(s.why)}</td></tr>`).join('')}</table><p class="muted small">${esc(c.rubric.summary)}</p>` : (c.rubricError ? `<p class="fail">Rubric failed: ${esc(c.rubricError)}</p>` : '');
    const m = c.metrics ?? {};
    const title = (meta.caseInfo ?? []).find((x) => x.id === c.case)?.title ?? c.case;
    return `<details class="conv"${i === 0 ? ' open' : ''}><summary><b>${esc(title)}</b> · #${c.repeat + 1} · ${meta.mode === 'mirrored' ? `continuing with ${L(c.main)}` : L(c.main)}${c.partial ? ' · <span class="fail">partial</span>' : ''}</summary>
      <p class="small muted">${[
        `median ${m.wordsMedian} words per reply`, `longest ${m.wordsMax}`,
        'nativeShare' in better ? `${M.find(([k]) => k === 'nativeShare')?.[1].replace(' share', '')} ${pct(m.nativeShare)}` : null,
        'aboveLevelShare' in better ? `above level ${pct(m.aboveLevelShare)}${m.aboveLevelWords?.length ? ` (${esc(m.aboveLevelWords.slice(0, 8).join(', '))})` : ''}` : null,
        'userTalkShare' in better ? `${esc(meta.roleNames?.user ?? 'user')} talk ${pct(m.userTalkShare)}` : null,
      ].filter(Boolean).join(' · ')}</p>
      ${checks ? `<ul class="checks">${checks}</ul>` : ''}
      <div class="transcript">${turns}</div>${rub}</details>`;
  }).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Eval report: ${esc(meta.suite.title)}</title>
<style>
:root{color-scheme:light;--bg:#f9f9f7;--fg:#0b0b0b;--fg2:#52514e;--muted:#6a6964;--card:#fcfcfb;--line:#e1e0d9;--axis:#c3c2b7;--ok:#006300;--bad:#b42318;--accent:#1c5cab;
  --s1:#2a78d6;--s2:#00873c;--tie:#c3c2b7;--r1:#1baf7a;--r2:#eda100;--r3:#e87ba4;--s1w:#eaf2fc;--s2w:#e5f3ea;--u:#f1f0ec;--band:#1baf7a22}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#0d0d0d;--fg:#f0efec;--fg2:#c3c2b7;--muted:#a3a29b;--card:#1a1a19;--line:#2c2c2a;--axis:#383835;--ok:#0ca30c;--bad:#ff8a80;--accent:#7fb0ef;
  --s1:#3987e5;--s2:#00873c;--tie:#5b5a55;--r1:#199e70;--r2:#c98500;--r3:#d55181;--s1w:#18263a;--s2w:#13281b;--u:#262624;--band:#199e7033}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:1.5rem;margin:0}.subhead{font-size:1.1rem;color:var(--accent);margin:2px 0 8px;font-weight:500}h2{font-size:1.15rem;margin:34px 0 6px}h3{font-size:1rem;margin:18px 0 6px}
.muted{color:var(--muted)}.small{font-size:.85rem}.lead{color:var(--fg2);margin:0 0 10px}
.banner{border:2px solid var(--bad);color:var(--bad);border-radius:10px;padding:8px 12px;margin:12px 0}
table{border-collapse:collapse;width:100%;margin:8px 0;background:var(--card)}th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
td{font-variant-numeric:tabular-nums}td.best{font-weight:700}.dir{display:block;font-weight:400;font-size:.75rem;color:var(--muted)}
.verdict{background:var(--card);border:1px solid var(--line);border-left:6px solid var(--muted);border-radius:10px;padding:4px 18px 8px;margin:16px 0}
.verdict.clear{border-left-color:var(--ok)}.verdict.leaning{border-left-color:var(--accent)}.verdict h2{margin:12px 0 4px;font-size:1.3rem}.verdict ul{margin:4px 0 8px;padding-left:20px}
.value{margin:6px 0}
.notes{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:2px 18px 10px;margin:16px 0}.notes h2{margin-top:12px}.notes h3,.notes h4{margin:14px 0 4px}.notes ul{padding-left:20px}
ul.findings{padding-left:20px}ul.findings li{margin:4px 0}ul.findings li.f-case,ul.findings li.f-check{color:var(--fg)}ul.findings li.f-case::marker,ul.findings li.f-check::marker{color:var(--bad)}
.tcards{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}.tcard{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:4px 14px 10px}
.tcard h3{display:flex;align-items:center;gap:8px}.sw{display:inline-block;width:12px;height:12px;border-radius:3px}
pre{white-space:pre-wrap;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:.82rem}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin:6px 0;font-size:.85rem;color:var(--fg2)}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:0}
.chart{width:100%;height:auto;display:block;overflow:visible}.chart text{font:12px system-ui,-apple-system,"Segoe UI",sans-serif}
.chart .lab{fill:var(--fg2)}.chart .tick{fill:var(--muted);font-size:11px}.chart .val{fill:var(--fg);font-variant-numeric:tabular-nums}.chart .in{fill:#fff;font-weight:600}.chart .in.dark{fill:#0b0b0b}
@media (prefers-color-scheme:dark){.chart .in.dark{fill:#f0efec}}
.chart .ref,.chart .axis{stroke:var(--axis);stroke-width:1}.chart .grid{stroke:var(--line);stroke-width:1}.chart .limit{stroke:var(--bad);stroke-width:1.5;stroke-dasharray:4 3}
.chart .band{fill:var(--band)}.chart .dot{stroke:var(--card);stroke-width:2}.chart [data-tip]{cursor:default}.chart [data-tip]:hover{opacity:.85}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px 22px;margin:8px 0}
.mini{margin:0;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 12px}.mini figcaption{font-size:.9rem;font-weight:600;margin-bottom:6px}
.mini .note{font-size:.78rem;color:var(--muted);margin:4px 0 0}
.tiles{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 14px;min-width:200px;display:flex;flex-direction:column}
.tile .k{font-size:.85rem;color:var(--fg2)}.tile .v{font-size:1.6rem;font-weight:650}
details.tv{margin:6px 0 0}details.tv summary,details summary{cursor:pointer;color:var(--accent);font-size:.88rem}
details.conv{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin:8px 0}details.conv summary{color:var(--fg);font-size:.95rem}
.transcript{display:flex;flex-direction:column;gap:6px;margin:8px 0}
.msg{padding:8px 12px;border-radius:10px;max-width:85%;white-space:pre-wrap}.msg.user{background:var(--u);margin-left:auto}
.msg.s1{background:var(--s1w);border-left:3px solid var(--s1)}.msg.s2{background:var(--s2w);border-left:3px solid var(--s2)}
.msg.alt{margin-top:6px;max-width:100%}.who{display:block;font-size:.75rem;color:var(--muted)}
.note{font-size:.8rem;color:var(--muted);margin-top:4px;white-space:normal}.shadow summary{font-size:.8rem;margin-top:6px}
.checks{list-style:none;padding:0;margin:4px 0}.pass{color:var(--ok)}.fail{color:var(--bad)}
.info{display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;border-radius:50%;border:1px solid var(--axis);background:var(--card);color:var(--accent);
  font:italic 700 11px/1 Georgia,serif;cursor:pointer;vertical-align:1px;padding:0;margin-left:2px}.info:hover{border-color:var(--accent)}
.pop{max-width:440px;border:1px solid var(--axis);border-radius:12px;padding:14px 16px;background:var(--card);color:var(--fg);box-shadow:0 8px 30px #0003;font-size:.9rem}
.pop dl,.glossary dl{margin:6px 0 0}.pop dt,.glossary dt{font-weight:650;font-size:.8rem;color:var(--accent);margin-top:6px}.pop dd,.glossary dd{margin:0}
.pop-close{margin-top:10px;border:1px solid var(--line);background:var(--bg);color:var(--fg);border-radius:8px;padding:3px 10px;cursor:pointer}
.glossary{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}.glossary section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:4px 14px 10px}.glossary h3{margin:8px 0 0}
#tip{position:fixed;z-index:10;pointer-events:none;background:var(--fg);color:var(--bg);font-size:.8rem;padding:4px 8px;border-radius:6px;max-width:320px}
ul.cases{padding-left:20px}ul.cases li{margin:3px 0}
details.cases-d{margin:14px 0}details.cases-d>summary{color:var(--fg)}
.v-chart{margin:8px 0 4px}.v-chart .legend{margin-top:0}
.clamp{position:relative;max-height:330px;overflow:hidden}.clamp::after{content:"";position:absolute;left:0;right:0;bottom:0;height:90px;background:linear-gradient(to bottom,transparent,var(--card));pointer-events:none}
.clamp.open{max-height:none}.clamp.open::after{display:none}
.more{border:1px solid var(--line);background:var(--bg);color:var(--accent);border-radius:8px;padding:4px 12px;margin:6px 0 4px;cursor:pointer;font:inherit;font-size:.88rem}
</style></head><body><main>
<h1>Multi-Turn LLM Eval Harness</h1>
<p class="subhead">Report: ${esc(meta.suite.title)}</p>
<p class="muted small">${esc(meta.mode)} mode ${meta.mode === 'mirrored' ? info('mirrored') : ''} · ${meta.cases.length} case(s) × ${meta.repeats} repeat(s) × ${meta.turns} turns · judge: ${esc(meta.judge.vendor)} ${esc(meta.judge.model ?? '')} · simulated user ${info('simulatedUser')}: ${esc(meta.user.vendor)} ${esc(meta.user.model ?? '')} · ${esc(meta.startedAt)} · <a href="#glossary">Glossary</a></p>
${meta.mock ? '<div class="banner"><b>Mock run.</b> No model was called: these numbers only demonstrate the report format.</div>' : ''}
${results.partial ? `<div class="banner"><b>Partial run:</b> ${esc(results.stopReason)}. Results so far are kept.</div>` : ''}
${verdictBox(summary.verdict, L, meta, better, verdictChart)}
${meta.notes ? `<section class="notes"><h2>Analysis and recommendations ${info('analysis')}</h2><div class="clamp" id="notes-body">${markdownToHtml(meta.notes)}</div><button type="button" class="more" data-clamp="notes-body" aria-expanded="false">More…</button></section>` : ''}
${findingsHtml}
<h2>What was compared ${info('target')}</h2>
${meta.suite.description ? `<p class="lead">${esc(meta.suite.description)}</p>` : ''}
<div class="tcards">${targetCards}</div>
${caseList ? `<details class="cases-d"><summary><b>Cases (${(meta.caseInfo ?? []).length})</b> <span class="muted small">what each one tests</span></summary><ul class="cases">${caseList}</ul></details>` : ''}
${h2h}
${caseHtml}
${lengths}
${metrics}
${rubric}
${costSection}
<h2>Conversations</h2>
<p class="lead">Every conversation in full. ${meta.mode === 'mirrored' ? `Under each reply, open the shadow answer ${info('shadow')} to see what the other target said at that point and why the judge preferred one. ` : ''}Learner turns marked "scripted" or "beat" ${info('beat')} come from the case's script.</p>
${convHtml}
${glossarySection()}
<p class="muted small">Generated by multi-turn-llm-eval-harness v${esc(meta.harnessVersion)}.</p>
</main>${popovers()}${TOOLTIP_SCRIPT}</body></html>`;
}

export { GLOSSARY };
