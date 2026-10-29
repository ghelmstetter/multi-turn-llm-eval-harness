// Blind human rating: which turns to rate, a balanced sample of them, and how often the LLM
// judge agreed with the human. Pure functions, used by the web app (where people rate) and by
// the report (which shows the agreement). Ratings come from mirrored runs, where every turn has
// two candidate replies and a judge verdict.
import { wilson } from './run.js';

/** A stable id for one judged turn: case, repeat, whose conversation, and the turn number. */
export const itemKey = (conv, h) => `${conv.case}|${conv.repeat ?? 0}|${conv.main}|${h.turn}`;

/**
 * Every judged turn in a mirrored run, with what a rater needs: the conversation so far, the
 * two replies (by target id) and the judge's verdict.
 */
export function ratingItems(results) {
  if (results.meta.mode !== 'mirrored') return [];
  const out = [];
  for (const conv of results.conversations) {
    conv.history.forEach((h, i) => {
      if (h.role !== 'assistant' || !h.verdict || !h.shadow) return;
      out.push({
        key: itemKey(conv, h),
        case: conv.case,
        turn: h.turn,
        context: conv.history.slice(0, i).map((x) => ({ role: x.role, text: x.text })),
        replies: { [h.by]: h.text, [h.shadow.by]: h.shadow.text },
        judge: { winner: h.verdict.winner, consistent: Boolean(h.verdict.consistent) },
      });
    });
  }
  return out;
}

/** A small seeded random number generator (mulberry32), so a sample can be recreated. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const shuffle = (xs, rand) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/**
 * A sample of n items balanced across cases (as even as the cases allow), in random order,
 * each with a random left/right order for the two replies. Same seed, same sample.
 */
export function sampleItems(items, n, seed = 1, targetIds = null) {
  const rand = rng(seed);
  const byCase = new Map();
  for (const it of items) (byCase.get(it.case) ?? byCase.set(it.case, []).get(it.case)).push(it);
  const pools = [...byCase.values()].map((xs) => shuffle(xs, rand));
  const picked = [];
  // Take one from each case in turn until n are picked or every case runs out.
  for (let k = 0; picked.length < Math.min(n, items.length); k++) for (const p of pools) if (p[k] && picked.length < n) picked.push(p[k]);
  const ids = targetIds ?? Object.keys(items[0]?.replies ?? {});
  return shuffle(picked, rand).map((it) => ({ key: it.key, order: rand() < 0.5 ? [ids[0], ids[1]] : [ids[1], ids[0]] }));
}

const share = (k, n) => (n ? { rate: k / n, ci: wilson(k / n, n), k, n } : null);

/**
 * How often the judge agreed with the human, on the items the human rated (skips left out).
 * ratings: { items: [{ key, pick: targetId | 'tie' }] }. Agreement means the same pick,
 * including ties. Also: agreement by case, when the judge was or wasn't position-consistent,
 * when the human picked a winner (not a tie), and both verdicts on the rated items.
 */
export function agreement(results, ratings) {
  const ids = results.meta.targets.map((t) => t.id).slice(0, 2);
  const items = new Map(ratingItems(results).map((it) => [it.key, it]));
  const rated = (ratings?.items ?? []).filter((r) => r.pick && r.pick !== 'skip' && items.has(r.key)).map((r) => ({ ...r, item: items.get(r.key) }));
  const same = (r) => r.pick === r.item.judge.winner;
  const group = (xs) => share(xs.filter(same).length, xs.length);
  const cases = [...new Set(rated.map((r) => r.item.case))];
  const verdictOf = (pick) => {
    const n = rated.length;
    if (!n) return null;
    const c = (p) => rated.filter((r) => pick(r) === p).length / n;
    return { a: c(ids[0]), tie: c('tie'), b: c(ids[1]), n };
  };
  return {
    n: rated.length,
    ids,
    overall: group(rated),
    decisive: group(rated.filter((r) => r.pick !== 'tie' && r.item.judge.winner !== 'tie')),
    byCase: cases.map((id) => ({ case: id, ...group(rated.filter((r) => r.item.case === id)) })),
    consistent: group(rated.filter((r) => r.item.judge.consistent)),
    inconsistent: group(rated.filter((r) => !r.item.judge.consistent)),
    human: verdictOf((r) => r.pick),
    judge: verdictOf((r) => r.item.judge.winner),
    disagreements: rated.filter((r) => !same(r)).map((r) => ({ key: r.key, case: r.item.case, turn: r.item.turn, human: r.pick, judge: r.item.judge.winner, reason: r.reason ?? '' })),
  };
}
