// After a run: re-scoring saved transcripts, per-case results, automatic findings, and
// rendering analyst notes. None of this calls a model.
import { conversationMetrics, runChecks } from './graders/metrics.js';
import { summarize, costPerTarget, valueOf, METRIC_BETTER, metricScore, shareInterval } from './run.js';

/**
 * Re-run the code graders (metrics and checks) on a saved run with the suite's current
 * definitions, and recompute the summary. Judge verdicts and rubric scores are kept as they
 * were. Useful after fixing a check or adding a metric: no model calls, no cost. `suite` comes
 * from a loader (loadSuite), which attaches the suite's word list.
 */
export function rescore(results, suite) {
  const cases = Object.fromEntries(suite.cases.map((c) => [c.id, c]));
  for (const c of results.conversations) {
    c.metrics = conversationMetrics(c.history, { ...suite.metrics, ranks: suite._frequencyRanks ?? null });
    c.checks = runChecks(c.history, cases[c.case]?.checks ?? []);
  }
  const targets = results.meta.targets.map((t) => ({ ...t, listPrice: t.price }));
  const summary = summarize({ mode: results.meta.mode, targets, suite, conversations: results.conversations, pairs: results.pairs });
  summary.cost = costPerTarget(targets, results.meta.budget?.byTarget);
  if (summary.verdict) summary.verdict.value = valueOf(summary.verdict, summary.cost);
  results.summary = summary;
  results.meta.suite = { ...results.meta.suite, title: suite.title, description: suite.description, metrics: suite.metrics, pairwiseQuestion: suite.pairwiseQuestion };
  results.meta.rubric = suite.rubric;
  results.meta.promptNotes = suite.promptNotes ?? results.meta.promptNotes;
  results.meta.caseInfo = results.meta.cases.map((id) => ({ id, title: cases[id]?.title ?? id, goal: cases[id]?.goal ?? '' }));
  results.meta.rescoredAt = new Date().toISOString();
  return results;
}

const mean = (xs) => { const v = xs.filter((x) => Number.isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

/** Per case: head-to-head shares, checks and rubric means for each target. */
export function byCase(results) {
  const ids = results.meta.targets.map((t) => t.id);
  return results.meta.cases.map((caseId) => {
    const convs = results.conversations.filter((c) => c.case === caseId);
    let share = null;
    if (results.meta.mode === 'mirrored' && ids.length >= 2) {
      const vs = convs.flatMap((c) => c.history.filter((h) => h.verdict).map((h) => h.verdict.winner));
      const n = vs.length || 1;
      share = { a: vs.filter((v) => v === ids[0]).length / n, tie: vs.filter((v) => v === 'tie').length / n, b: vs.filter((v) => v === ids[1]).length / n, n: vs.length };
    } else if (ids.length >= 2) {
      const ps = (results.pairs ?? []).filter((p) => p.case === caseId);
      const n = ps.length || 1;
      share = { a: ps.filter((p) => p.winner === ids[0]).length / n, tie: ps.filter((p) => p.winner === 'tie').length / n, b: ps.filter((p) => p.winner === ids[1]).length / n, n: ps.length };
    }
    const per = Object.fromEntries(ids.map((id) => {
      const own = convs.filter((c) => c.main === id);
      const checks = own.flatMap((c) => c.checks ?? []);
      return [id, { failed: checks.filter((k) => !k.pass), checks: checks.length, rubric: mean(own.map((c) => mean(Object.values(c.rubric?.scores ?? {}).map((s) => s.score)))) }];
    }));
    // The first target's win rate in this case (ties as half) with its 95% interval.
    if (share) share.interval = shareInterval(share);
    return { case: caseId, share, per };
  });
}

const METRIC_LABEL = {
  wordsMedian: 'median words per reply', wordsP90: 'longer replies (90th percentile, words)', monologues: 'monologues per conversation',
  stackedQuestions: 'turns with 2+ questions', nativeShare: 'native-language share', aboveLevelShare: 'words above level', userTalkShare: "user's share of the talking",
};
const SHARES = new Set(['nativeShare', 'aboveLevelShare', 'userTalkShare']);
const fmtM = (k, x) => (SHARES.has(k) ? `${Math.round(x * 100)}%` : x < 10 ? x.toFixed(1) : Math.round(x).toString());

/**
 * Plain-language findings generated from the data: the biggest measured differences, cases
 * where the overall leader lost, failed checks, and rubric criteria that disagree. Facts only;
 * interpretation belongs in analyst notes.
 */
export function findings(results) {
  const S = results.summary;
  const v = S.verdict;
  const label = Object.fromEntries(results.meta.targets.map((t) => [t.id, t.label ?? t.id]));
  const caseTitle = Object.fromEntries((results.meta.caseInfo ?? []).map((c) => [c.id, c.title]));
  const out = [];
  if (!v) return out;
  const better = S.better ?? METRIC_BETTER;
  const nativeName = { en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese' }[results.meta.suite?.metrics?.native];
  const userName = results.meta.roleNames?.user ?? 'user';
  const mlabel = (k) => (k === 'nativeShare' && nativeName ? `${nativeName} share` : k === 'userTalkShare' ? `${userName}'s share of the talking` : METRIC_LABEL[k]);
  // Biggest measured differences, as relative change.
  const diffs = Object.keys(better).map((k) => {
    const a = S.targets[v.leader]?.metrics?.[k];
    const b = S.targets[v.other]?.metrics?.[k];
    if (a == null || b == null || a === b) return null;
    const leaderBetter = metricScore(a, better[k]) > metricScore(b, better[k]);
    return { k, a, b, leaderBetter, rel: Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9) };
  }).filter(Boolean).sort((x, y) => y.rel - x.rel);
  const top = diffs.filter((d) => d.rel >= 0.2).slice(0, 4);
  if (top.length) out.push({ kind: 'metrics', text: `Measured differences (${label[v.leader]} vs ${label[v.other]}): ${top.map((d) => `${mlabel(d.k)} ${fmtM(d.k, d.a)} vs ${fmtM(d.k, d.b)}${d.leaderBetter ? '' : ' (worse)'}`).join('; ')}.` });
  // Cases the overall leader lost.
  const ids = results.meta.targets.map((t) => t.id);
  for (const c of byCase(results)) {
    if (!c.share || c.share.n < 2) continue;
    const leaderShare = v.leader === ids[0] ? c.share.a : c.share.b;
    const otherShare = v.leader === ids[0] ? c.share.b : c.share.a;
    if (otherShare > leaderShare) {
      const iv = c.share.interval;
      // The interval is for the first target; turn it into the case winner's.
      const ci = iv && (v.other === ids[0] ? iv.ci : [1 - iv.ci[1], 1 - iv.ci[0]]);
      const caveat = iv && !iv.settled ? ` Not settled on its own: with ${c.share.n} turns, the 95% interval on its win rate (${Math.round(ci[0] * 100)}–${Math.round(ci[1] * 100)}%) includes 50%.` : '';
      out.push({ kind: 'case', case: c.case, settled: Boolean(iv?.settled), text: `${label[v.other]} won the "${caseTitle[c.case] ?? c.case}" case (${Math.round(otherShare * 100)}% vs ${Math.round(leaderShare * 100)}% of its turns), against the overall result.${caveat}` });
    }
  }
  // Failed checks.
  for (const c of results.conversations) {
    for (const k of (c.checks ?? []).filter((x) => !x.pass)) {
      out.push({ kind: 'check', case: c.case, text: `${label[c.main]} failed a check in "${caseTitle[c.case] ?? c.case}": ${(k.description || k.id).replace(/\.$/, '')}${k.turns?.length ? ` (turn ${k.turns.map((t) => t + 1).join(', ')})` : ''}.` });
    }
  }
  // Rubric criteria where the overall loser scored higher.
  for (const cr of results.meta.rubric ?? []) {
    const a = S.targets[v.leader]?.rubric?.[cr.id];
    const b = S.targets[v.other]?.rubric?.[cr.id];
    if (a != null && b != null && b - a >= 0.25) out.push({ kind: 'rubric', text: `On "${cr.id.replace(/_/g, ' ')}", the rubric judge scored ${label[v.other]} higher (${b.toFixed(1)} vs ${a.toFixed(1)}).` });
  }
  return out;
}

/** A small Markdown subset for analyst notes: headings, paragraphs, bullet lists, bold, italics, code. */
export function markdownToHtml(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  const out = [];
  let list = null;
  let para = [];
  const flush = () => {
    if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; }
    if (list) { out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`); list = null; }
  };
  for (const raw of String(md ?? '').split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (!line.trim()) flush();
    else if (h) { flush(); out.push(`<h${Math.min(4, h[1].length + 2)}>${inline(h[2])}</h${Math.min(4, h[1].length + 2)}>`); }
    else if (li) { if (para.length) flush(); (list ??= []).push(li[1]); }
    else if (list && /^\s{2,}/.test(raw)) list[list.length - 1] += ` ${line.trim()}`;
    else { if (list) flush(); para.push(line.trim()); }
  }
  flush();
  return out.join('\n');
}
