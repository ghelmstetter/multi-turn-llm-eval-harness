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
    what: 'The range the true head-to-head win rate probably falls in, given how many comparisons were made (a Wilson score interval).',
    means: 'If the whole range is above 50%, the leader is genuinely better. If it includes 50%, it might just be luck. More turns or repeats narrow the range.',
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
    what: 'A model role-playing the person talking to the target (here, a beginner Spanish learner), following a case\'s script.',
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
    means: 'For a conversational tutor, lower is better: short turns, often a single question.',
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
    what: 'Turns longer than the suite\'s limit (here, 50 words: roughly 20 seconds of speech).',
    means: 'Counted per conversation. Lower is better.',
    why: 'A monologue takes the conversation away from the learner, who should be doing most of the talking.',
  },
  stackedQuestions: {
    term: 'Turns with 2+ questions',
    what: 'Turns that ask more than one question at once.',
    means: 'Counted per conversation. Lower is better.',
    why: 'Stacked questions overwhelm a beginner, who usually answers only the last one.',
  },
  nativeShare: {
    term: 'English share',
    what: 'The share of the target\'s function words (the, and, is…) that are English rather than Spanish.',
    means: 'For this beginner, the suite sets a target range of 10–40%: mostly Spanish, with English for support. Zero isn\'t ideal either.',
    why: 'Too much English and the learner doesn\'t practice; none at all and a beginner gets lost.',
  },
  aboveLevelShare: {
    term: 'Words above the learner\'s level',
    what: 'The share of the target\'s Spanish words that fall outside the 2,000 most common Spanish words.',
    means: 'Lower is better for a beginner. The words themselves are listed under each conversation.',
    why: 'Vocabulary a beginner doesn\'t know makes the conversation incomprehensible, however friendly it is.',
  },
  userTalkShare: {
    term: 'Learner\'s share of the talking',
    what: 'The learner\'s words as a share of all the words in the conversation.',
    means: 'Higher is better: the learner should be practicing, not listening to a lecture.',
    why: 'Speaking practice is the point of a conversation tutor.',
  },
  costPerThousand: {
    term: 'Cost per 1,000 replies',
    what: 'What the target\'s own replies cost, scaled to 1,000 replies, from their tokens at the configured price.',
    means: 'Prompt variants on the same model differ mainly through prompt length (a longer prompt costs more on every turn) and reply length.',
    why: 'This is the running cost of the product. A better target that costs much more may or may not be worth it; a better and cheaper one is an easy decision.',
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
