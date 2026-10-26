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

const mean = (xs) => { const v = xs.filter((x) => Number.isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

async function assistantTurn(budget, target, suite, history) {
  return charged(budget, 'assistant', target, { purpose: 'assistant', system: assistantSystem(suite, target), messages: assistantMessages(history, suite) });
}

async function finishConversation({ conv, suite, kase, judge, budget, rubric }) {
  conv.metrics = conversationMetrics(conv.history, suite.metrics);
  conv.checks = runChecks(conv.history, kase.checks);
  if (rubric && !conv.partial && conv.history.length) {
    try { conv.rubric = await judgeRubric({ judge, budget, suite, kase, history: conv.history }); } catch (e) {
      if (e instanceof BudgetExceeded) { conv.partial = true; conv.stopReason = e.message; } else conv.rubricError = e.message;
    }
  }
  return conv;
}

export async function runMirrored({ suite, cases, targets, judge, user, turns, repeats, budget, rubric = true, log = () => {} }) {
  if (targets.length !== 2) throw new Error('Mirrored mode compares exactly two targets');
  const [X, Y] = targets;
  const conversations = [];
  for (const kase of cases) {
    for (let r = 0; r < repeats; r++) {
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

export async function runIndependent({ suite, cases, targets, judge, user, turns, repeats, budget, rubric = true, log = () => {} }) {
  const conversations = [];
  const pairs = [];
  for (const kase of cases) {
    for (let r = 0; r < repeats; r++) {
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
  return { targets: out, comparison };
}
