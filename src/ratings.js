// Blind human rating: which turns to rate, a balanced sample of them, and how often the LLM
// judge agreed with the human. Pure functions, used by the web app (where people rate) and by
// the report (which shows the agreement). Ratings come from mirrored runs, where every turn has
// two candidate replies and a judge verdict.
import { wilson } from './run.js';
import { nativeShare } from './graders/metrics.js';

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
 * Twins are rated once: in mirrored mode a case's first turn appears on both targets' tracks
 * with the same context, so only one of them (chosen at random) can be in a sample.
 */
export function sampleItems(items, n, seed = 1, targetIds = null) {
  const rand = rng(seed);
  const byCase = new Map();
  const seen = new Set();
  for (const it of shuffle(items, rand)) {
    const twin = `${it.case}\n${JSON.stringify(it.context)}`;
    if (seen.has(twin)) continue;
    seen.add(twin);
    (byCase.get(it.case) ?? byCase.set(it.case, []).get(it.case)).push(it);
  }
  const pools = [...byCase.values()].map((xs) => shuffle(xs, rand));
  const picked = [];
  // Take one from each case in turn until n are picked or every case runs out.
  const total = pools.reduce((t, p) => t + p.length, 0);
  for (let k = 0; picked.length < Math.min(n, total); k++) for (const p of pools) if (p[k] && picked.length < n) picked.push(p[k]);
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

const LANG = { en: 'English', es: 'Spanish', it: 'Italian', fr: 'French', de: 'German', pt: 'Portuguese' };
const wordCount = (t) => String(t ?? '').split(/\s+/).filter(Boolean).length;

/**
 * What each rater tended to prefer, on the turns the human rated: how often each picked the
 * longer reply, and (for language-learning suites, which set metrics.target and .native) the
 * reply with more of the learner's native language. Only pairs that clearly differ count
 * (lengths 20% apart, native-language share 10 points apart), and only turns where that rater
 * picked a winner. A large gap between the human and the judge points to why they disagree.
 */
export function preferences(results, ratings) {
  const items = new Map(ratingItems(results).map((it) => [it.key, it]));
  const rated = (ratings?.items ?? []).filter((r) => r.pick && r.pick !== 'skip' && items.has(r.key)).map((r) => ({ pick: r.pick, item: items.get(r.key) }));
  const m = results.meta.suite?.metrics ?? {};
  const lang = m.native && m.target ? { target: m.target, native: m.native } : null;
  const traits = [
    { id: 'longer', label: 'the longer reply', value: (t) => wordCount(t), differ: (a, b) => Math.abs(a - b) >= 0.2 * Math.max(a, b) },
    ...(lang ? [{ id: 'native', label: `the reply with more ${LANG[lang.native] ?? lang.native}`, value: (t) => nativeShare(t, lang), differ: (a, b) => Math.abs(a - b) >= 0.1 }] : []),
  ];
  return traits.map((tr) => {
    const tally = (pickOf) => {
      let k = 0;
      let n = 0;
      for (const r of rated) {
        const p = pickOf(r);
        if (p === 'tie') continue;
        const [x, y] = Object.keys(r.item.replies);
        const [vx, vy] = [tr.value(r.item.replies[x]), tr.value(r.item.replies[y])];
        if (!tr.differ(vx, vy)) continue;
        n++;
        if (p === (vx > vy ? x : y)) k++;
      }
      return share(k, n);
    };
    return { id: tr.id, label: tr.label, human: tally((r) => r.pick), judge: tally((r) => r.item.judge.winner) };
  });
}
