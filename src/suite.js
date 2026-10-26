// Checks a suite (and the targets file used with it) before anything runs, and explains each
// problem in plain words with where it is, so writing a new suite is a quick loop:
// edit, `mtle validate`, fix.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { METRIC_BETTER } from './run.js';

const VENDORS = ['gemini', 'openai', 'anthropic', 'mock'];
const isStr = (x) => typeof x === 'string' && x.trim().length > 0;

export function validateSuite(suite, targetsCfg = null, suiteDir = null) {
  const errors = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);

  for (const k of ['id', 'title', 'description']) if (!isStr(suite[k])) err(k, 'required text is missing');
  if (!suite.prompts || typeof suite.prompts !== 'object' || !Object.keys(suite.prompts).length) err('prompts', 'add at least one prompt variant, e.g. { "plain": "You are…" }');
  else for (const [k, v] of Object.entries(suite.prompts)) if (!isStr(v)) err(`prompts.${k}`, 'must be the prompt text');
  if (suite.defaultPrompt && !suite.prompts?.[suite.defaultPrompt]) err('defaultPrompt', `"${suite.defaultPrompt}" isn't one of the prompts`);
  if (!isStr(suite.user?.system)) err('user.system', 'describe how the simulated user behaves in general');
  if (!isStr(suite.pairwiseQuestion)) err('pairwiseQuestion', 'the question the judge answers when comparing two replies, e.g. "Which reply would help the user more right now?"');

  if (!Array.isArray(suite.rubric) || !suite.rubric.length) err('rubric', 'add at least one criterion: { "id": "tone", "description": "…" }');
  else suite.rubric.forEach((c, i) => {
    if (!/^[a-z][a-z0-9_]*$/.test(c?.id ?? '')) err(`rubric[${i}].id`, 'use a short id like "tone" or "policy_accuracy"');
    if (!isStr(c?.description)) err(`rubric[${i}].description`, 'say what a good score means');
  });

  const m = suite.metrics ?? {};
  for (const k of m.include ?? []) if (!(k in METRIC_BETTER)) err('metrics.include', `"${k}" isn't a metric; choose from ${Object.keys(METRIC_BETTER).join(', ')}`);
  for (const [k, rule] of Object.entries(m.better ?? {})) {
    const ok = rule === 1 || rule === -1 || (Array.isArray(rule) && rule.length === 2 && rule[0] <= rule[1]);
    if (!ok) err(`metrics.better.${k}`, 'use 1 (higher is better), -1 (lower is better) or a [low, high] range');
  }
  const used = m.include ?? Object.keys(METRIC_BETTER);
  if (used.includes('aboveLevelShare')) {
    if (!isStr(m.frequencyList)) err('metrics.frequencyList', 'the "words above level" metric needs a word list for the target language in the suite\'s folder (a .tsv of rank and word, most common first), or remove aboveLevelShare from metrics.include');
    else if (suiteDir && !existsSync(join(suiteDir, m.frequencyList))) err('metrics.frequencyList', `can't find ${m.frequencyList} in the suite's folder`);
  }

  if (!Array.isArray(suite.cases) || !suite.cases.length) err('cases', 'add at least one case');
  else {
    const seen = new Set();
    suite.cases.forEach((c, i) => {
      const w = `cases[${i}]${c?.id ? ` (${c.id})` : ''}`;
      if (!/^[a-z0-9][a-z0-9-]*$/.test(c?.id ?? '')) err(`${w}.id`, 'use a short id like "angry-customer"');
      else if (seen.has(c.id)) err(`${w}.id`, 'another case has the same id');
      seen.add(c?.id);
      if (!isStr(c?.title)) err(`${w}.title`, 'required');
      if (!isStr(c?.goal)) err(`${w}.goal`, 'say what good behavior looks like in this case (the judge reads it)');
      if (!isStr(c?.user?.profile)) err(`${w}.user.profile`, 'say who the simulated user is in this case');
      (c?.user?.beats ?? []).forEach((b, j) => {
        if (!Number.isInteger(b?.turn) || b.turn < 0) err(`${w}.user.beats[${j}].turn`, 'a whole number from 0 (0 = the user\'s first reply)');
        if (Boolean(b?.say) === Boolean(b?.do)) err(`${w}.user.beats[${j}]`, 'give exactly one of "say" (exact words) or "do" (an instruction)');
      });
      (c?.checks ?? []).forEach((k, j) => {
        if (!['absent', 'present'].includes(k?.type)) err(`${w}.checks[${j}].type`, 'use "absent" (must never appear) or "present" (must appear)');
        try { new RegExp(k?.pattern ?? '', k?.flags ?? 'i'); } catch (e) { err(`${w}.checks[${j}].pattern`, `not a valid pattern: ${e.message}`); }
        if (!isStr(k?.pattern)) err(`${w}.checks[${j}].pattern`, 'required');
      });
    });
  }

  if (targetsCfg) {
    const all = [...(targetsCfg.targets ?? []), targetsCfg.user, targetsCfg.judge];
    if (!targetsCfg.targets?.length) errors.push('targets file: add at least one target');
    if (!targetsCfg.user) errors.push('targets file: "user" (the model that plays the simulated user) is missing');
    if (!targetsCfg.judge) errors.push('targets file: "judge" is missing');
    all.filter(Boolean).forEach((t) => {
      const w = `targets file, ${t.id ?? 'a target'}`;
      if (!VENDORS.includes(t.vendor)) errors.push(`${w}: vendor must be one of ${VENDORS.join(', ')}`);
      if (t.vendor !== 'mock' && !isStr(t.model)) errors.push(`${w}: model is missing`);
      if (!t.price) errors.push(`${w}: add "price": { "input": …, "output": … } in USD per 1M tokens, or costs will show as $0`);
    });
    for (const t of targetsCfg.targets ?? []) {
      const v = t.prompt ?? suite.defaultPrompt ?? Object.keys(suite.prompts ?? {})[0];
      if (suite.prompts && !suite.prompts[v]) errors.push(`targets file, ${t.id}: prompt variant "${v}" isn't in this suite (it has: ${Object.keys(suite.prompts).join(', ')})`);
    }
  }
  return errors;
}
