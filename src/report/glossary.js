// Every term in the report, explained three ways: what it is, how to read it, and why it
// matters. Shown in pop-ups next to each term and in full at the end of the report.

export const GLOSSARY = {
  target: {
    term: 'Target',
    what: 'One setup under test: a model plus its settings plus a prompt variant (for example, "Gemini Flash with the coached prompt").',
    means: 'Two targets can be different models, or the same model with different prompts. The latter is a prompt A/B test.',
    why: 'Product decisions are rarely "which model?" alone. Usually it is "which model, prompted how?"',
  },
  promptVariant: {
    term: 'Prompt variant',
    what: 'A named version of the system prompt, defined in the suite (here, "plain" and "coached").',
    means: 'The full text of each variant is shown under Targets, so you can see exactly what differs.',
    why: 'Prompt changes are the cheapest lever a team has. Testing them against the same cases shows whether a change fixes what it was meant to fix, and what it breaks.',
  },
  verdict: {
    term: 'Verdict',
    what: 'The bottom line: which target did better, how sure the result is, and whether the other measures agree.',
    means: '"Winner" means the result is unlikely to be luck. "Leaning" means ahead, but more data could flip it. "Too close to call" means no meaningful difference at this sample size.',
    why: 'A table of numbers invites over-reading small differences. The verdict says plainly when a difference is real and when it isn\'t.',
  },
  interval: {
    term: '95% interval',
    what: 'The range the true value probably falls in, given how much data there is. For head-to-head win rates it\'s a Wilson score interval; for rubric averages, a t interval over the conversations. Charts draw it as a thin line with end caps.',
    means: 'For a win rate: if the whole range is above (or below) 50%, the result is settled; if it includes 50%, it might just be luck. For two rubric averages: if their ranges overlap, the difference could be noise. More turns, cases or repeats narrow the ranges.',
    why: 'Small runs produce dramatic-looking but unreliable numbers. The interval shows how much to trust the result. (Turns in one conversation aren\'t fully independent, so treat it as approximate.)',
  },
  mirrored: {
    term: 'Mirrored runs',
    what: 'The conversation is run twice with the same scripted user. In one run it always continues with target A\'s answer, in the other with target B\'s. At every turn, both targets answer from the same history, and a judge compares the two answers.',
    means: 'Each target is judged once continuing its own conversation and once continuing its rival\'s.',
    why: 'Conversations diverge after the first turn, which makes later comparisons unfair. Mirrored runs keep every comparison apples to apples and balance the advantage of continuing one\'s own conversation.',
  },
  shadow: {
    term: 'Shadow answer',
    what: 'In a mirrored run, the answer the other target gave at the same point, from the same history. It is judged against the main answer but isn\'t used to continue the conversation.',
    means: 'Open it under any turn to see both answers side by side, with the judge\'s reasons.',
    why: 'It makes every verdict auditable: you can check whether you agree with the judge.',
  },
  winRate: {
    term: 'Win rate',
    what: 'The share of head-to-head comparisons a target won, with ties counted as half a win.',
    means: '50% means no difference. The two targets\' win rates always add up to 100%.',
    why: 'Pairwise comparison is the most reliable way to use an LLM judge: "which is better?" is easier to answer consistently than "score this from 1 to 5".',
  },
  ties: {
    term: 'Ties',
    what: 'Comparisons where the judge gave different answers depending on which reply it saw first.',
    means: 'A tie means the judge couldn\'t consistently tell the replies apart.',
    why: 'Counting inconsistent verdicts as ties stops the judge\'s position bias from inflating either side.',
  },
  ownTrack: {
    term: 'Own vs. rival\'s conversation',
    what: 'A target\'s win rate split by whose answers the conversation was continuing with.',
    means: 'On its own conversation, a target is answering a history it shaped. On its rival\'s, it is stepping into someone else\'s.',
    why: 'A target that only shines on its own conversation may be good at steering, not at responding. One that wins both ways is robustly better.',
  },
  homeField: {
    term: 'Home-field effect',
    what: 'A target\'s win rate on its own conversation minus its win rate on its rival\'s, in percentage points.',
    means: 'Positive: it does better continuing its own history. Near zero: it does equally well either way. Negative: it does better stepping into its rival\'s conversation.',
    why: 'Simple comparison designs can\'t separate a model\'s quality from the advantage of its own earlier choices. This number measures that advantage directly.',
  },
  positionConsistency: {
    term: 'Judge position consistency',
    what: 'How often the judge picked the same winner when the two replies were shown in the opposite order.',
    means: '100% is ideal. Below about 80%, the judge is often swayed by order, and its verdicts deserve less trust.',
    why: 'LLM judges tend to favor whichever option comes first. Running both orders and reporting agreement measures that bias instead of hiding it.',
  },
  simulatedUser: {
    term: 'Simulated user',
    what: 'A model role-playing the person talking to the target (for the tutor suite, a beginner Spanish learner; for a support suite, a customer), following a case\'s script.',
    means: 'It reacts naturally between scripted moments, so each conversation is realistic but comparable.',
    why: 'Real users can\'t be replayed on demand. A simulated user lets every change be tested against the same situations.',
  },
  beat: {
    term: 'Beat',
    what: 'A scripted moment in a case: exact words at a given turn ("Yo es Pat."), or an instruction ("answer in English only").',
    means: 'In transcripts, scripted turns and beats are labeled.',
    why: 'Beats make sure every target faces the same difficult moments, so the conversations stay comparable without being identical.',
  },
  case: {
    term: 'Case',
    what: 'One test situation: who the simulated user is, the scripted beats, what good behavior looks like, and any pass/fail checks.',
    means: 'Most cases are "torture tests" built around a behavior that commonly goes wrong, such as a learner fishing for praise.',
    why: 'Average behavior hides failures. Targeted cases find the specific situations where a product breaks.',
  },
  checks: {
    term: 'Case checks',
    what: 'Pass/fail rules on the target\'s replies, written as patterns: things that must or must never happen in a case.',
    means: 'For example, "never tells a beginner they\'re fluent." A failure names the turn where it happened.',
    why: 'Some failures are unacceptable however good the rest is. Checks catch them cheaply and deterministically, with no judge involved.',
  },
  rubric: {
    term: 'Rubric judge',
    what: 'An LLM that scores each whole conversation from 1 to 5 on each criterion, giving a reason for every score.',
    means: 'Higher is better. Read the reasons under each conversation to see what drove a score.',
    why: 'Some qualities (warmth, gentle correction, responsiveness) can\'t be measured with code. The rubric covers them, and requiring reasons makes the judge auditable.',
  },
  wordsMedian: {
    term: 'Median words per turn',
    what: 'The typical length of the target\'s turns, in words (half are shorter, half longer).',
    means: 'Usually lower is better: conversational replies should be short, often a single question.',
    why: 'Long turns are the most common failure of conversational models, and they hurt most in voice, where a listener can\'t skim.',
  },
  wordsP90: {
    term: '90th-percentile words per turn',
    what: 'The length that 90% of turns stay under.',
    means: 'Shows how long the longer turns get. A low median with a high 90th percentile means mostly short turns with occasional speeches.',
    why: 'An average hides the occasional monologue. The shape of the lengths matters, not just the middle.',
  },
  monologues: {
    term: 'Monologues',
    what: 'Turns longer than the suite\'s word limit (the tutor suite uses 50 words: roughly 20 seconds of speech).',
    means: 'Counted per conversation. Lower is better.',
    why: 'A monologue takes the conversation away from the user and buries the one thing they needed.',
  },
  stackedQuestions: {
    term: 'Turns with 2+ questions',
    what: 'Turns that ask more than one question at once.',
    means: 'Counted per conversation. Lower is better.',
    why: 'Stacked questions overwhelm people, who usually answer only the last one.',
  },
  nativeShare: {
    term: 'Native-language share',
    what: 'For language-learning suites: the share of the target\'s function words (the, and, is…) in the learner\'s native language rather than the language being learned.',
    means: 'The tutor suite sets a target range of 10–40% English: mostly Spanish, with English for support. Zero isn\'t ideal either.',
    why: 'Too much native language and the learner doesn\'t practice; none at all and a beginner gets lost.',
  },
  aboveLevelShare: {
    term: 'Words above the user\'s level',
    what: 'For language-learning suites: the share of the target\'s Spanish words outside the most common ones (the tutor suite uses the top 2,000).',
    means: 'Lower is better for a beginner. The words themselves are listed under each conversation.',
    why: 'Vocabulary a beginner doesn\'t know makes the conversation incomprehensible, however friendly it is.',
  },
  userTalkShare: {
    term: 'User\'s share of the talking',
    what: 'The user\'s words as a share of all the words in the conversation.',
    means: 'For a tutor, higher is better: the learner should be practicing, not listening to a lecture. Other suites may not use this metric.',
    why: 'Speaking practice is the point of a conversation tutor.',
  },
  costPerThousand: {
    term: 'Cost per 1,000 replies',
    what: 'What the target\'s own replies cost, scaled to 1,000 replies, from their tokens at the configured price.',
    means: 'Prompt variants on the same model differ mainly through prompt length (a longer prompt costs more on every turn) and reply length.',
    why: 'This is the running cost of the product. A better target that costs much more may or may not be worth it; a better and cheaper one is an easy decision.',
  },
  findings: {
    term: 'Findings',
    what: 'Facts pulled from the results automatically: the biggest measured differences, cases where the overall loser won, failed checks, and rubric criteria where the judges disagree with the headline.',
    means: 'Each finding points to somewhere worth reading closely. They report what happened, not why; interpretation belongs in the analysis.',
    why: 'An overall verdict averages over everything. The most important problems often hide in one case, like a regression on a single kind of user.',
  },
  byCase: {
    term: 'By case',
    what: 'The head-to-head results, failed checks and rubric scores broken down for each case.',
    means: 'A case where the overall loser wins is a regression, or a strength of the loser, that the overall numbers hide.',
    why: 'Prompt changes rarely help everywhere. Seeing where a change hurts is how you decide whether to ship it, and what to fix first.',
  },
  humanRating: {
    term: 'Blind human rating',
    what: 'A person compares the same two replies the judge compared, without knowing which model or prompt wrote which, and picks the better one (or a tie). The order of the two replies is shuffled for every turn.',
    means: 'It measures the judge, not the targets: the question is how often the LLM judge picks what a careful human would.',
    why: 'An LLM judge is only useful if its verdicts match human judgment. Checking a sample by hand is how you find out how far to trust the rest of the run, and where not to.',
  },
  agreement: {
    term: 'Judge-human agreement',
    what: 'The share of rated turns where the judge and the human made the same pick: the same reply, or both called it a tie. Turns the human skipped are left out.',
    means: 'Higher is better, but don\'t expect 100%: people disagree too. In the MT-Bench study (Zheng et al., 2023), expert raters agreed with each other 63–67% of the time counting ties, and 81–82% when both picked a winner; GPT-4 as a judge agreed with them about as often (66% and 85%). A judge near those numbers is about as good as a second person.',
    why: 'This is the number that says whether the head-to-head verdict can be trusted. Agreement by case shows where the judge is weakest, and the split by position consistency shows whether swapping the reply order is worth its cost.',
  },
  extended: {
    term: 'Extended run',
    what: 'More conversations added to some cases after the original run, with the same models, settings, prompts and cases, to narrow their intervals.',
    means: 'An extended case has more samples than the others. The date shows when they were added; vendors sometimes update a model without renaming it, so a long gap is worth noting.',
    why: 'It settles a close case without paying to re-run everything. Each case can be extended once, with the number of repeats chosen up front, so that stopping as soon as a case happens to settle can\'t make luck look like a result.',
  },
  analysis: {
    term: 'Analysis and recommendations',
    what: 'Notes written about this run by a person (or an assistant) after reading the results: what the numbers mean, likely causes, and what to try next.',
    means: 'Recommendations are hypotheses to test with another run, not proven fixes.',
    why: 'Numbers say what happened; turning them into a decision takes judgment. Keeping that judgment next to the evidence makes it easy to check.',
  },
  latency: {
    term: 'Response time',
    what: 'How long the model took to return a complete reply, measured per call: the typical (median) reply and the slow end (90th percentile, which 1 in 10 replies is slower than).',
    means: 'Lower is better. In mirrored runs both targets are called at the same moment, so they share network conditions. Times include the network round trip and vary with region and load, so compare targets within a run rather than across runs.',
    why: 'In a conversation, a slow reply breaks the flow, especially in voice. The slow end matters as much as the typical reply, because users remember the long pauses. (This measures the full reply; for streaming or voice products, time to the first word matters too.)',
  },
  evalSpend: {
    term: 'Evaluation spend',
    what: 'What this run cost, split into the targets\' replies, the simulated user and the judge.',
    means: 'The simulated user and the judge are the cost of testing, not of the product.',
    why: 'Evaluation costs multiply quickly (repeats, mirrored runs, both-order judging), so the harness estimates them first, caps them, and reports them.',
  },
  qualityPerDollar: {
    term: 'Quality vs. cost',
    what: 'Whether the better target is also cheaper, about the same, or more expensive, and by how much.',
    means: 'Quality here is a win rate or a 1–5 score, which isn\'t measured in dollars, so the report states the trade-off rather than one blended number.',
    why: 'The useful decision is "is the improvement worth the extra cost?", and that depends on the product\'s margins and volume.',
  },
};

/** An ⓘ button that opens the term's explanation (a native popover; no script needed). */
export function info(key, idPrefix = 'g') {
  const g = GLOSSARY[key];
  if (!g) return '';
  return `<button type="button" class="info" popovertarget="${idPrefix}-${key}" aria-label="What is ${escAttr(g.term)}?" title="What is this?">i</button>`;
}

const escAttr = (s) => String(s).replace(/"/g, '&quot;');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const body = (g) => `<dl><dt>What it is</dt><dd>${esc(g.what)}</dd><dt>How to read it</dt><dd>${esc(g.means)}</dd><dt>Why it matters</dt><dd>${esc(g.why)}</dd></dl>`;

/** The pop-up bodies, once per page. */
export function popovers(idPrefix = 'g') {
  return Object.entries(GLOSSARY).map(([k, g]) => `<div id="${idPrefix}-${k}" popover class="pop"><b>${esc(g.term)}</b>${body(g)}<button type="button" class="pop-close" popovertarget="${idPrefix}-${k}" popovertargetaction="hide">Close</button></div>`).join('');
}

/** The full glossary section at the end of the report. */
export function glossarySection() {
  return `<h2 id="glossary">Glossary</h2><div class="glossary">${Object.values(GLOSSARY).map((g) => `<section><h3>${esc(g.term)}</h3>${body(g)}</section>`).join('')}</div>`;
}
