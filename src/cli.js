#!/usr/bin/env node
// Command line:
//   mtle estimate --suite <dir> --targets <file> [options]   show the cost estimate only
//   mtle run      --suite <dir> --targets <file> [options]   run, save results.json and report.html
//   mtle report   <results.json>                             re-render a report
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
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { makeTarget } from './targets/index.js';
import { Budget, estimateRun } from './budget.js';
import { runMirrored, runIndependent, summarize } from './run.js';
import { renderReport } from './report/html.js';

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
  const suite = JSON.parse(readFileSync(join(suiteDir, 'suite.json'), 'utf8'));
  const cfg = JSON.parse(readFileSync(resolve(args.targets ?? 'examples/targets.json'), 'utf8'));
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
  const systemChars = Math.max(...plan.targets.map((t) => (plan.suite.prompts[t.prompt ?? plan.suite.defaultPrompt] ?? '').length)) + 600;
  return estimateRun({ mode: plan.mode, targets: plan.targets, judge: plan.judge, user: plan.user, cases: plan.cases.length, turns: plan.turns, repeats: plan.repeats, systemChars, rubric: plan.rubric });
}

/** Run a plan and return the full results object (also used by tests). */
export async function execute(plan, { budget, log = () => {} } = {}) {
  const startedAt = new Date().toISOString();
  const runner = plan.mode === 'mirrored' ? runMirrored : runIndependent;
  const out = await runner({ ...plan, budget, log });
  const summary = summarize({ mode: plan.mode, targets: plan.targets, suite: plan.suite, conversations: out.conversations, pairs: out.pairs });
  const pick = (t) => ({ id: t.id, label: t.label, vendor: t.vendor, model: t.model, prompt: t.prompt, temperature: t.temperature });
  return {
    meta: {
      harnessVersion: VERSION, startedAt, finishedAt: new Date().toISOString(), mode: plan.mode, mock: plan.mock,
      suite: { id: plan.suite.id, title: plan.suite.title }, roleNames: plan.suite.roleNames, rubric: plan.suite.rubric,
      cases: plan.cases.map((c) => c.id), turns: plan.turns, repeats: plan.repeats,
      targets: plan.targets.map(pick), user: pick(plan.user), judge: pick(plan.judge), budget: budget.summary(),
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
    const results = JSON.parse(readFileSync(file, 'utf8'));
    const outFile = file.replace(/results\.json$/, 'report.html');
    writeFileSync(outFile === file ? `${file}.html` : outFile, renderReport(results));
    console.log(`Wrote ${outFile}`);
    return;
  }
  if (cmd !== 'run' && cmd !== 'estimate') {
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 18).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exitCode = cmd ? 1 : 0;
    return;
  }
  const plan = loadPlan(args);
  const est = estimateFor(plan);
  const budget = new Budget({ runCapUsd: plan.runCapUsd, dailyCapUsd: plan.dailyCapUsd, dailyFile: plan.mock ? null : resolve('results') });
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
  console.log(`${results.partial ? `Stopped early (${results.stopReason}). ` : ''}Spent ${fmt(budget.spent)}. Report: ${join(dir, 'report.html')}`);
}

if (import.meta.url === new URL(`file://${resolve(process.argv[1] ?? '')}`).href || process.argv[1]?.endsWith('cli.js')) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
