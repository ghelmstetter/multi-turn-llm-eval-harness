#!/usr/bin/env node
// Command line:
//   mtle estimate --suite <dir> --targets <file> [options]   show the cost estimate only
//   mtle run      --suite <dir> --targets <file> [options]   run, save results.json and report.html
//   mtle validate --suite <dir> --targets <file>               check a suite and targets file, explaining any problems
//   mtle extend   <results.json> --cases id,id --repeats N [--suite <dir>]
//                 add N more conversations per target to those cases of a saved run, then
//                 re-score it; refuses if the suite changed, and each case can be extended once
//   mtle compare  <before/results.json> <after/results.json> [--out compare.html]
//                 what changed between two runs of the same suite, and whether it's more than noise
//   mtle report   <results.json> [--suite <dir>] [--notes <file.md>] [--ratings <ratings.json>] [--publish <index.json>]
//                 re-render a report; with --suite, re-score the saved transcripts with the suite's
//                 current metrics and checks (free: no model calls); with --notes, add an
//                 analysis section written by you (or an assistant); with --ratings, add blind
//                 human ratings from the web app (optional --rater name, --rater-role "a teacher");
//                 with --publish, list the run
//                 in the web app's gallery index (optional --id, --title, and --home for the
//                 report's link back to the gallery)
// Options:
//   --mode mirrored|independent   (default mirrored)
//   --compare a,b                 target ids to compare (default: the first two)
//   --cases id,id | all           (default all)
//   --turns N                     assistant turns per conversation (default 6)
//   --repeats N                   conversations per case and target (default 1)
//   --no-rubric                   skip whole-conversation rubric judging
//   --max-usd X                   per-run cap (default 1.00)
//   --daily-usd X                 daily evaluation cap (default 5.00)
//   --mock                        use mock models: no keys, no cost (demo and tests)
//   --yes                         don't ask before running
//   --out <dir>                   output folder (default results/<timestamp>-<suite>-<mode>)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, relative, dirname, basename, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { makeTarget } from './targets/index.js';
import { Budget, estimateRun } from './budget.js';
import { runMirrored, runIndependent, summarize, costPerTarget, valueOf } from './run.js';
import { renderReport } from './report/html.js';
import { loadSuite, validateLoaded, fileSpendStore } from './load-node.js';
import { rescore } from './analysis.js';
import { runEntry, upsertIndex } from './run-index.js';
import { fingerprint, extensionPlan, mergeExtension, extensionCost } from './extend.js';
import { byCase } from './analysis.js';
import { renderComparison } from './report/compare-html.js';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const k = a.slice(2);
    if (['mock', 'yes', 'no-rubric'].includes(k)) out[k] = true;
    else out[k] = argv[++i];
  }
  return out;
}

export function loadPlan(args, { fetchImpl = fetch, env = process.env } = {}) {
  const suiteDir = resolve(args.suite ?? 'suites/tutor-es');
  const suite = loadSuite(suiteDir); // with its word list, if it has one
  const cfg = JSON.parse(readFileSync(resolve(args.targets ?? 'examples/targets.json'), 'utf8'));
  const problems = validateLoaded(suite, cfg);
  if (problems.length) throw new Error(`The suite or targets file needs fixing:\n  - ${problems.join('\n  - ')}`);
  const mock = Boolean(args.mock);
  const mode = args.mode ?? 'mirrored';
  if (!['mirrored', 'independent'].includes(mode)) throw new Error('--mode must be mirrored or independent');
  const wanted = args.compare ? args.compare.split(',') : cfg.targets.slice(0, mode === 'mirrored' ? 2 : cfg.targets.length).map((t) => t.id);
  const targets = wanted.map((id) => {
    const t = cfg.targets.find((x) => x.id === id);
    if (!t) throw new Error(`No target "${id}" in ${args.targets}`);
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
export async function execute(plan, { budget, log = () => {} } = {}) {
  const startedAt = new Date().toISOString();
  const runner = plan.mode === 'mirrored' ? runMirrored : runIndependent;
  const out = await runner({ ...plan, budget, log });
  const summary = summarize({ mode: plan.mode, targets: plan.targets, suite: plan.suite, conversations: out.conversations, pairs: out.pairs });
  summary.cost = costPerTarget(plan.targets, budget.byTarget);
  if (summary.verdict) summary.verdict.value = valueOf(summary.verdict, summary.cost);
  const pick = (t) => ({ id: t.id, label: t.label, description: t.description, vendor: t.vendor, model: t.model, prompt: t.prompt, temperature: t.temperature, maxTokens: t.maxTokens, thinkingTokens: t.thinkingTokens, mockBehavior: t.mockBehavior, price: t.listPrice });
  return {
    meta: {
      harnessVersion: VERSION, startedAt, finishedAt: new Date().toISOString(), mode: plan.mode, mock: plan.mock,
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
  };
}

const fmt = (x) => `$${x.toFixed(x < 0.1 ? 3 : 2)}`;

/** Load KEY=value lines from a .env file in the current folder (it's git-ignored), without overriding the environment. */
function loadDotEnv(file = resolve('.env')) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

async function main(argv) {
  loadDotEnv();
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (cmd === 'report') {
    const file = args._[1];
    let results = JSON.parse(readFileSync(file, 'utf8'));
    if (args.suite) {
      results = rescore(results, loadSuite(args.suite));
      writeFileSync(file, JSON.stringify(results, null, 2));
      console.log('Re-scored the saved transcripts with the suite\'s current metrics and checks.');
    }
    if (args.ratings) {
      // Blind human ratings exported from the web app's Rate tab, kept with the run.
      const ratings = JSON.parse(readFileSync(resolve(args.ratings), 'utf8'));
      if (ratings.run?.startedAt && ratings.run.startedAt !== results.meta.startedAt) throw new Error(`${args.ratings} was rated on a different run (started ${ratings.run.startedAt})`);
      if (args.rater) ratings.rater = args.rater;
      if (args['rater-role']) ratings.raterRole = args['rater-role'];
      results.meta.humanRatings = ratings;
      writeFileSync(file, JSON.stringify(results, null, 2));
      console.log(`Added ${ratings.items?.length ?? 0} blind ratings.`);
    }
    if (args.notes) {
      results.meta.notes = readFileSync(resolve(args.notes), 'utf8');
      writeFileSync(file, JSON.stringify(results, null, 2));
    }
    const outFile = /results\.json$/.test(file) ? file.replace(/results\.json$/, 'report.html') : `${file}.html`;
    // A published report links back to the gallery: the web app beside the index's folder
    // (docs/runs → docs/app), or wherever --home says.
    const home = args.publish ? (args.home ?? `${relative(dirname(resolve(outFile)), join(dirname(resolve(args.publish)), '..', 'app')).split(sep).join('/')}/#explore`) : args.home ?? null;
    writeFileSync(outFile, renderReport(results, { home }));
    console.log(`Wrote ${outFile}`);
    if (args.publish) {
      // Add the run to a gallery index (e.g. docs/runs/index.json), with paths relative to it.
      const indexFile = resolve(args.publish);
      let index = null;
      try { index = JSON.parse(readFileSync(indexFile, 'utf8')); } catch { /* a new index */ }
      const rel = (f) => relative(dirname(indexFile), resolve(f)).split(sep).join('/');
      const id = args.id ?? basename(dirname(resolve(file)));
      mkdirSync(dirname(indexFile), { recursive: true });
      writeFileSync(indexFile, `${JSON.stringify(upsertIndex(index, runEntry(results, { id, title: args.title ?? null, paths: { results: rel(file), report: rel(outFile) } })), null, 2)}\n`);
      console.log(`Listed it as "${id}" in ${args.publish}`);
    }
    return;
  }
  if (cmd === 'compare') {
    const [fa, fb] = args._.slice(1);
    if (!fa || !fb) throw new Error('Usage: compare <before/results.json> <after/results.json> [--out compare.html]');
    const [a, b] = [fa, fb].map((f) => JSON.parse(readFileSync(f, 'utf8')));
    const out = args.out ?? 'compare.html';
    writeFileSync(out, renderComparison(a, b, { titles: [args['title-a'] ?? basename(dirname(resolve(fa))), args['title-b'] ?? basename(dirname(resolve(fb)))] }));
    console.log(`Wrote ${out}`);
    return;
  }
  if (cmd === 'extend') {
    await extendRun(args);
    return;
  }
  if (cmd === 'validate') {
    loadPlan(args); // throws with every problem listed
    console.log('The suite and targets file look good.');
    return;
  }
  if (cmd !== 'run' && cmd !== 'estimate') {
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1).filter((l, i, a) => a.slice(0, i + 1).every((x) => x.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exitCode = cmd ? 1 : 0;
    return;
  }
  const plan = loadPlan(args);
  const missing = [...new Set([...plan.targets, plan.user, plan.judge].filter((t) => !t.ready).map((t) => t.keyEnv))];
  if (missing.length && cmd === 'run') throw new Error(`Missing API key: set ${missing.join(' and ')} (in the environment or a .env file), or use --mock.`);
  const est = estimateFor(plan);
  const budget = new Budget({ runCapUsd: plan.runCapUsd, dailyCapUsd: plan.dailyCapUsd, spendStore: plan.mock ? null : fileSpendStore(resolve('results')) });
  console.log(`${plan.suite.title}: ${plan.mode} mode, ${plan.cases.length} case(s) × ${plan.repeats} repeat(s) × ${plan.turns} turns`);
  console.log(`Targets: ${plan.targets.map((t) => t.id).join(' vs ')} · judge: ${plan.judge.model ?? plan.judge.vendor}${plan.mock ? ' · MOCK (no cost)' : ''}`);
  console.log(`Estimated cost: ${fmt(est.totalUsd)} (assistants ${fmt(est.assistantUsd)}, simulated user ${fmt(est.userUsd)}, judge ${fmt(est.judgeUsd)}); errs high.`);
  console.log(`Caps: ${fmt(plan.runCapUsd)} per run, ${fmt(plan.dailyCapUsd)} per day (${fmt(budget.spentBefore)} spent today).`);
  if (cmd === 'estimate') return;
  const near = est.totalUsd >= 0.8 * plan.runCapUsd || budget.spentBefore + est.totalUsd >= 0.8 * plan.dailyCapUsd;
  if (!args.yes || near) {
    if (near) console.log('The estimate is close to a cap; the run stops cleanly if a cap is reached, keeping results so far.');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ok = (await rl.question('Run it? [y/N] ')).trim().toLowerCase().startsWith('y');
    rl.close();
    if (!ok) return;
  }
  const results = await execute(plan, { budget, log: (m) => console.log(`  ${m}`) });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = resolve(args.out ?? join('results', `${stamp}-${plan.suite.id}-${plan.mode}${plan.mock ? '-mock' : ''}`));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  writeFileSync(join(dir, 'report.html'), renderReport(results));
  const c = results.summary.comparison;
  if (c && plan.mode === 'mirrored') {
    for (const t of plan.targets) console.log(`${t.id}: wins ${(c[t.id].winRate * 100).toFixed(0)}% of turns (home-field ${c[t.id].homeField == null ? '–' : `${(c[t.id].homeField * 100).toFixed(0)} pts`})`);
    console.log(`Judge position consistency: ${(c.positionConsistency * 100).toFixed(0)}%`);
  }
  const v = results.summary.verdict;
  if (v) console.log(v.strength === 'clear' ? `Winner: ${v.leader} (won ${(v.winRate * 100).toFixed(0)}% of ${v.n} ${v.unit}; 95% interval ${(v.ci[0] * 100).toFixed(0)}-${(v.ci[1] * 100).toFixed(0)}%)`
    : v.strength === 'leaning' ? `Leaning ${v.leader}, not conclusive (won ${(v.winRate * 100).toFixed(0)}% of ${v.n} ${v.unit}; interval includes 50%)` : `Too close to call (${v.n} ${v.unit})`);
  console.log(`${results.partial ? `Stopped early (${results.stopReason}). ` : ''}Spent ${fmt(budget.spent)}. Report: ${join(dir, 'report.html')}`);
}

/**
 * extend: more repeats for some cases of a saved run, appended to it. The run's own saved
 * target, user and judge settings are reused (no targets file), so it's the same experiment.
 */
async function extendRun(args) {
  const file = args._[1];
  if (!file) throw new Error('Usage: extend <results.json> --cases id,id --repeats N');
  const results = JSON.parse(readFileSync(file, 'utf8'));
  const m = results.meta;
  const suite = loadSuite(args.suite ?? join('suites', m.suite.id));
  const ext = extensionPlan(results, suite, { cases: String(args.cases ?? '').split(',').filter(Boolean), repeats: Number(args.repeats) });
  for (const n of ext.notes) console.log(`Note: ${n}`);
  const mock = Boolean(m.mock);
  if (args.mock && !mock) throw new Error('This is a real run; extending it with mock models would mix fake and real results');
  const opts = { fetchImpl: fetch, env: process.env, mock };
  const targets = m.targets.map((t) => makeTarget(t, opts));
  const user = makeTarget(m.user, opts);
  const judge = makeTarget(m.judge, opts);
  const missing = [...new Set([...targets, user, judge].filter((t) => !t.ready).map((t) => t.keyEnv))];
  if (missing.length) throw new Error(`Missing API key: set ${missing.join(' and ')} (in the environment or a .env file)`);
  const plan = { suite, cases: ext.cases.map((id) => suite.cases.find((c) => c.id === id)), targets, mode: m.mode, mock, user, judge, turns: m.turns, repeats: ext.repeats, repeatStart: ext.repeatStart, rubric: Boolean(m.rubric), runCapUsd: Number(args['max-usd'] ?? 1), dailyCapUsd: Number(args['daily-usd'] ?? 5) };
  const est = extensionCost(results, plan.cases.length, plan.repeats);
  const budget = new Budget({ runCapUsd: plan.runCapUsd, dailyCapUsd: plan.dailyCapUsd, spendStore: mock ? null : fileSpendStore(resolve('results')) });
  console.log(`Extending ${file}: ${ext.cases.join(', ')} × ${ext.repeats} more repeat(s) (repeats ${ext.repeatStart + 1}–${ext.repeatStart + ext.repeats}), ${m.turns} turns, ${m.mode} mode${mock ? ' · MOCK (no cost)' : ''}`);
  console.log(`Same models and settings as the original run: ${targets.map((t) => `${t.id} (${t.model ?? t.vendor})`).join(' vs ')}; judge ${judge.model ?? judge.vendor}.`);
  console.log(`Estimated cost: ${fmt(est)}. Caps: ${fmt(plan.runCapUsd)} per run, ${fmt(plan.dailyCapUsd)} per day (${fmt(budget.spentBefore)} spent today).`);
  console.log('Each case can be extended once, so choose the number of repeats now rather than adding a few at a time.');
  if (!args.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ok = (await rl.question('Extend it? [y/N] ')).trim().toLowerCase().startsWith('y');
    rl.close();
    if (!ok) return;
  }
  const runner = plan.mode === 'mirrored' ? runMirrored : runIndependent;
  const out = await runner({ ...plan, budget, log: (x) => console.log(`  ${x}`) });
  const merged = mergeExtension(results, { cases: ext.cases, repeats: ext.repeats, conversations: out.conversations, pairs: out.pairs ?? [], budget: budget.summary(), partial: out.partial, stopReason: out.stopReason }, suite);
  writeFileSync(file, JSON.stringify(merged, null, 2));
  const outFile = /results\.json$/.test(file) ? file.replace(/results\.json$/, 'report.html') : `${file}.html`;
  writeFileSync(outFile, renderReport(merged));
  for (const c of byCase(merged).filter((x) => ext.cases.includes(x.case))) {
    const iv = c.share?.interval;
    if (iv) console.log(`${c.case}: ${c.share.n} turns now; ${m.targets[0].id} win rate ${(iv.rate * 100).toFixed(0)}% (95% interval ${(iv.ci[0] * 100).toFixed(0)}-${(iv.ci[1] * 100).toFixed(0)}%), ${iv.settled ? 'settled' : 'not settled'}`);
  }
  console.log(`${out.partial ? `Stopped early (${out.stopReason}); kept what finished. ` : ''}Spent ${fmt(budget.spent)}. Updated ${file} and ${outFile}. (If the run is published, re-run report with --publish to refresh the gallery.)`);
}

if (import.meta.url === new URL(`file://${resolve(process.argv[1] ?? '')}`).href || process.argv[1]?.endsWith('cli.js')) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
