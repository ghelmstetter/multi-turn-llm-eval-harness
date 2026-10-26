// One multi-turn conversation between the model under test (the "assistant", e.g. a tutor)
// and a simulated user who follows a semi-scripted case: fixed beats at given turns, natural
// reactions in between. Fixed beats keep conversations comparable without forcing them to be
// identical.
import { charged, BudgetExceeded } from './budget.js';

/** The assistant's view: the simulated user is 'user', the assistant itself is 'assistant'. */
export function assistantMessages(history, suite) {
  return [{ role: 'user', text: suite.kickoff ?? '[The conversation is starting. Open it.]' }, ...history.map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', text: h.text }))];
}

/** The simulated user's view is the mirror image: the assistant's turns are 'user'. */
export function userMessages(history) {
  return history.map((h) => ({ role: h.role === 'assistant' ? 'user' : 'assistant', text: h.text }));
}

export function userSystem(suite, kase, beat) {
  return [
    suite.user.system,
    `Who you are in this conversation: ${kase.user.profile}`,
    beat?.do ? `For this reply only: ${beat.do}` : '',
    'Reply with only what you would say: one or two short sentences, no stage directions, no quotation marks.',
  ].filter(Boolean).join('\n\n');
}

/** The assistant's system prompt for a target: the suite's prompt variant the target names. */
export function assistantSystem(suite, target) {
  const v = target.prompt ?? suite.defaultPrompt ?? Object.keys(suite.prompts)[0];
  const text = suite.prompts[v];
  if (!text) throw new Error(`Suite has no prompt variant "${v}" (target ${target.id})`);
  return text;
}

/**
 * Run a conversation. `assistantStep(history, turnIndex)` produces the assistant's next turn
 * (in mirrored mode it also gets and compares the rival's answer). Returns the transcript;
 * if the budget runs out mid-way, the transcript so far, marked partial.
 */
export async function runConversation({ assistantStep, user, suite, kase, turns, budget }) {
  const history = [];
  try {
    for (let t = 0; t < turns; t++) {
      const step = await assistantStep(history, t);
      history.push({ role: 'assistant', turn: t, ...step });
      if (t === turns - 1) break;
      const beat = (kase.user.beats ?? []).find((b) => b.turn === t);
      if (beat?.say) {
        history.push({ role: 'user', turn: t, text: beat.say, scripted: true });
        continue;
      }
      const out = await charged(budget, 'user', user, { purpose: 'user', system: userSystem(suite, kase, beat), messages: userMessages(history) });
      history.push({ role: 'user', turn: t, text: out.text, beat: beat?.do ?? null, usd: out.usd });
    }
    return { history, partial: false };
  } catch (e) {
    if (e instanceof BudgetExceeded) return { history, partial: true, stopReason: e.message };
    throw e;
  }
}
