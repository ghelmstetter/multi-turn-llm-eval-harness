// The engine's entry points, shared by the CLI and the web app: build a run plan from a loaded
// suite and targets config, estimate it, and execute it. No file access here; the CLI and the
// browser each load the suite and targets their own way.
import { makeTarget } from './targets/index.js';
import { estimateRun } from './budget.js';
import { runMirrored, runIndependent, summarize, costPerTarget, valueOf } from './run.js';
import { validateSuite } from './suite.js';
import { fingerprint } from './extend.js';
import { balanceVerdict } from './analysis.js';

/**
 * A run plan from a loaded suite and a targets config (the contents of a targets file), with
 * options in the CLI's names: mode, compare, cases, turns, repeats, mock, no-rubric, max-usd,
 * daily-usd. validate(suite, cfg) returns problems (the loaders' validateLoaded).
 */
export function buildPlan(suite, cfg, args = {}, { fetchImpl = fetch, env = {}, validate = (s, c) => validateSuite(s, c) } = {}) {
  const problems = validate(suite, cfg);
  if (problems.length) throw new Error(`The suite or targets file needs fixing:\n  - ${problems.join('\n  - ')}`);
  const mock = Boolean(args.mock);
  const mode = args.mode ?? 'mirrored';
  if (!['mirrored', 'independent'].includes(mode)) throw new Error('--mode must be mirrored or independent');
  const wanted = args.compare ? args.compare.split(',') : cfg.targets.slice(0, mode === 'mirrored' ? 2 : cfg.targets.length).map((t) => t.id);
  const targets = wanted.map((id) => {
    const t = cfg.targets.find((x) => x.id === id);
    if (!t) throw new Error(`No target "${id}" in ${args.targetsName ?? 'the targets file'}`);
    return makeTarget(t, { fetchImpl, env, mock });
  });
  const caseIds = !args.cases || args.cases === 'all' ? suite.cases.map((c) => c.id) : args.cases.split(',');
  const cases = caseIds.map((id) => suite.cases.find((c) => c.id === id) ?? (() => { throw new Error(`No case "${id}" in suite ${suite.id}`); })());
  return {
    suite, cases, targets, mode, mock,
    user: makeTarget(cfg.user, { fetchImpl, env, mock }),
    judge: makeTarget(cfg.judge, { fetchImpl, env, mock }),
    turns: Number(args.turns ?? 6),
    repeats: Number(args.repeats ?? 1),
    rubric: !args['no-rubric'],
    runCapUsd: Number(args['max-usd'] ?? 1),
    dailyCapUsd: Number(args['daily-usd'] ?? 5),
  };
}

export function estimateFor(plan) {
  const lens = plan.targets.map((t) => (plan.suite.prompts[t.prompt ?? plan.suite.defaultPrompt] ?? '').length);
  const systemChars = lens.reduce((s, x) => s + x, 0) / lens.length;
  return estimateRun({ mode: plan.mode, targets: plan.targets, judge: plan.judge, user: plan.user, cases: plan.cases.length, turns: plan.turns, repeats: plan.repeats, systemChars, rubric: plan.rubric });
}

/** Run a plan and return the full results object (also used by tests). */
export async function execute(plan, { budget, log = () => {}, version = null } = {}) {
  const startedAt = new Date().toISOString();
  const runner = plan.mode === 'mirrored' ? runMirrored : runIndependent;
  const out = await runner({ ...plan, budget, log });
  const summary = summarize({ mode: plan.mode, targets: plan.targets, suite: plan.suite, conversations: out.conversations, pairs: out.pairs });
  summary.cost = costPerTarget(plan.targets, budget.byTarget);
  if (summary.verdict) summary.verdict.value = valueOf(summary.verdict, summary.cost);
  const pick = (t) => ({ id: t.id, label: t.label, description: t.description, vendor: t.vendor, model: t.model, prompt: t.prompt, temperature: t.temperature, maxTokens: t.maxTokens, thinkingTokens: t.thinkingTokens, mockBehavior: t.mockBehavior, price: t.listPrice });
  return balanceVerdict({
    meta: {
      harnessVersion: version, startedAt, finishedAt: new Date().toISOString(), mode: plan.mode, mock: plan.mock,
      suite: { id: plan.suite.id, title: plan.suite.title, description: plan.suite.description, metrics: plan.suite.metrics, pairwiseQuestion: plan.suite.pairwiseQuestion }, roleNames: plan.suite.roleNames, rubric: plan.suite.rubric,
      promptNotes: plan.suite.promptNotes ?? {},
      prompts: Object.fromEntries([...new Set(plan.targets.map((t) => t.prompt ?? plan.suite.defaultPrompt))].map((v) => [v, plan.suite.prompts[v]])),
      caseInfo: plan.cases.map((c) => ({ id: c.id, title: c.title, goal: c.goal })),
      cases: plan.cases.map((c) => c.id), turns: plan.turns, repeats: plan.repeats,
      targets: plan.targets.map(pick), user: pick(plan.user), judge: pick(plan.judge), budget: budget.summary(),
      // What the run was made of, so `extend` can refuse if the suite has changed since.
      fingerprint: fingerprint(plan.suite, plan.cases.map((c) => c.id), plan.targets.map((t) => t.prompt ?? plan.suite.defaultPrompt)),
    },
    partial: out.partial, stopReason: out.stopReason ?? null,
    summary, conversations: out.conversations, pairs: out.pairs ?? [],
  });
}
