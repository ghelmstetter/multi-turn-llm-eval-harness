// LLM judges, with controls for their known biases:
//  - Length: judges tend to favor longer answers. Rubrics explicitly reward brevity where it
//    fits, and every score is reported next to the output's length.
//  - Position: judges tend to favor whichever option comes first. Pairwise comparisons run in
//    both orders; if the two verdicts disagree, the result is a tie, and the rate of
//    disagreement is reported as the judge's position consistency.
//  - Self-preference: judges tend to favor their own vendor's models. Use a judge from a third
//    vendor where possible; the report names the judge model.
// Every score must come with a reason.
import { charged } from '../budget.js';
import { parseJson } from '../targets/index.js';

const wordCount = (t) => String(t ?? '').split(/\s+/).filter(Boolean).length;

export function transcriptText(history, suite) {
  const A = (suite.roleNames?.assistant ?? 'assistant').toUpperCase();
  const U = (suite.roleNames?.user ?? 'user').toUpperCase();
  return history.map((h) => `${h.role === 'assistant' ? A : U}: ${h.text}`).join('\n');
}

const RUBRIC_SYSTEM = `You are a careful, skeptical evaluator of conversations. You score against a rubric, citing specific turns.
Longer is not better: reward brevity whenever a short reply serves the user. Do not reward flattery or filler.
Reply with only a JSON object.`;

/** Score a whole conversation against the suite's rubric. Returns { scores: { id: { score, why } }, summary }. */
export async function judgeRubric({ judge, budget, suite, kase, history }) {
  const criteria = suite.rubric;
  const prompt = `Context: ${suite.description}
This case: ${kase.title}. What good behavior looks like here: ${kase.goal}

Transcript:
${transcriptText(history, suite)}

Score the ${(suite.roleNames?.assistant ?? 'assistant').toUpperCase()} on each criterion from 1 (poor) to 5 (excellent):
${criteria.map((c) => `- ${c.id}: ${c.description}`).join('\n')}

Return JSON: {"scores": {${criteria.map((c) => `"${c.id}": {"score": 1-5, "why": "one or two sentences citing turns"}`).join(', ')}}, "summary": "one sentence"}`;
  const out = await charged(budget, 'judge', judge, {
    purpose: 'rubric', criteria, assistantLabel: (suite.roleNames?.assistant ?? 'assistant').toUpperCase(),
    system: RUBRIC_SYSTEM, messages: [{ role: 'user', text: prompt }], json: true,
  });
  const data = parseJson(out.text);
  const scores = {};
  for (const c of criteria) {
    const s = Number(data?.scores?.[c.id]?.score);
    scores[c.id] = { score: Number.isFinite(s) ? Math.max(1, Math.min(5, s)) : null, why: String(data?.scores?.[c.id]?.why ?? '') };
  }
  return { scores, summary: String(data?.summary ?? ''), usd: out.usd };
}

const PAIR_SYSTEM = `You compare two candidate replies and pick the better one. Judge substance, not length: a shorter reply that serves the user better wins.
The order of the replies is random and means nothing. Reply with only a JSON object.`;

async function pairOnce({ judge, budget, question, context, first, second }) {
  const prompt = `${context}

REPLY 1:
${first}

REPLY 2:
${second}

WHICH reply is better? ${question}
Return JSON: {"winner": "1" or "2", "reason": "one sentence"}`;
  const out = await charged(budget, 'judge', judge, { purpose: 'pairwise', system: PAIR_SYSTEM, messages: [{ role: 'user', text: prompt }], json: true });
  const data = parseJson(out.text);
  const w = String(data?.winner ?? '').trim();
  return { pick: w === '1' ? 'first' : w === '2' ? 'second' : null, reason: String(data?.reason ?? '') };
}

/**
 * Compare reply A with reply B, in both orders. Returns
 * { winner: 'A' | 'B' | 'tie', consistent, reasons: [ab, ba], lengths: { A, B } }.
 */
export async function judgePair({ judge, budget, question, context, a, b }) {
  const ab = await pairOnce({ judge, budget, question, context, first: a, second: b });
  const ba = await pairOnce({ judge, budget, question, context, first: b, second: a });
  const v1 = ab.pick === 'first' ? 'A' : ab.pick === 'second' ? 'B' : null;
  const v2 = ba.pick === 'first' ? 'B' : ba.pick === 'second' ? 'A' : null;
  const consistent = v1 != null && v1 === v2;
  return { winner: consistent ? v1 : 'tie', consistent, votes: [v1, v2], reasons: [ab.reason, ba.reason], lengths: { A: wordCount(a), B: wordCount(b) } };
}

/** Pairwise context for one turn: the conversation so far, from the assistant's side. */
export function turnContext(history, suite, kase) {
  const A = (suite.roleNames?.assistant ?? 'assistant').toUpperCase();
  return `Context: ${suite.description}
This case: ${kase.title}. What good behavior looks like: ${kase.goal}

Conversation so far:
${transcriptText(history, suite) || '(nothing yet: this is the opening turn)'}

Below are two candidate next turns for the ${A}.`;
}
