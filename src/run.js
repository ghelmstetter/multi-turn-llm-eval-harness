// Runs a suite in one of two complementary modes and summarizes the results.
//
// Mode "mirrored" (shared trajectory, compared turn by turn) for two targets X and Y:
//   The conversation is run twice with the same scripted user. In run 1 it always continues
//   with X's answer, in run 2 with Y's. At every turn the other target also answers from the
//   same history (a shadow answer) and a judge compares the two, in both orders. Each target is
//   judged once continuing its own conversation and once continuing its rival's, which is
//   balanced by design and measures the "home-field" effect: how much a model gains from
//   continuing its own history. Each run's main track is also a complete conversation for
//   whole-conversation judging.
//
// Mode "independent": each target holds its own complete conversations with the simulated
//   user (N repeats per case). Judged per conversation (code metrics, checks, rubric) and
//   pairwise on whole transcripts between the first two targets.
import { runConversation, assistantMessages, assistantSystem } from './conversation.js';
import { charged, BudgetExceeded } from './budget.js';
import { conversationMetrics, runChecks } from './graders/metrics.js';
import { judgeRubric, judgePair, turnContext, transcriptText } from './graders/judge.js';
import { costOf } from './budget.js';

const mean = (xs) => { const v = xs.filter((x) => Number.isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

async function assistantTurn(budget, target, suite, history) {
  return charged(budget, 'assistant', target, { purpose: 'assistant', system: assistantSystem(suite, target), messages: assistantMessages(history, suite) });
}

async function finishConversation({ conv, suite, kase, judge, budget, rubric }) {
  conv.metrics = conversationMetrics(conv.history, { ...suite.metrics, ranks: suite._frequencyRanks ?? null });
  conv.checks = runChecks(conv.history, kase.checks);
  if (rubric && !conv.partial && conv.history.length) {
    try { conv.rubric = await judgeRubric({ judge, budget, suite, kase, history: conv.history }); } catch (e) {
      if (e instanceof BudgetExceeded) { conv.partial = true; conv.stopReason = e.message; } else conv.rubricError = e.message;
    }
  }
  return conv;
}

export async function runMirrored({ suite, cases, targets, judge, user, turns, repeats, repeatStart = 0, budget, rubric = true, log = () => {} }) {
  if (targets.length !== 2) throw new Error('Mirrored mode compares exactly two targets');
  const [X, Y] = targets;
  const conversations = [];
  for (const kase of cases) {
    for (let r = repeatStart; r < repeatStart + repeats; r++) {
      for (const main of [X, Y]) {
        const rival = main === X ? Y : X;
        log(`${kase.id} #${r + 1}: conversation continues with ${main.id}, ${rival.id} answers in the shadow`);
        const assistantStep = async (history, t) => {
          const [ox, oy] = await Promise.all([assistantTurn(budget, X, suite, history), assistantTurn(budget, Y, suite, history)]);
          const v = await judgePair({ judge, budget, question: suite.pairwiseQuestion, context: turnContext(history, suite, kase), a: ox.text, b: oy.text });
          const ids = { A: X.id, B: Y.id, tie: 'tie' };
          const mine = main === X ? ox : oy;
          const shadow = main === X ? oy : ox;
          return {
            text: mine.text, by: main.id, ms: mine.ms,
            shadow: { by: rival.id, text: shadow.text },
            verdict: { winner: ids[v.winner], consistent: v.consistent, votes: v.votes.map((x) => (x ? ids[x] : null)), reasons: v.reasons, lengths: { [X.id]: v.lengths.A, [Y.id]: v.lengths.B } },
          };
        };
        const out = await runConversation({ assistantStep, user, suite, kase, turns, budget });
        const conv = await finishConversation({ conv: { case: kase.id, repeat: r, main: main.id, ...out }, suite, kase, judge, budget, rubric });
        conversations.push(conv);
        if (conv.partial) return { conversations, partial: true, stopReason: conv.stopReason };
      }
    }
  }
  return { conversations, partial: false };
}

export async function runIndependent({ suite, cases, targets, judge, user, turns, repeats, repeatStart = 0, budget, rubric = true, log = () => {} }) {
  const conversations = [];
  const pairs = [];
  for (const kase of cases) {
    for (let r = repeatStart; r < repeatStart + repeats; r++) {
      const byTarget = {};
      for (const tg of targets) {
        log(`${kase.id} #${r + 1}: ${tg.id}`);
        const assistantStep = async (history) => {
          const o = await assistantTurn(budget, tg, suite, history);
          return { text: o.text, by: tg.id, ms: o.ms };
        };
        const out = await runConversation({ assistantStep, user, suite, kase, turns, budget });
        const conv = await finishConversation({ conv: { case: kase.id, repeat: r, main: tg.id, ...out }, suite, kase, judge, budget, rubric });
        conversations.push(conv);
        byTarget[tg.id] = conv;
        if (conv.partial) return { conversations, pairs, partial: true, stopReason: conv.stopReason };
      }
      if (targets.length >= 2) {
        const [X, Y] = targets;
        try {
          const v = await judgePair({
            judge, budget, question: suite.conversationQuestion ?? suite.pairwiseQuestion,
            context: `Context: ${suite.description}\nThis case: ${kase.title}. What good behavior looks like: ${kase.goal}\n\nBelow are two complete conversations with the same scripted user. Compare the ${(suite.roleNames?.assistant ?? 'assistant').toUpperCase()} in each.`,
            a: transcriptText(byTarget[X.id].history, suite), b: transcriptText(byTarget[Y.id].history, suite),
          });
          const ids = { A: X.id, B: Y.id, tie: 'tie' };
          pairs.push({ case: kase.id, repeat: r, winner: ids[v.winner], consistent: v.consistent, votes: v.votes.map((x) => (x ? ids[x] : null)), reasons: v.reasons });
        } catch (e) {
          if (e instanceof BudgetExceeded) return { conversations, pairs, partial: true, stopReason: e.message };
          throw e;
        }
      }
    }
  }
  return { conversations, pairs, partial: false };
}

/** Per-target summary: metrics, checks and rubric over each target's own conversations, plus win rates. */
export function summarize({ mode, targets, suite, conversations, pairs = [] }) {
  const out = {};
  for (const tg of targets) {
    const own = conversations.filter((c) => c.main === tg.id);
    const metricNames = ['wordsMedian', 'wordsP90', 'monologues', 'stackedQuestions', 'nativeShare', 'aboveLevelShare', 'userTalkShare'];
    const metrics = Object.fromEntries(metricNames.map((m) => [m, mean(own.map((c) => c.metrics?.[m]))]));
    const checks = own.flatMap((c) => c.checks ?? []);
    const rubric = Object.fromEntries((suite.rubric ?? []).map((c) => [c.id, mean(own.map((x) => x.rubric?.scores?.[c.id]?.score))]));
    out[tg.id] = { conversations: own.length, metrics, checksPassed: checks.filter((c) => c.pass).length, checksTotal: checks.length, rubric, rubricMean: mean(Object.values(rubric)) };
  }
  let comparison = null;
  if (mode === 'mirrored' && targets.length === 2) {
    const [X, Y] = targets.map((t) => t.id);
    const verdicts = conversations.flatMap((c) => c.history.filter((h) => h.role === 'assistant' && h.verdict).map((h) => ({ main: c.main, ...h.verdict })));
    const rate = (vs, id) => (vs.length ? vs.reduce((s, v) => s + (v.winner === id ? 1 : v.winner === 'tie' ? 0.5 : 0), 0) / vs.length : null);
    const per = (id, rival) => {
      const own = verdicts.filter((v) => v.main === id);
      const away = verdicts.filter((v) => v.main === rival);
      const ownRate = rate(own, id);
      const awayRate = rate(away, id);
      return { winRate: rate(verdicts, id), onOwnTrack: ownRate, onRivalTrack: awayRate, homeField: ownRate != null && awayRate != null ? ownRate - awayRate : null };
    };
    comparison = {
      turnsCompared: verdicts.length,
      ties: verdicts.filter((v) => v.winner === 'tie').length,
      positionConsistency: verdicts.length ? verdicts.filter((v) => v.consistent).length / verdicts.length : null,
      [X]: per(X, Y),
      [Y]: per(Y, X),
      meanWords: { [X]: mean(verdicts.map((v) => v.lengths[X])), [Y]: mean(verdicts.map((v) => v.lengths[Y])) },
    };
  } else if (mode === 'independent' && pairs.length) {
    const ids = targets.slice(0, 2).map((t) => t.id);
    comparison = {
      conversationsCompared: pairs.length,
      ties: pairs.filter((p) => p.winner === 'tie').length,
      positionConsistency: pairs.filter((p) => p.consistent).length / pairs.length,
      ...Object.fromEntries(ids.map((id) => [id, { winRate: pairs.reduce((s, p) => s + (p.winner === id ? 1 : p.winner === 'tie' ? 0.5 : 0), 0) / pairs.length }])),
    };
  }
  const all = { ...METRIC_BETTER, ...(suite.metrics?.better ?? {}) };
  const include = suite.metrics?.include ?? Object.keys(METRIC_BETTER);
  const better = Object.fromEntries(include.filter((k) => k in all).map((k) => [k, all[k]]));
  return { targets: out, comparison, better, verdict: verdict({ mode, targets, comparison, perTarget: out, better }) };
}

// Which way is better for each code metric: -1 lower is better, 1 higher is better, or a
// [low, high] target range (closer to the range is better). A suite can override these in
// suite.metrics.better, e.g. a native-language share range that suits the learner's level.
export const METRIC_BETTER = { wordsMedian: -1, wordsP90: -1, monologues: -1, stackedQuestions: -1, nativeShare: -1, aboveLevelShare: -1, userTalkShare: 1 };

/** 95% Wilson interval for a proportion (ties counted as half a win). */
/** A comparable score for a metric value: higher is better. */
export function metricScore(x, rule) {
  if (Array.isArray(rule)) return x < rule[0] ? x - rule[0] : x > rule[1] ? rule[1] - x : 0;
  return x * rule;
}

// Two-sided 95% Student t critical values for 1..30 degrees of freedom (then ≈ 1.96).
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];

/**
 * 95% interval for the mean of a few scores (Student t), clamped to [lo, hi]. Null with fewer
 * than 3 scores: too few to say anything about the spread.
 */
export function meanInterval(xs, { lo = -Infinity, hi = Infinity } = {}) {
  const v = xs.filter((x) => Number.isFinite(x));
  const n = v.length;
  if (n < 3) return null;
  const m = v.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1));
  const h = (T95[n - 2] ?? 1.96) * sd / Math.sqrt(n);
  return { mean: m, ci: [Math.max(lo, m - h), Math.min(hi, m + h)], n };
}

/** Win rate with ties as half a win, and its 95% interval; settled = the interval excludes 50%. */
export function shareInterval({ a, tie, n }) {
  if (!n) return null;
  const rate = a + tie / 2;
  const ci = wilson(rate, n);
  return { rate, ci, settled: ci[0] > 0.5 || ci[1] < 0.5 };
}

export function wilson(p, n, z = 1.96) {
  if (!n) return [0, 1];
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

/**
 * The bottom line, in plain words. The headline comes from the pairwise judge (the most direct
 * comparison); the rubric, the code metrics and the checks are listed as supporting evidence,
 * including where they disagree with the headline.
 *   strength 'clear':   the win rate's 95% interval is entirely above 50%
 *   strength 'leaning': ahead, but the interval includes 50% (more turns or repeats would settle it)
 *   strength 'tie':     too close to call
 */
export function verdict({ mode, targets, comparison, perTarget, better = METRIC_BETTER }) {
  if (targets.length < 2 || !comparison) return null;
  const [X, Y] = targets.slice(0, 2).map((t) => t.id);
  const n = mode === 'mirrored' ? comparison.turnsCompared : comparison.conversationsCompared;
  const px = comparison[X]?.winRate;
  if (px == null || !n) return null;
  const lead = px >= 0.5 ? X : Y;
  const other = lead === X ? Y : X;
  const p = lead === X ? px : 1 - px;
  const ci = wilson(p, n);
  const strength = ci[0] > 0.5 ? 'clear' : p > 0.5 ? 'leaning' : 'tie';
  const rx = perTarget[X]?.rubricMean;
  const ry = perTarget[Y]?.rubricMean;
  const rubricLead = rx == null || ry == null || Math.abs(rx - ry) < 0.25 ? null : rx > ry ? X : Y;
  const metricWins = { [X]: [], [Y]: [] };
  for (const [m, dir] of Object.entries(better)) {
    const a = perTarget[X]?.metrics?.[m];
    const b = perTarget[Y]?.metrics?.[m];
    if (a == null || b == null) continue;
    const sa = metricScore(a, dir);
    const sb = metricScore(b, dir);
    if (Math.abs(sa - sb) < 1e-9) continue;
    metricWins[sa > sb ? X : Y].push(m);
  }
  const checks = Object.fromEntries([X, Y].map((id) => [id, { passed: perTarget[id]?.checksPassed ?? 0, total: perTarget[id]?.checksTotal ?? 0 }]));
  return { winner: strength === 'tie' ? null : lead, leader: lead, other, strength, winRate: p, ci, n, unit: mode === 'mirrored' ? 'turns' : 'conversation pairs', rubricLead, rubric: { [X]: rx, [Y]: ry }, metricWins, checks };
}

/**
 * What each target costs to run, from its replies' tokens at its configured (list) price.
 * This is the product cost of using that target; the simulated user and the judge are
 * evaluation overhead and aren't included.
 */
export function costPerTarget(targets, byTarget = {}) {
  return Object.fromEntries(targets.map((t) => {
    const b = byTarget[t.id];
    if (!b?.replies) return [t.id, null];
    const usd = costOf(t.listPrice ?? t.price, { input: b.inputTokens, output: b.outputTokens });
    const ms = [...(b.ms ?? [])].sort((x, y) => x - y);
    const q = (p) => (ms.length ? ms[Math.round(p * (ms.length - 1))] : null);
    return [t.id, { replies: b.replies, perThousandUsd: (usd / b.replies) * 1000, inputPerReply: b.inputTokens / b.replies, outputPerReply: b.outputTokens / b.replies, latencyMedianMs: q(0.5), latencyP90Ms: q(0.9) }];
  }));
}

/**
 * Quality against cost, in words: is the winner also cheaper, about the same, or more
 * expensive (and by how much)? Quality scores aren't in dollars, so this reports the trade-off
 * instead of inventing a single "quality per dollar" number.
 */
export function valueOf(v, cost) {
  if (!v || !cost[v.leader] || !cost[v.other]) return null;
  const a = cost[v.leader].perThousandUsd;
  const b = cost[v.other].perThousandUsd;
  const diff = b > 0 ? (a - b) / b : 0;
  const same = Math.abs(diff) < 0.03;
  const kind = v.strength === 'tie' ? (same ? 'tie-same' : a < b ? 'tie-leader-cheaper' : 'tie-other-cheaper')
    : same ? 'better-same' : a < b ? 'better-cheaper' : 'better-pricier';
  const la = cost[v.leader].latencyMedianMs;
  const lb = cost[v.other].latencyMedianMs;
  const speed = la == null || lb == null || !lb ? null : { leaderMs: la, otherMs: lb, diff: (la - lb) / lb };
  return { kind, diff, leaderPerThousand: a, otherPerThousand: b, speed };
}
