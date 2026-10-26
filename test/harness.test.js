import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTarget, parseJson } from '../src/targets/index.js';
import { Budget, BudgetExceeded, estimateRun, costOf } from '../src/budget.js';
import { conversationMetrics, nativeShare, aboveLevel, runChecks } from '../src/graders/metrics.js';
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
  const al = aboveLevel('Me encanta la jurisprudencia. Ana vive en Bozeman. That sounds great!', { levelRank: 2000 });
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
