// Extending a saved run: more conversations for chosen cases, appended to the run and folded
// into its summary, instead of starting over. Used to settle cases whose 95% interval still
// includes 50%. Guards keep it honest:
//   - same experiment only: refuses if the suite's prompts, cases, simulated user or rubric
//     have changed since the run (checked against fingerprints saved with the run);
//   - the number of extra repeats is chosen once, up front (the report suggests one), and
//     each case can be extended once. Adding samples until a case happens to settle, then
//     stopping, makes coin flips look settled ("peeking");
//   - every extension is recorded with its date, so a reader can see a case was topped up
//     later (vendors sometimes update a model without renaming it).
// No file access here: the CLI (and later the web app) does the loading and saving.
import { wilson } from './run.js';
import { estimateRun, paceOf } from './budget.js';
import { rescore } from './analysis.js';

/** A short, stable hash of any JSON value (FNV-1a), for spotting changes. */
export function hashOf(value) {
  let h = 0x811c9dc5;
  const s = JSON.stringify(value) ?? '';
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** What a run was made of: each case, each prompt variant used, the simulated user, the rubric. */
export function fingerprint(suite, caseIds, promptVariants) {
  return {
    cases: Object.fromEntries(caseIds.map((id) => [id, hashOf(suite.cases.find((c) => c.id === id))])),
    prompts: Object.fromEntries([...new Set(promptVariants)].map((v) => [v, hashOf(suite.prompts?.[v])])),
    user: hashOf(suite.user),
    rubric: hashOf(suite.rubric),
  };
}

/**
 * Problems that make an extension a different experiment from the saved run. Runs saved before
 * fingerprints existed are checked on what they recorded: prompt texts, rubric, case titles
 * and goals (a note says beats and checks couldn't be verified).
 */
export function sameExperiment(results, suite, caseIds) {
  const m = results.meta;
  const problems = [];
  const notes = [];
  const variants = m.targets.map((t) => t.prompt ?? suite.defaultPrompt);
  for (const id of caseIds) {
    if (!m.cases.includes(id)) problems.push(`case "${id}" isn't in this run (it has: ${m.cases.join(', ')}); extending can only add repeats to cases the run already has`);
    else if (!suite.cases.some((c) => c.id === id)) problems.push(`case "${id}" is no longer in the suite`);
  }
  if (problems.length) return { problems, notes };
  const fp = m.fingerprint;
  if (fp) {
    const now = fingerprint(suite, caseIds, variants);
    for (const id of caseIds) if (fp.cases[id] !== now.cases[id]) problems.push(`case "${id}" has changed since the run (its profile, beats, checks or goal)`);
    for (const v of Object.keys(now.prompts)) if (fp.prompts[v] !== now.prompts[v]) problems.push(`the "${v}" prompt has changed since the run`);
    if (fp.user !== now.user) problems.push('the simulated user\'s instructions have changed since the run');
    if (fp.rubric !== now.rubric) problems.push('the rubric has changed since the run');
  } else {
    for (const v of variants) if (m.prompts?.[v] != null && m.prompts[v] !== suite.prompts?.[v]) problems.push(`the "${v}" prompt has changed since the run`);
    if (m.rubric && hashOf(m.rubric) !== hashOf(suite.rubric)) problems.push('the rubric has changed since the run');
    for (const id of caseIds) {
      const was = (m.caseInfo ?? []).find((c) => c.id === id);
      const is = suite.cases.find((c) => c.id === id);
      if (was && (was.title !== is.title || was.goal !== is.goal)) problems.push(`case "${id}" has changed since the run (its title or goal)`);
    }
    notes.push('This run was saved before runs recorded fingerprints, so the cases\' scripted beats, checks and the simulated user couldn\'t be verified, only the prompts, rubric, and case titles and goals.');
  }
  return { problems, notes };
}

/** Repeats each case has now (counting earlier extensions). */
export function caseRepeats(results) {
  const out = {};
  for (const c of results.conversations) out[c.case] = Math.max(out[c.case] ?? 0, (c.repeat ?? 0) + 1);
  return out;
}

/** Cases extended before (each case can be extended once). */
export const extendedCases = (results) => new Set((results.meta.extensions ?? []).flatMap((e) => e.cases));

/**
 * The plan for an extension: which cases, how many more repeats each, and where their repeat
 * numbers start. Throws with a plain explanation if it would break the guards.
 */
export function extensionPlan(results, suite, { cases, repeats }) {
  if (!Array.isArray(cases) || !cases.length) throw new Error('Name the case(s) to extend, e.g. --cases english-only');
  if (!Number.isInteger(repeats) || repeats < 1) throw new Error('--repeats must be a whole number, 1 or more: how many more conversations per case (and per target)');
  if (repeats > 10) throw new Error('At most 10 more repeats in one extension; for more, plan a new run');
  if (results.partial) throw new Error('This run stopped early (partial), so it can\'t be extended; re-run it instead');
  const { problems, notes } = sameExperiment(results, suite, cases);
  if (problems.length) throw new Error(`Extending would mix two different experiments:\n  - ${problems.join('\n  - ')}\nStart a new run instead.`);
  const done = extendedCases(results);
  const again = cases.filter((c) => done.has(c));
  if (again.length) throw new Error(`Already extended once: ${again.join(', ')}. Extending again until a case settles would make luck look like a result. Plan a new run with enough repeats instead.`);
  const have = caseRepeats(results);
  const start = Math.max(...cases.map((c) => have[c] ?? 0));
  return { cases, repeats, repeatStart: start, notes };
}

/**
 * Fold an extension's new conversations into the saved run, record it, and recompute the
 * summary (metrics, intervals, verdict, findings) with the loaded suite.
 */
export function mergeExtension(results, ext, suite, { at = new Date().toISOString() } = {}) {
  const r = structuredClone(results);
  r.conversations.push(...ext.conversations);
  r.pairs = [...(r.pairs ?? []), ...(ext.pairs ?? [])];
  const b = r.meta.budget;
  const e = ext.budget;
  b.spentUsd += e.spentUsd;
  b.calls += e.calls;
  for (const [role, usd] of Object.entries(e.byRole)) b.byRole[role] = (b.byRole[role] ?? 0) + usd;
  for (const [id, t] of Object.entries(e.byTarget)) {
    const o = (b.byTarget[id] ??= { usd: 0, replies: 0, inputTokens: 0, outputTokens: 0, ms: [] });
    o.usd += t.usd; o.replies += t.replies; o.inputTokens += t.inputTokens; o.outputTokens += t.outputTokens; o.ms = [...(o.ms ?? []), ...(t.ms ?? [])];
  }
  (r.meta.extensions ??= []).push({ at, cases: ext.cases, repeats: ext.repeats, conversations: ext.conversations.length, usd: e.spentUsd, partial: Boolean(ext.partial), stopReason: ext.stopReason ?? null, models: r.meta.targets.map((t) => t.model) });
  r.meta.caseRepeats = caseRepeats(r);
  return rescore(r, suite);
}

/**
 * How many more repeats would likely settle a case: the smallest k (up to `max`) whose interval
 * would exclude 50% even if the lead shrinks by a quarter (the observed rate moved 25% of the
 * way toward 50%). The cushion matters because each case can be extended only once. Null if
 * even `max` wouldn't (the difference may be too small to matter), or if already settled.
 */
export function settleSize(share, turnsPerRepeat, max = 5, cushion = 0.25) {
  if (!share?.n || !turnsPerRepeat) return null;
  const observed = share.a + share.tie / 2;
  const [lo0, hi0] = wilson(observed, share.n);
  if (lo0 > 0.5 || hi0 < 0.5) return null;
  const rate = 0.5 + (observed - 0.5) * (1 - cushion);
  const settled = (n) => { const [lo, hi] = wilson(rate, n); return lo > 0.5 || hi < 0.5; };
  for (let k = 1; k <= max; k++) if (settled(share.n + k * turnsPerRepeat)) return { repeats: k, turns: share.n + k * turnsPerRepeat };
  return null;
}

/** Estimated cost (USD) and time (seconds) of extending some cases by k repeats. */
export function extensionEstimate(results, nCases, repeats) {
  const m = results.meta;
  const lens = Object.values(m.prompts ?? {}).map((p) => String(p).length);
  const systemChars = lens.length ? lens.reduce((s, x) => s + x, 0) / lens.length : 2000;
  const e = estimateRun({ mode: m.mode, targets: m.targets, judge: m.judge, user: m.user, cases: nCases, turns: m.turns, repeats, systemChars, rubric: Boolean(m.rubric) });
  return { usd: e.totalUsd, seconds: e.calls * paceOf(results), calls: e.calls };
}

/** Estimated cost of extending some cases by k repeats, from the run's saved prices. */
export function extensionCost(results, nCases, repeats) {
  const m = results.meta;
  const lens = Object.values(m.prompts ?? {}).map((p) => String(p).length);
  const systemChars = lens.length ? lens.reduce((s, x) => s + x, 0) / lens.length : 2000;
  return estimateRun({ mode: m.mode, targets: m.targets, judge: m.judge, user: m.user, cases: nCases, turns: m.turns, repeats, systemChars, rubric: Boolean(m.rubric) }).totalUsd;
}
