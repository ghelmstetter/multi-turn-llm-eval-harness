## What this run tested

The first run found that the coached prompt beat the plain one on brevity and honesty but lost three cases where a beginner needed patience. This run tests the three fixes recommended there, added to the coached prompt as **coached v2**:

- **Level:** use only the present tense and *ir a* + infinitive unless the learner uses another tense first.
- **Corrections:** recast every mistake in one short sentence, then carry on; brief, but never skipped.
- **Nervous learners:** reassure in English, then offer one very easy Spanish step. Never switch to English only.

Same model, simulated learner and judge as the first run (Gemini Flash), against the same plain prompt. All 7 cases once, then the three weak cases extended: "keeps answering in English" and "something hard, mentioned in passing" by 3 repeats, "attempts advanced Spanish" by 5.

## The fixes did what they were written to do

- **Level:** replies using past tenses fell from 11% of the coached tutor's replies to under 1% (1 of 216). Words above the learner's level fell from 17% to 13%.
- **Nervous learners:** instead of "We can just chat in English," v2 says things like: *"Don't worry at all, it is completely normal to feel nervous… We can use English to help, but let's try just one tiny word together. Can you repeat after me: ¡Hola!?"* In that case, the coached prompt offered to drop Spanish in 1 of its 12 replies; v2 never did, in 48.
- **All three weak cases changed sides.** Against the plain prompt, v2 won "keeps answering in English" 61% (coached: 29%), "attempts advanced Spanish" 60% (coached: 33%) and "something hard, mentioned in passing" 61% (coached: 42%). The first of these changes is more than noise; the other two are not, on their own.
- Stacked questions dropped further (1.7 to 0.4 per conversation), and the rubric judge scored v2 4.9 out of 5, near its ceiling.

## But the overall result barely moved

- **Weighting each case equally, v2 beat the plain prompt 59% of the time (95% interval 50–68%)**, versus 55% for the coached prompt in the first run. The change, +4 points, is within noise (interval −10 to +17).
- The fixed cases gained, while three others slipped: praise-fishing 79% → 58%, off-topic 71% → 50%, the cooperative baseline 71% → 63%. Each slip is within noise (12 turns per case), but together they cancel most of the gain. It could be chance, or the longer prompt diluting the earlier rules.
- **None of the three weak cases is settled on its own.** Each is about 60% with an interval of roughly 47–74%. The extensions were sized assuming v2's margin would be as large as the plain prompt's margin had been against the coached prompt (about 70%); v2's real margin in these cases is smaller, so 48–72 turns weren't enough. Each case can be extended once, so settling them now takes a new run planned with more repeats.
- **Cost:** v2's prompt is longer, so replies cost 14% more ($2.06 vs. $1.81 per 1,000) and take slightly longer (typical reply 5.5 s vs. 5.0 s). This evaluation cost $2.06 in total, including the extensions.

## Recommendation

**Ship coached v2 over coached v1**, as the better of the two coached prompts. The transcripts show each fix removing the specific failure it targeted, and nothing measurable got worse beyond noise. It's a small, honest improvement, not a breakthrough.

Before treating it as better than the plain prompt overall, run **all seven cases with 3 repeats each** (about $2.80 and 90 minutes at current prices). That's the test that would settle the three weak cases and show whether the slips in praise-fishing and off-topic are real.

Still open from the first run: the beginner learner's blind ratings showed a preference for more English than the judge rewards. v2 doesn't address that tension; tapering English as the learner's level rises is the next prompt idea to test.

## Caveats

- One run; per-case samples are 12 turns except the three extended cases (48–72).
- With cases extended unequally, the headline weights each case equally; counting every turn instead gives 60%, dominated by the extended cases v2 was designed to fix.
- The judge, simulated learner and tutor are the same model (Gemini Flash), so self-preference is possible. The judge was consistent in 80% of turns when reply order was swapped (85% in the first run).
- The extensions ran 30–70 minutes after the main run; the model and settings were the same.
