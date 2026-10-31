import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTarget, parseJson } from '../src/targets/index.js';
import { Budget, BudgetExceeded, estimateRun, costOf } from '../src/budget.js';
import { conversationMetrics, nativeShare, aboveLevel, runChecks } from '../src/graders/metrics.js';
import { readFrequencyList, loadSuite } from '../src/load-node.js';
import { judgePair } from '../src/graders/judge.js';
import { runConversation, assistantMessages, userMessages } from '../src/conversation.js';
import { loadPlan, execute, estimateFor, parseArgs } from '../src/cli.js';
import { renderReport } from '../src/report/html.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fakeTarget = (replies, price = { input: 1, output: 1 }) => {
  let i = 0;
  return { id: 'fake', price, calls: [], async chat(req) { this.calls.push(req); const text = typeof replies === 'function' ? replies(req, i) : replies[i % replies.length]; i++; return { text, usage: { input: 100, output: 10 } }; } };
};

test('metrics: turn-length profile, stacked questions, English share, level, talk share', () => {
  const h = [
    { role: 'assistant', turn: 0, text: '¡Hola! ¿Cómo estás? ¿De dónde eres?' },
    { role: 'user', turn: 0, text: 'Bien. Soy de Montana.' },
    { role: 'assistant', turn: 1, text: 'That is great, and in Spanish there are many ways to say where you are from, which we can practice together today if you like, so tell me about your town and what you do there every day.' },
  ];
  const m = conversationMetrics(h, { maxWords: 30 });
  assert.equal(m.turns, 2);
  assert.equal(m.monologues, 1);
  assert.equal(m.stackedQuestions, 1);
  assert.ok(m.nativeShare > 0.5);
  assert.ok(m.userTalkShare > 0 && m.userTalkShare < 0.2);
  assert.equal(nativeShare('¿Qué quieres hacer hoy?'), 0);
  const al = aboveLevel('Me encanta la jurisprudencia. Ana vive en Bozeman. That sounds great!', { levelRank: 2000, ranks: readFrequencyList('suites/tutor-es/es-frequency.tsv') });
  assert.equal(aboveLevel('hola', {}).share, null, 'no word list, no measurement');
  assert.deepEqual(al.words, ['jurisprudencia'], 'names and English are skipped');
});

test('case checks pass or fail by pattern and turn', () => {
  const h = [{ role: 'assistant', turn: 0, text: 'Hello!' }, { role: 'assistant', turn: 1, text: "Wow, you're fluent!" }];
  const [a, b] = runChecks(h, [
    { id: 'no-fluent', type: 'absent', pattern: "you'?re fluent" },
    { id: 'greets', type: 'present', pattern: 'hello', fromTurn: 1 },
  ]);
  assert.deepEqual([a.pass, a.turns], [false, [1]]);
  assert.equal(b.pass, false);
});

test('vendor adapters send the right request shape and read usage', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    if (url.includes('generativelanguage')) return json({ candidates: [{ content: { parts: [{ text: 'hola' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, thoughtsTokenCount: 2 } });
    if (url.includes('openai')) return json({ choices: [{ message: { content: 'hola' } }], usage: { prompt_tokens: 10, completion_tokens: 3 } });
    return json({ content: [{ type: 'text', text: 'hola' }], usage: { input_tokens: 10, output_tokens: 3 } });
  };
  const env = { GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' };
  const req = { system: 'sys', messages: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hola' }, { role: 'user', text: '¿qué?' }] };
  const g = await makeTarget({ id: 'g', vendor: 'gemini', model: 'm1' }, { fetchImpl, env }).chat(req);
  assert.deepEqual(g.usage, { input: 10, output: 5 }, 'thinking tokens count as output');
  assert.deepEqual(calls[0].body.contents.map((c) => c.role), ['user', 'model', 'user']);
  assert.equal(calls[0].body.systemInstruction.parts[0].text, 'sys');
  await makeTarget({ id: 'o', vendor: 'openai', model: 'm2' }, { fetchImpl, env }).chat({ ...req, json: true });
  assert.equal(calls[1].body.messages[0].role, 'system');
  assert.deepEqual(calls[1].body.response_format, { type: 'json_object' });
  const a = await makeTarget({ id: 'a', vendor: 'anthropic', model: 'm3' }, { fetchImpl, env }).chat(req);
  assert.equal(calls[2].headers['x-api-key'], 'a');
  assert.equal(calls[2].body.system, 'sys');
  assert.equal(a.text, 'hola');
  await assert.rejects(makeTarget({ id: 'x', vendor: 'openai', model: 'm' }, { fetchImpl, env: {} }).chat(req), /OPENAI_API_KEY/);
});

test('rate limits are retried; other errors are not', async () => {
  let n = 0;
  const flaky = async () => (++n < 3 ? new Response('slow down', { status: 429 }) : json({ choices: [{ message: { content: 'ok' } }], usage: {} }));
  const t = makeTarget({ id: 'o', vendor: 'openai', model: 'm' }, { fetchImpl: flaky, env: { OPENAI_API_KEY: 'k' }, retry: { baseMs: 1 } });
  assert.equal((await t.chat({ messages: [{ role: 'user', text: 'x' }] })).text, 'ok');
  assert.equal(n, 3);
  const bad = makeTarget({ id: 'o', vendor: 'openai', model: 'm' }, { fetchImpl: async () => new Response('nope', { status: 400 }), env: { OPENAI_API_KEY: 'k' }, retry: { baseMs: 1 } });
  await assert.rejects(bad.chat({ messages: [{ role: 'user', text: 'x' }] }), /400/);
});

test('parseJson tolerates code fences and surrounding text', () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJson('Sure! {"winner": "2"} hope that helps'), { winner: '2' });
});

test('pairwise judging runs both orders; a position-biased judge yields ties', async () => {
  const budget = new Budget({ runCapUsd: 10 });
  const alwaysFirst = fakeTarget(['{"winner":"1","reason":"first looks fine"}']);
  const v = await judgePair({ judge: alwaysFirst, budget, question: 'q', context: 'c', a: 'short', b: 'a much longer reply' });
  assert.equal(alwaysFirst.calls.length, 2);
  assert.match(alwaysFirst.calls[1].messages[0].text, /REPLY 1:\na much longer reply/, 'second call swaps the order');
  assert.deepEqual([v.winner, v.consistent, v.votes], ['tie', false, ['A', 'B']]);
  const fair = fakeTarget((req) => (/REPLY 1:\nshort/.test(req.messages[0].text) ? '{"winner":"1"}' : '{"winner":"2"}'));
  const w = await judgePair({ judge: fair, budget, question: 'q', context: 'c', a: 'short', b: 'long one' });
  assert.deepEqual([w.winner, w.consistent], ['A', true]);
  assert.deepEqual(w.lengths, { A: 1, B: 2 });
});

test('budget: charges by role, stops a run cleanly at the cap, keeps the partial transcript', async () => {
  assert.equal(costOf({ input: 1, output: 2 }, { input: 1e6, output: 1e6 }), 3);
  const budget = new Budget({ runCapUsd: 0.0003 });
  const tutor = fakeTarget(['¿Qué tal?']);
  const user = fakeTarget(['Bien.']);
  const suite = { prompts: { p: 'x' }, user: { system: 'u' } };
  const kase = { user: { profile: 'p' } };
  const step = async (history) => { budget.check(); const o = await tutor.chat({ messages: assistantMessages(history, suite) }); budget.charge('assistant', tutor.price, o.usage); return { text: o.text }; };
  const out = await runConversation({ assistantStep: step, user, suite, kase, turns: 10, budget });
  assert.equal(out.partial, true);
  assert.match(out.stopReason, /Run cap/);
  assert.ok(out.history.length > 0 && out.history.length < 19);
  assert.ok(budget.byRole.assistant > 0 && budget.byRole.user > 0);
  assert.throws(() => budget.check(), BudgetExceeded);
});

test('conversation views: kickoff, role mirroring, scripted beats', async () => {
  const suite = { kickoff: '[start]', prompts: { p: 'x' }, user: { system: 'u' } };
  const h = [{ role: 'assistant', text: 'Hola' }, { role: 'user', text: 'Hi' }];
  assert.deepEqual(assistantMessages(h, suite).map((m) => m.role), ['user', 'assistant', 'user']);
  assert.deepEqual(userMessages(h).map((m) => m.role), ['user', 'assistant']);
  const user = fakeTarget(['natural reply']);
  const budget = new Budget({ runCapUsd: 10 });
  const kase = { user: { profile: 'p', beats: [{ turn: 0, say: 'Yo es Pat.' }, { turn: 1, do: 'Use yo es again.' }] } };
  const out = await runConversation({ assistantStep: async () => ({ text: '¿Sí?' }), user, suite, kase, turns: 3, budget });
  assert.deepEqual(out.history.filter((x) => x.role === 'user').map((x) => x.text), ['Yo es Pat.', 'natural reply']);
  assert.match(user.calls[0].system, /For this reply only: Use yo es again\./);
});

test('mirrored mock run: balanced tracks, shadow answers, win rates and home-field effect', async () => {
  const plan = loadPlan(parseArgs(['--suite', 'suites/tutor-es', '--targets', 'examples/targets.json', '--mock', '--cases', 'baseline,repeated-mistake', '--turns', '3']));
  const results = await execute(plan, { budget: new Budget({ runCapUsd: 1 }) });
  assert.equal(results.conversations.length, 4, '2 cases x 2 tracks');
  assert.deepEqual(results.conversations.map((c) => c.main), ['flash-plain', 'flash-coached', 'flash-plain', 'flash-coached']);
  const turn = results.conversations[0].history.find((h) => h.role === 'assistant');
  assert.equal(turn.by, 'flash-plain');
  assert.equal(turn.shadow.by, 'flash-coached');
  const c = results.summary.comparison;
  assert.equal(c.turnsCompared, 12);
  assert.ok(c['flash-coached'].winRate > c['flash-plain'].winRate, 'the mock judge prefers the concise tutor');
  assert.ok(Math.abs(c['flash-coached'].winRate + c['flash-plain'].winRate - 1) < 1e-9);
  assert.equal(typeof c['flash-plain'].homeField, 'number');
  assert.ok(results.conversations.every((x) => x.rubric && x.metrics && Array.isArray(x.checks)));
  assert.equal(results.meta.mock, true);
  const html = renderReport(results);
  assert.match(html, /Mock run/);
  assert.match(html, /Home-field effect/);
});

test('independent mock run: own conversations per target, whole-transcript pairs', async () => {
  const plan = loadPlan(parseArgs(['--mock', '--mode', 'independent', '--cases', 'praise-fishing', '--turns', '3', '--repeats', '2']));
  const results = await execute(plan, { budget: new Budget({ runCapUsd: 1 }) });
  assert.equal(results.conversations.length, 4);
  assert.equal(results.pairs.length, 2);
  assert.equal(results.summary.comparison.conversationsCompared, 2);
  assert.ok(results.summary.targets['flash-plain'].checksTotal > 0);
  assert.match(renderReport(results), /Which whole conversation was better/);
});

test('estimates grow with turns, repeats and mode, and are zero for mock targets', () => {
  const real = loadPlan(parseArgs(['--turns', '4']), { env: {} });
  const a = estimateFor(real);
  const b = estimateFor({ ...real, turns: 8 });
  const c = estimateFor({ ...real, repeats: 3 });
  assert.ok(a.totalUsd > 0 && b.totalUsd > a.totalUsd && c.totalUsd > a.totalUsd * 2.5);
  const ind = estimateRun({ mode: 'independent', targets: real.targets, judge: real.judge, user: real.user, cases: 7, turns: 4, repeats: 1 });
  assert.ok(ind.totalUsd < a.totalUsd, 'independent runs make fewer calls than mirrored ones');
  assert.equal(estimateFor(loadPlan(parseArgs(['--mock']))).totalUsd, 0);
});

test('verdict: clear / leaning / too close, with a confidence interval and supporting evidence', async () => {
  const { verdict, wilson, metricScore } = await import('../src/run.js');
  const [lo, hi] = wilson(0.5, 20);
  assert.ok(lo < 0.5 && hi > 0.5);
  assert.equal(metricScore(0, [0.1, 0.4]) < metricScore(0.2, [0.1, 0.4]), true, 'a range prefers values inside it');
  const targets = [{ id: 'x' }, { id: 'y' }];
  const perTarget = { x: { rubricMean: 4, metrics: { nativeShare: 0.2, wordsMedian: 12 }, checksPassed: 1, checksTotal: 1 }, y: { rubricMean: 3, metrics: { nativeShare: 0, wordsMedian: 30 }, checksPassed: 0, checksTotal: 1 } };
  const v = (rate, n) => verdict({ mode: 'mirrored', targets, perTarget, comparison: { turnsCompared: n, x: { winRate: rate }, y: { winRate: 1 - rate } }, better: { nativeShare: [0.1, 0.4], wordsMedian: -1 } });
  assert.equal(v(0.9, 40).strength, 'clear');
  assert.equal(v(0.9, 40).winner, 'x');
  assert.deepEqual(v(0.9, 40).metricWins.x.sort(), ['nativeShare', 'wordsMedian']);
  assert.equal(v(0.6, 10).strength, 'leaning');
  assert.equal(v(0.6, 10).winner, 'x');
  assert.equal(v(0.5, 10).strength, 'tie');
  assert.equal(v(0.5, 10).winner, null);
  assert.equal(v(0.2, 40).leader, 'y', 'the leader can be either target');
  assert.equal(v(0.2, 40).rubricLead, 'x', 'and the rubric can disagree');
});

test('suite validation explains problems, and both example suites pass', async () => {
  const { validateSuite } = await import('../src/suite.js');
  const { readFileSync } = await import('node:fs');
  const cfg = JSON.parse(readFileSync('examples/targets.json', 'utf8'));
  for (const s of ['tutor-es', 'support-bikes']) assert.deepEqual(validateSuite(JSON.parse(readFileSync(`suites/${s}/suite.json`, 'utf8')), cfg), [], s);
  const bad = { id: 'x', title: 't', prompts: { a: 'hi' }, user: {}, rubric: [{ id: 'Tone' }], cases: [{ id: 'c', title: 'T', user: { profile: 'p', beats: [{ turn: 0, say: 'a', do: 'b' }] }, checks: [{ type: 'absent', pattern: '(' }] }] };
  const errs = validateSuite(bad, cfg).join('\n');
  for (const re of [/description: required/, /user\.system/, /rubric\[0\]\.id/, /cases\[0\] \(c\)\.goal/, /exactly one of "say"/, /not a valid pattern/, /prompt variant "plain" isn't in this suite/]) assert.match(errs, re);
});

test('a non-tutor suite runs with its own metrics, and reports latency', async () => {
  const plan = loadPlan(parseArgs(['--suite', 'suites/support-bikes', '--mock', '--cases', 'late-return,discount-injection', '--turns', '3']));
  const results = await execute(plan, { budget: new Budget({ runCapUsd: 1 }) });
  assert.deepEqual(Object.keys(results.summary.better).sort(), ['monologues', 'stackedQuestions', 'wordsMedian', 'wordsP90']);
  assert.ok(results.summary.cost['flash-plain'].latencyMedianMs > 0);
  assert.ok(results.summary.verdict.value.speed);
  const html = renderReport(results);
  assert.match(html, /Typical response time/);
  assert.doesNotMatch(html.split('id="glossary"')[0], /English share|Learner's share/);
});

test('word lists with Windows line endings (CRLF) read the same as Unix ones', async () => {
  const { readFileSync, writeFileSync, mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const crlf = join(mkdtempSync(join(tmpdir(), 'mtle-')), 'list.tsv');
  writeFileSync(crlf, readFileSync('suites/tutor-es/es-frequency.tsv', 'utf8').replace(/\r?\n/g, '\r\n'));
  assert.deepEqual(aboveLevel('Me encanta la jurisprudencia.', { levelRank: 2000, ranks: readFrequencyList(crlf) }).words, ['jurisprudencia']);
});

test('re-scoring a saved run, findings, and analysis notes', async () => {
  const { rescore, findings, byCase, markdownToHtml } = await import('../src/analysis.js');
  const plan = loadPlan(parseArgs(['--mock', '--cases', 'baseline,praise-fishing', '--turns', '3']));
  const results = JSON.parse(JSON.stringify(await execute(plan, { budget: new Budget({ runCapUsd: 1 }) })));
  for (const c of results.conversations) c.checks = []; // as if the checks had changed since the run
  const re = rescore(results, loadSuite('suites/tutor-es'));
  assert.ok(re.conversations.some((c) => c.checks.length), 'checks re-run from the suite');
  assert.ok(re.meta.rescoredAt);
  assert.equal(byCase(re).length, 2);
  assert.ok(findings(re).some((f) => f.kind === 'metrics'));
  assert.match(markdownToHtml('## Title\n\n- **one** item\n- *two*'), /<h4>Title<\/h4>[\s\S]*<li><b>one<\/b> item<\/li><li><i>two<\/i><\/li>/);
  re.meta.notes = '## What happened\n\nThe coached prompt won.';
  const html = renderReport(re);
  assert.match(html, /Analysis and recommendations/);
  assert.match(html, /<h1>Multi-Turn LLM Eval Harness<\/h1>/);
  assert.match(html, /By case/);
});

test('the browser loader gives the same results as the Node loader', async () => {
  const { readFileSync } = await import('node:fs');
  const { rescore } = await import('../src/analysis.js');
  // Stand-ins for the browser's location and fetch, serving files from the repo.
  const saved = { fetch: globalThis.fetch, location: globalThis.location };
  globalThis.location = { href: 'http://local.test/app/' };
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname.slice(1);
    try { const text = readFileSync(path, 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text }; } catch { return { ok: false, status: 404 }; }
  };
  try {
    const web = await import('../src/load-browser.js');
    const suite = await web.loadSuite('/suites/tutor-es/');
    assert.ok(suite._frequencyRanks?.size > 1000, 'word list attached');
    assert.deepEqual(web.validateLoaded(suite), []);
    const sample = () => JSON.parse(readFileSync('docs/sample-report/results.json', 'utf8'));
    const a = rescore(sample(), loadSuite('suites/tutor-es'));
    const b = rescore(sample(), suite);
    assert.deepEqual(b.summary, a.summary);
    assert.deepEqual(b.conversations.map((c) => c.metrics), a.conversations.map((c) => c.metrics));
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.location === undefined) delete globalThis.location; else globalThis.location = saved.location;
  }
});

test('the run index lists published runs, newest first, replacing by id', async () => {
  const { readFileSync } = await import('node:fs');
  const { runEntry, upsertIndex } = await import('../src/run-index.js');
  const results = JSON.parse(readFileSync('docs/sample-report/results.json', 'utf8'));
  const e = runEntry(results, { id: 'first', paths: { results: 'r.json', report: 'r.html' } });
  assert.equal(e.verdict.strength, 'leaning');
  assert.equal(e.verdict.leaderLabel, 'Gemini Flash, coached prompt');
  assert.equal(e.targets.length, 2);
  let idx = upsertIndex(null, e);
  idx = upsertIndex(idx, { ...e, id: 'later', date: '2027-01-01T00:00:00Z' });
  idx = upsertIndex(idx, { ...e, title: 'renamed' });
  assert.deepEqual(idx.runs.map((r) => r.id), ['later', 'first']);
  assert.equal(idx.runs[1].title, 'renamed');
});

test('a daily spend store carries spending across runs', () => {
  let kept = 0.5;
  const budget = new Budget({ runCapUsd: 1, dailyCapUsd: 0.6, spendStore: { read: () => kept, write: (usd) => { kept = usd; } } });
  assert.equal(budget.spentToday, 0.5);
  budget.charge('assistant', { input: 1e6, output: 0 }, { input: 0.2, output: 0 });
  assert.ok(Math.abs(kept - 0.7) < 1e-9);
  assert.throws(() => budget.check(), /Daily evaluation cap/);
});

test('blind rating: items, a balanced repeatable sample, and judge-vs-human agreement', async () => {
  const { readFileSync } = await import('node:fs');
  const { ratingItems, sampleItems, agreement } = await import('../src/ratings.js');
  const results = JSON.parse(readFileSync('docs/sample-report/results.json', 'utf8'));
  const items = ratingItems(results);
  assert.equal(items.length, 84, 'every judged turn of the sample run');
  assert.equal(Object.keys(items[0].replies).length, 2);
  const s = sampleItems(items, 42, 7);
  assert.equal(s.length, 42);
  assert.deepEqual(sampleItems(items, 42, 7), s, 'same seed, same sample');
  const perCase = {};
  for (const x of s) { const c = x.key.split('|')[0]; perCase[c] = (perCase[c] ?? 0) + 1; }
  assert.deepEqual(Object.values(perCase), Array(7).fill(6), 'balanced across the 7 cases');
  assert.ok(s.some((x) => x.order[0] === 'flash-plain') && s.some((x) => x.order[0] === 'flash-coached'), 'reply order varies');
  const everything = sampleItems(items, 999, 3);
  assert.equal(everything.length, 77, 'each case\'s twin first turn is rated once (84 - 7)');
  const ctx = new Set(everything.map((x) => { const it = items.find((i) => i.key === x.key); return `${it.case}${JSON.stringify(it.context)}`; }));
  assert.equal(ctx.size, 77, 'no two sampled turns share a context');
  // A rater who always agrees with the judge, except on one turn they skip and one they flip.
  const byKey = new Map(items.map((it) => [it.key, it]));
  const picks = s.map((x, i) => ({ key: x.key, pick: i === 0 ? 'skip' : i === 1 ? (byKey.get(x.key).judge.winner === 'flash-plain' ? 'flash-coached' : 'flash-plain') : byKey.get(x.key).judge.winner }));
  const a = agreement(results, { items: picks });
  assert.equal(a.n, 41, 'skips are left out');
  assert.equal(a.overall.k, 40);
  assert.equal(a.disagreements.length, 1);
  assert.ok(a.overall.ci[0] < a.overall.rate && a.overall.rate < a.overall.ci[1]);
  assert.equal(a.byCase.reduce((t, c) => t + c.n, 0), 41);
  assert.ok(Math.abs(a.human.a + a.human.tie + a.human.b - 1) < 1e-9);
});

test('a report with blind ratings shows the judge-vs-human section', async () => {
  const { readFileSync } = await import('node:fs');
  const { ratingItems } = await import('../src/ratings.js');
  const results = JSON.parse(readFileSync('docs/sample-report/results.json', 'utf8'));
  delete results.meta.humanRatings; // the sample run ships with real ratings
  assert.doesNotMatch(renderReport(results), /Judge vs\. human/);
  const items = ratingItems(results).slice(0, 10).map((it) => ({ key: it.key, pick: it.judge.winner }));
  results.meta.humanRatings = { rater: 'Test', items };
  const html = renderReport(results);
  assert.match(html, /Judge vs\. human/);
  assert.match(html, /Test rated 10 turns blind/);
  assert.match(html, /100%/);
});

test('what each rater preferred: longer replies, and more native language', async () => {
  const { readFileSync } = await import('node:fs');
  const { ratingItems, preferences } = await import('../src/ratings.js');
  const { nativeShare: ns } = await import('../src/graders/metrics.js');
  const results = JSON.parse(readFileSync('docs/sample-report/results.json', 'utf8'));
  // A rater who always picks the reply with more English.
  const items = ratingItems(results).map((it) => { const [x, y] = Object.keys(it.replies); return { key: it.key, pick: ns(it.replies[x]) >= ns(it.replies[y]) ? x : y }; });
  const p = preferences(results, { items });
  assert.deepEqual(p.map((x) => x.id), ['longer', 'native']);
  const native = p.find((x) => x.id === 'native');
  assert.equal(native.human.rate, 1);
  assert.ok(native.judge.rate < 0.6, 'the judge does not share that preference');
  assert.match(renderReport({ ...results, meta: { ...results.meta, humanRatings: { items } } }), /What each rater preferred/);
});

test('extending a run: same experiment only, once per case, merged and re-scored', async () => {
  const { extensionPlan, mergeExtension, settleSize, caseRepeats } = await import('../src/extend.js');
  const { runMirrored } = await import('../src/run.js');
  const plan = loadPlan(parseArgs(['--mock', '--cases', 'baseline,english-only', '--turns', '3']));
  const results = JSON.parse(JSON.stringify(await execute(plan, { budget: new Budget({ runCapUsd: 1 }) })));
  const suite = loadSuite('suites/tutor-es');
  const ext = extensionPlan(results, suite, { cases: ['english-only'], repeats: 2 });
  assert.equal(ext.repeatStart, 1);
  const budget = new Budget({ runCapUsd: 1 });
  const out = await runMirrored({ ...plan, cases: [plan.cases[1]], repeats: 2, repeatStart: 1, budget });
  const merged = mergeExtension(results, { cases: ['english-only'], repeats: 2, conversations: out.conversations, budget: budget.summary() }, suite);
  assert.deepEqual(caseRepeats(merged), { baseline: 1, 'english-only': 3 });
  assert.equal(merged.summary.comparison.turnsCompared, 3 * 3 * 2 + 3 * 2, 'english-only now has 3 repeats, baseline 1');
  assert.equal(merged.meta.budget.calls, results.meta.budget.calls + budget.calls);
  assert.match(renderReport(merged), /Extended/);
  // Guards
  assert.throws(() => extensionPlan(merged, suite, { cases: ['english-only'], repeats: 1 }), /Already extended once/);
  assert.throws(() => extensionPlan(results, suite, { cases: ['praise-fishing'], repeats: 1 }), /isn't in this run/);
  const changed = structuredClone(suite);
  changed.prompts.coached += ' Be brief.';
  assert.throws(() => extensionPlan(results, changed, { cases: ['baseline'], repeats: 1 }), /"coached" prompt has changed/);
  changed.prompts.coached = suite.prompts.coached;
  changed.cases.find((c) => c.id === 'baseline').goal += ' Also check the weather.';
  assert.throws(() => extensionPlan(results, changed, { cases: ['baseline'], repeats: 1 }), /case "baseline" has changed/);
  // Suggested size: a 71% case of 12 turns needs a few more repeats; a 50% case can't settle.
  assert.equal(settleSize({ a: 8 / 12, tie: 1 / 12, b: 3 / 12, n: 12 }, 12).repeats, 3);
  assert.equal(settleSize({ a: 0.5, tie: 0, b: 0.5, n: 12 }, 12), null);
});

test('comparing two runs: matchup, overall and per-case change, and when it is more than noise', async () => {
  const { readFileSync } = await import('node:fs');
  const { compareRuns, matchup, diffInterval } = await import('../src/compare.js');
  const { rescore } = await import('../src/analysis.js');
  const a = JSON.parse(readFileSync('docs/sample-report/results.json', 'utf8'));
  // An "after" run: the challenger renamed, and two cases swung its way.
  const b = JSON.parse(JSON.stringify(a).replaceAll('flash-coached', 'flash-v2'));
  for (const c of b.conversations) if (c.case === 'english-only') for (const h of c.history) if (h.verdict) h.verdict.winner = 'flash-v2';
  rescore(b, loadSuite('suites/tutor-es'));
  assert.deepEqual(matchup(a, b), { ok: true, kind: 'swap', baseline: 'flash-plain', challengerA: 'flash-coached', challengerB: 'flash-v2' });
  const c = compareRuns(a, b);
  const eng = c.cases.find((x) => x.case === 'english-only');
  assert.equal(eng.after.rate, 1);
  assert.ok(eng.flipped && eng.real, 'from losing the case to winning it, beyond noise');
  assert.ok(!c.cases.find((x) => x.case === 'baseline').real, 'unchanged case: within noise');
  assert.ok(c.overall.diff > 0);
  const same = compareRuns(a, a);
  assert.equal(same.kind, 'same');
  assert.equal(same.overall.diff, 0);
  assert.ok(!same.overall.real);
  assert.equal(matchup(a, { ...a, meta: { ...a.meta, suite: { id: 'support-bikes' } } }).ok, false);
  const [lo, hi] = diffInterval(0.5, 100, 0.7, 100);
  assert.ok(lo > 0 && hi < 0.4, 'a 20-point change on 100 turns each is more than noise');
  assert.match(renderReport(a), /How to settle the unsettled cases/);
});
