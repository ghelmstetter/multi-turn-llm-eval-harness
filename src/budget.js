// Spending: every model call is charged to a budget with a per-run cap and a daily cap.
// Repeats, mirrored runs and judge calls multiply cost quickly, so a run shows an estimate
// first and stops cleanly (keeping its results, marked partial) if a cap is reached.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export class BudgetExceeded extends Error {}

export const costOf = (price, usage) => ((usage?.input ?? 0) * (price?.input ?? 0) + (usage?.output ?? 0) * (price?.output ?? 0)) / 1e6;

export class Budget {
  /** dailyFile: where today's evaluation spend is kept (null = don't track across runs). */
  constructor({ runCapUsd = 1, dailyCapUsd = 5, dailyFile = null, today = new Date().toISOString().slice(0, 10) } = {}) {
    this.runCapUsd = runCapUsd;
    this.dailyCapUsd = dailyCapUsd;
    this.file = dailyFile ? join(dailyFile, `spend-${today}.json`) : null;
    this.spentBefore = this.file ? readSpend(this.file) : 0;
    this.spent = 0;
    this.byRole = {};
    this.byTarget = {}; // the models under test: what each costs per reply
    this.calls = 0;
  }

  get spentToday() { return this.spentBefore + this.spent; }

  /** Throws BudgetExceeded before a call if either cap is already reached. */
  check() {
    if (this.spent >= this.runCapUsd) throw new BudgetExceeded(`Run cap of $${this.runCapUsd.toFixed(2)} reached`);
    if (this.spentToday >= this.dailyCapUsd) throw new BudgetExceeded(`Daily evaluation cap of $${this.dailyCapUsd.toFixed(2)} reached`);
  }

  charge(role, price, usage, targetId = null) {
    const usd = costOf(price, usage);
    this.spent += usd;
    this.calls += 1;
    this.byRole[role] = (this.byRole[role] ?? 0) + usd;
    if (role === 'assistant' && targetId) {
      const t = (this.byTarget[targetId] ??= { usd: 0, replies: 0, inputTokens: 0, outputTokens: 0 });
      t.usd += usd;
      t.replies += 1;
      t.inputTokens += usage?.input ?? 0;
      t.outputTokens += usage?.output ?? 0;
    }
    if (this.file) writeSpend(this.file, this.spentToday);
    return usd;
  }

  summary() {
    return { spentUsd: this.spent, calls: this.calls, byRole: this.byRole, byTarget: this.byTarget, runCapUsd: this.runCapUsd, dailyCapUsd: this.dailyCapUsd, spentTodayUsd: this.spentToday };
  }
}

function readSpend(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')).usd ?? 0; } catch { return 0; }
}
function writeSpend(file, usd) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ usd }));
}

/** Call a target, charging the budget. role: 'tutor' | 'user' | 'judge'. */
export async function charged(budget, role, target, req) {
  budget.check();
  const out = await target.chat(req);
  out.usd = budget.charge(role, target.price, out.usage, target.id);
  return out;
}

/**
 * Rough pre-run estimate. Tokens are estimated from prompt sizes (4 characters per token) and
 * typical reply lengths, then a 30% margin is added. It errs high on purpose.
 */
export function estimateRun({ mode, targets, judge, user, cases, turns, repeats, systemChars = 2000, rubric = true }) {
  const T = { tutorOut: 120, userOut: 40, judgeOut: 250, turnTokens: 90 };
  const sys = systemChars / 4;
  // A tutor call at turn t sees the system prompt plus t exchanges.
  const tutorIn = (t) => sys + t * T.turnTokens * 2;
  let assistantUsd = 0;
  let userUsd = 0;
  let judgeUsd = 0;
  const per = (price, inTok, outTok) => (inTok * (price?.input ?? 0) + outTok * (price?.output ?? 0)) / 1e6;
  const convs = cases * repeats;
  const tracks = mode === 'mirrored' ? 2 : targets.length; // mirrored: one track per main model
  for (let t = 0; t < turns; t++) {
    const answering = mode === 'mirrored' ? targets.slice(0, 2) : null;
    for (let k = 0; k < tracks; k++) {
      const who = answering ?? [targets[k]];
      for (const tg of who) assistantUsd += convs * per(tg.price, tutorIn(t), T.tutorOut);
      userUsd += convs * per(user.price, tutorIn(t) / 2 + 200, T.userOut);
      if (mode === 'mirrored') judgeUsd += convs * 2 * per(judge.price, tutorIn(t) + 2 * T.tutorOut + 300, 60); // both orders
    }
  }
  const transcriptIn = turns * T.turnTokens * 2 + 600;
  if (rubric) judgeUsd += convs * tracks * per(judge.price, transcriptIn, T.judgeOut);
  if (mode === 'independent' && targets.length >= 2) judgeUsd += convs * 2 * per(judge.price, transcriptIn * 2, 80);
  const m = 1.3;
  return { assistantUsd: assistantUsd * m, userUsd: userUsd * m, judgeUsd: judgeUsd * m, totalUsd: (assistantUsd + userUsd + judgeUsd) * m };
}
