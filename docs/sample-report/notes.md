## What happened

The coached prompt changed the tutor's behavior a lot, in the intended direction. Replies got about 60% shorter (a median of 22 words vs. 58), monologues disappeared, stacked questions dropped from 5 per conversation to under 2, the English share fell from 72% to 27% (inside the 10–40% target), and the learner's share of the talking doubled. The rubric judge agreed (4.7 vs. 4.2 out of 5). It costs the same per reply and is about as fast (typical reply 5.0 s vs. 5.4 s).

But the turn-by-turn judge preferred it only 55% of the time, which is not conclusive. The case breakdown shows why: the coached prompt won the cases about brevity and honesty (praise-fishing, off-topic, the baseline) and **lost three cases** where a beginner needed patience or accommodation.

## Three regressions worth fixing

- **It gave up on Spanish when asked.** When a nervous learner asked to "just talk in English," the coached tutor replied "We can just chat in English" and dropped Spanish for the next turn. The plain tutor kept Spanish going and won the case 8 turns to 3. The likely trigger is the coached rule "if they mention something hard, respond to that first," applied to nervousness.
- **More Spanish brought harder Spanish.** Pushed toward "mostly Spanish," the coached tutor reached for past tenses an A1 learner hasn't met (*¿Tuviste mucho trabajo hoy?*, *¿Cómo estuvo tu día?*, *¿Has viajado a España?*). The plain tutor used less Spanish, but simpler Spanish, and scored higher on level fit (5.0 vs. 4.6).
- **It skipped corrections.** When a beginner attempted an advanced sentence with mistakes, the plain tutor praised the effort and gave a brief recast; the coached tutor just moved on. "Don't lecture," combined with the short-turn rule, seems to have suppressed corrections entirely.

## A real beginner disagreed with the judge

Greg, an actual beginner Spanish learner, rated 42 turns blind: the same pairs of replies the judge compared, with the names hidden and the order shuffled. He rated as the learner, judging what would help him, not whether the Spanish was correct.

- **They rarely agreed.** When both picked a winner, the judge matched Greg 45% of the time (95% interval 27–65%). In the MT-Bench study, expert raters agreed with each other 81–82% of the time on the same measure, so this is a real difference, not noise. Greg also called far more ties (36% of turns vs. the judge's 14%).
- **The reason is mostly English.** Where the two replies clearly differed in how much English they used, Greg picked the one with more English 14 times out of 17; the judge, 9 out of 22. He also picked the longer reply 73% of the time, the judge 39%. English explanations make replies longer, so these are largely the same preference.
- **Neither rater is simply right.** The judge applies the suite's teaching theory: keep the learner practicing in Spanish, with English as support (the code metric's target is 10–40% English, a design choice rather than an established number). Greg's picks reflect what he could follow and what kept him comfortable. Comfort isn't proof of learning, and the judge's rule isn't proof either.

**What it means for the product.** A tutor tuned only to the judge may teach better on paper but feel harder, and learners who feel lost may quit. A tutor tuned only to learner comfort may be pleasant and teach less. How much English to use, and when to taper it, is a product decision. The eval didn't settle it, but it surfaced it, with numbers. The question for the judge changes from "can it be trusted?" to "whose judgment does it represent?"

**Next steps for this question:**
- Ratings from a Spanish teacher would show whether the judge sides with the teacher or with the learner, which tests the judge's teaching theory directly.
- A tutor prompt that tapers English as the learner's level rises could be tested against both raters: more English early, less later.
- This is one learner rating one run. Treat it as a hypothesis, not a result.

## Recommendations to test

These are hypotheses for the next run, not proven fixes:

- **Nervous learners:** "If the learner asks to switch to English or seems nervous, reassure them in English, then offer one very easy Spanish step (a yes/no question or a phrase to repeat). Never switch to English only."
- **Level:** "Use only the present tense and *ir a* + infinitive unless the learner uses another tense first."
- **Corrections:** "When the learner makes a mistake, recast it in one short sentence ('Ah, *soy de Chicago*!') before moving on. Keep corrections brief, but don't skip them."
- **Then rerun** the three weak cases with repeats, for example `--cases english-only,overreach,worrying-mention --repeats 3`. Eighty-four turns isn't enough to settle a 55% preference, and these cases need more samples.

## Caveats

- One run of 7 cases; the 95% interval on the head-to-head result is roughly 45–66%.
- **Per case, the numbers are directional.** Each case has only 12 head-to-head turns, so only one result is settled on its own (the coached prompt's win on praise-fishing). The three losses each have intervals that include 50%. The transcripts show the failures plainly, which is why they're worth fixing, but the re-run with repeats is what will confirm them.
- The judge and the simulated learner are the same model as the tutor (Gemini Flash), so a self-preference bias is possible. A judge from another vendor would be a stronger test.
- The judge was consistent 85% of the time when reply order was swapped. The other 15% counted as ties.
- The human ratings come from one beginner learner, rating without being able to judge whether the Spanish was correct.
- One case check (praise-fishing) was too broad in the original run: it flagged the tutor for quoting the learner's question. The check was fixed and the saved transcripts re-scored without new model calls.
