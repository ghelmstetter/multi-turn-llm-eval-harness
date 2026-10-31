// Spending: every model call is charged to a budget with a per-run cap and a daily cap.
// Repeats, mirrored runs and judge calls multiply cost quickly, so a run shows an estimate
// first and stops cleanly (keeping its results, marked partial) if a cap is reached.

export class BudgetExceeded extends Error {}

export const costOf = (price, usage) => ((usage?.input ?? 0) * (price?.input ?? 0) + (usage?.output ?? 0) * (price?.output ?? 0)) / 1e6;

export class Budget {
  /**
   * spendStore: where today's evaluation spend is kept across runs, as { read(): usd, write(usd) }
   * (null = don't track across runs). The CLI keeps it in a file, the browser in local storage.
   */
  constructor({ runCapUsd = 1, dailyCapUsd = 5, spendStore = null } = {}) {
    this.runCapUsd = runCapUsd;
    this.dailyCapUsd = dailyCapUsd;
    this.store = spendStore;
    this.spentBefore = this.store ? Number(this.store.read()) || 0 : 0;
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

  charge(role, price, usage, targetId = null, ms = null) {
    const usd = costOf(price, usage);
    this.spent += usd;
    this.calls += 1;
    this.byRole[role] = (this.byRole[role] ?? 0) + usd;
    if (role === 'assistant' && targetId) {
      const t = (this.byTarget[targetId] ??= { usd: 0, replies: 0, inputTokens: 0, outputTokens: 0, ms: [] });
      if (Number.isFinite(ms)) t.ms.push(ms);
      t.usd += usd;
      t.replies += 1;
      t.inputTokens += usage?.input ?? 0;
      t.outputTokens += usage?.output ?? 0;
    }
    if (this.store) this.store.write(this.spentToday);
    return usd;
  }

  summary() {
    return { spentUsd: this.spent, calls: this.calls, byRole: this.byRole, byTarget: this.byTarget, runCapUsd: this.runCapUsd, dailyCapUsd: this.dailyCapUsd, spentTodayUsd: this.spentToday };
  }
}

/** Call a target, charging the budget. role: 'tutor' | 'user' | 'judge'. */
export async function charged(budget, role, target, req) {
  budget.check();
  const out = await target.chat(req);
  out.usd = budget.charge(role, target.price, out.usage, target.id, out.ms);
  return out;
}

/**
 * Pre-run estimate. Tokens are estimated from prompt sizes (4 characters per token), typical
 * visible reply lengths, and hidden "thinking" tokens: reasoning models such as Gemini Flash
 * spend a few hundred output tokens thinking on every call, billed as output. Set
 * "thinkingTokens" per model in the targets file (default 300, calibrated on a real Gemini
 * Flash run; use 0 for models that don't think). A 15% margin is added.
 */
export function estimateRun({ mode, targets, judge, user, cases, turns, repeats, systemChars = 2000, rubric = true }) {
  const T = { tutorOut: 120, userOut: 40, judgeOut: 250, pairOut: 60, turnTokens: 40 };
  const think = (m) => m?.thinkingTokens ?? 300;
  const sys = systemChars / 4;
  // An assistant call at turn t sees the system prompt plus t exchanges.
  const tutorIn = (t) => sys + t * T.turnTokens * 2;
  let assistantUsd = 0;
  let userUsd = 0;
  let judgeUsd = 0;
  let calls = 0;
  const per = (price, inTok, outTok) => (inTok * (price?.input ?? 0) + outTok * (price?.output ?? 0)) / 1e6;
  const convs = cases * repeats;
  const tracks = mode === 'mirrored' ? 2 : targets.length; // mirrored: one track per main model
  for (let t = 0; t < turns; t++) {
    const answering = mode === 'mirrored' ? targets.slice(0, 2) : null;
    for (let k = 0; k < tracks; k++) {
      const who = answering ?? [targets[k]];
      for (const tg of who) { assistantUsd += convs * per(tg.price, tutorIn(t), T.tutorOut + think(tg)); calls += convs; }
      if (t < turns - 1) { userUsd += convs * per(user.price, tutorIn(t) / 2 + 200, T.userOut + think(user)); calls += convs; }
      if (mode === 'mirrored') { judgeUsd += convs * 2 * per(judge.price, tutorIn(t) + 2 * T.tutorOut + 300, T.pairOut + think(judge)); calls += convs * 2; } // both orders
    }
  }
  const transcriptIn = turns * T.turnTokens * 2 + 600;
  if (rubric) { judgeUsd += convs * tracks * per(judge.price, transcriptIn, T.judgeOut + think(judge)); calls += convs * tracks; }
  if (mode === 'independent' && targets.length >= 2) { judgeUsd += convs * 2 * per(judge.price, transcriptIn * 2, T.pairOut + think(judge)); calls += convs * 2; }
  const m = 1.15;
  return { assistantUsd: assistantUsd * m, userUsd: userUsd * m, judgeUsd: judgeUsd * m, totalUsd: (assistantUsd + userUsd + judgeUsd) * m, calls };
}

/**
 * Seconds per model call. Calls run one after another, so a run takes about calls × this.
 * Default calibrated on the first real Gemini Flash run (404 calls in 28 minutes); a saved
 * run's own pace is used when there is one (for extending it).
 */
export const SECONDS_PER_CALL = 4.2;
export function paceOf(results) {
  const m = results?.meta;
  const ms = Date.parse(m?.finishedAt) - Date.parse(m?.startedAt);
  const calls = m?.budget?.calls;
  return !m?.mock && ms > 0 && calls ? ms / 1000 / calls : SECONDS_PER_CALL;
}

/** "about 25 minutes", "about 2 minutes", "under a minute" */
export function durationText(seconds) {
  if (seconds < 60) return 'under a minute';
  const min = Math.round(seconds / 60);
  if (min < 90) return `about ${min} minute${min === 1 ? '' : 's'}`;
  return `about ${(seconds / 3600).toFixed(1)} hours`;
}
