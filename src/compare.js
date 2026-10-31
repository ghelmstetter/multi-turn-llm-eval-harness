// Comparing two saved runs of the same suite: what changed, and whether the change is more than
// noise. The usual shape is a before/after: both runs pit the same baseline target against a
// challenger (run A: plain vs coached; run B: plain vs coached v2), so the challenger's win rate
// against the baseline can be compared case by case. Pure functions; the web app and the CLI
// render the result.
import { wilson, metricScore, METRIC_BETTER, meanInterval } from './run.js';
import { byCase, caseBalanced } from './analysis.js';

/**
 * 95% interval for the difference of two proportions (Newcombe's method, from each one's Wilson
 * interval). Excludes 0 = the change is more than noise.
 */
export function diffInterval(p1, n1, p2, n2) {
  const [l1, u1] = wilson(p1, n1);
  const [l2, u2] = wilson(p2, n2);
  const d = p2 - p1;
  return [d - Math.sqrt((p2 - l2) ** 2 + (u1 - p1) ** 2), d + Math.sqrt((u2 - p2) ** 2 + (p1 - l1) ** 2)];
}

/** How the two runs line up, or why they can't be compared. */
export function matchup(a, b) {
  if (a.meta.suite?.id !== b.meta.suite?.id) return { ok: false, reason: `The runs use different suites (${a.meta.suite?.id} and ${b.meta.suite?.id}), so their cases and scores don't line up.` };
  if (a.meta.mode !== b.meta.mode) return { ok: false, reason: `One run is ${a.meta.mode} and the other ${b.meta.mode}; their head-to-head numbers measure different things.` };
  const ia = a.meta.targets.slice(0, 2).map((t) => t.id);
  const ib = b.meta.targets.slice(0, 2).map((t) => t.id);
  const shared = ia.filter((id) => ib.includes(id));
  if (shared.length === 2) return { ok: true, kind: 'same', baseline: ia[0], challengerA: ia[1], challengerB: ia[1] };
  if (shared.length === 1) return { ok: true, kind: 'swap', baseline: shared[0], challengerA: ia.find((x) => x !== shared[0]), challengerB: ib.find((x) => x !== shared[0]) };
  return { ok: false, reason: 'The runs have no target in common, so there is no shared baseline to measure both against.' };
}

const winRate = (results, id) => results.summary.comparison?.[id]?.winRate ?? null;
const nOf = (results) => (results.meta.mode === 'mirrored' ? results.summary.comparison?.turnsCompared : results.summary.verdict?.n) ?? 0;

/** A case's win rate for one target (ties as half), from the run's per-case shares. */
function caseRate(results, caseId, id) {
  const c = byCase(results).find((x) => x.case === caseId);
  if (!c?.share?.n) return null;
  const first = results.meta.targets[0].id === id;
  return { rate: first ? c.share.a + c.share.tie / 2 : c.share.b + c.share.tie / 2, n: c.share.n };
}

/** A change between two proportions: the values, their intervals, the difference and its interval. */
function change(p1, n1, p2, n2) {
  if (p1 == null || p2 == null || !n1 || !n2) return null;
  const ci = diffInterval(p1, n1, p2, n2);
  return { before: { rate: p1, n: n1, ci: wilson(p1, n1) }, after: { rate: p2, n: n2, ci: wilson(p2, n2) }, diff: p2 - p1, ci, real: ci[0] > 0 || ci[1] < 0 };
}

/**
 * Compare run A (before) with run B (after). Returns the matchup, the challenger's overall and
 * per-case win rates against the baseline in each run (with the change and whether it's more
 * than noise), and code metrics, rubric, cost and latency side by side.
 */
export function compareRuns(a, b) {
  const mu = matchup(a, b);
  if (!mu.ok) return mu;
  const label = (r, id) => r.meta.targets.find((t) => t.id === id)?.label ?? id;
  // Overall: if either run has cases with different numbers of turns (extended), weight each
  // case equally in both runs, so the extended cases don't dominate.
  const ba = caseBalanced(a, mu.challengerA);
  const bb = caseBalanced(b, mu.challengerB);
  let overall;
  if (ba?.unequal || bb?.unequal) {
    const d = bb.rate - ba.rate;
    const h = 1.96 * Math.sqrt(ba.se ** 2 + bb.se ** 2);
    overall = { before: { rate: ba.rate, n: ba.turns, ci: ba.ci }, after: { rate: bb.rate, n: bb.turns, ci: bb.ci }, diff: d, ci: [d - h, d + h], real: d - h > 0 || d + h < 0, balanced: true };
  } else overall = change(winRate(a, mu.challengerA), nOf(a), winRate(b, mu.challengerB), nOf(b));
  const caseIds = a.meta.cases.filter((id) => b.meta.cases.includes(id));
  const title = (id) => (b.meta.caseInfo ?? a.meta.caseInfo ?? []).find((c) => c.id === id)?.title ?? id;
  const cases = caseIds.map((id) => {
    const x = caseRate(a, id, mu.challengerA);
    const y = caseRate(b, id, mu.challengerB);
    const ch = x && y ? change(x.rate, x.n, y.rate, y.n) : null;
    const side = (r) => (r == null ? null : r > 0.5 ? 'challenger' : r < 0.5 ? 'baseline' : 'even');
    return { case: id, title: title(id), ...ch, flipped: ch ? side(ch.before.rate) !== side(ch.after.rate) && side(ch.before.rate) !== 'even' && side(ch.after.rate) !== 'even' : false };
  });
  const better = { ...METRIC_BETTER, ...(b.summary.better ?? {}) };
  const metricIds = Object.keys(better).filter((k) => a.summary.targets?.[mu.challengerA]?.metrics?.[k] != null && b.summary.targets?.[mu.challengerB]?.metrics?.[k] != null);
  const metrics = metricIds.map((k) => {
    const va = a.summary.targets[mu.challengerA].metrics[k];
    const vb = b.summary.targets[mu.challengerB].metrics[k];
    const base = b.summary.targets[mu.baseline]?.metrics?.[k] ?? null;
    const sa = metricScore(va, better[k]);
    const sb = metricScore(vb, better[k]);
    // Differences under 5% (relative) count as the same: too small to matter.
    const tiny = Math.abs(vb - va) <= 0.05 * Math.max(Math.abs(va), Math.abs(vb), 1e-9);
    return { id: k, rule: better[k], baseline: base, before: va, after: vb, direction: tiny || Math.abs(sb - sa) < 1e-9 ? 'same' : sb > sa ? 'better' : 'worse' };
  });
  // Rubric: each criterion's mean over the challenger's own conversations, with intervals.
  const scores = (r, id, crit) => r.conversations.filter((c) => c.main === id).map((c) => c.rubric?.scores?.[crit]?.score).filter(Number.isFinite);
  const rubric = (b.meta.rubric ?? []).filter((c) => (a.meta.rubric ?? []).some((x) => x.id === c.id)).map((c) => {
    const x = meanInterval(scores(a, mu.challengerA, c.id), { lo: 1, hi: 5 });
    const y = meanInterval(scores(b, mu.challengerB, c.id), { lo: 1, hi: 5 });
    const ma = a.summary.targets?.[mu.challengerA]?.rubric?.[c.id] ?? null;
    const mb = b.summary.targets?.[mu.challengerB]?.rubric?.[c.id] ?? null;
    const separated = x && y && (x.ci[1] < y.ci[0] || y.ci[1] < x.ci[0]);
    return { id: c.id, before: ma, after: mb, beforeCi: x?.ci ?? null, afterCi: y?.ci ?? null, separated: Boolean(separated) };
  });
  const cost = (r, id) => r.summary.cost?.[id] ?? null;
  return {
    ok: true,
    ...mu,
    labels: { baseline: label(b, mu.baseline), challengerA: label(a, mu.challengerA), challengerB: label(b, mu.challengerB) },
    runs: [a, b].map((r) => ({ startedAt: r.meta.startedAt, turns: nOf(r), costUsd: r.meta.budget?.spentUsd ?? null, extended: (r.meta.extensions ?? []).length > 0, models: r.meta.targets.map((t) => t.model) })),
    sameModels: JSON.stringify(a.meta.targets.map((t) => t.model).sort()) === JSON.stringify(b.meta.targets.map((t) => t.model).sort()) && a.meta.judge?.model === b.meta.judge?.model,
    overall,
    cases,
    metrics,
    rubric,
    cost: { before: cost(a, mu.challengerA), after: cost(b, mu.challengerB) },
  };
}
