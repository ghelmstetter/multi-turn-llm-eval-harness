## What happened

The coached prompt changed the tutor's behavior a lot, in the intended direction. Replies got about 60% shorter (a median of 22 words vs. 58), monologues disappeared, stacked questions dropped from 5 per conversation to under 2, the English share fell from 72% to 27% (inside the 10–40% target), and the learner's share of the talking doubled. The rubric judge agreed (4.7 vs. 4.2 out of 5). It costs the same per reply and is about as fast (typical reply 5.0 s vs. 5.4 s).

But the turn-by-turn judge preferred it only 55% of the time, which is not conclusive. The case breakdown shows why: the coached prompt won the cases about brevity and honesty (praise-fishing, off-topic, the baseline) and **lost three cases** where a beginner needed patience or accommodation.

## Three regressions worth fixing

- **It gave up on Spanish when asked.** When a nervous learner asked to "just talk in English," the coached tutor replied "We can just chat in English" and dropped Spanish for the next turn. The plain tutor kept Spanish going and won the case 8 turns to 3. The likely trigger is the coached rule "if they mention something hard, respond to that first," applied to nervousness.
- **More Spanish brought harder Spanish.** Pushed toward "mostly Spanish," the coached tutor reached for past tenses an A1 learner hasn't met (*¿Tuviste mucho trabajo hoy?*, *¿Cómo estuvo tu día?*, *¿Has viajado a España?*). The plain tutor used less Spanish, but simpler Spanish, and scored higher on level fit (5.0 vs. 4.6).
- **It skipped corrections.** When a beginner attempted an advanced sentence with mistakes, the plain tutor praised the effort and gave a brief recast; the coached tutor just moved on. "Don't lecture," combined with the short-turn rule, seems to have suppressed corrections entirely.

## Recommendations to test

These are hypotheses for the next run, not proven fixes:

- **Nervous learners:** "If the learner asks to switch to English or seems nervous, reassure them in English, then offer one very easy Spanish step (a yes/no question or a phrase to repeat). Never switch to English only."
- **Level:** "Use only the present tense and *ir a* + infinitive unless the learner uses another tense first."
- **Corrections:** "When the learner makes a mistake, recast it in one short sentence ('Ah, *soy de Chicago*!') before moving on. Keep corrections brief, but don't skip them."
- **Then rerun** the three weak cases with repeats, for example `--cases english-only,overreach,worrying-mention --repeats 3`. Eighty-four turns isn't enough to settle a 55% preference, and these cases need more samples.

## Caveats

- One run of 7 cases; the 95% interval on the head-to-head result is roughly 45–66%.
- The judge and the simulated learner are the same model as the tutor (Gemini Flash), so a self-preference bias is possible. A judge from another vendor would be a stronger test.
- The judge was consistent 85% of the time when reply order was swapped. The other 15% counted as ties.
- One case check (praise-fishing) was too broad in the original run: it flagged the tutor for quoting the learner's question. The check was fixed and the saved transcripts re-scored without new model calls.
