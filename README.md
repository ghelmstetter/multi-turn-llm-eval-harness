# multi-turn-llm-eval-harness

A harness for evaluating LLMs in **multi-turn conversations**, where most evaluation tools only look at single prompts and single answers.

Its first suite evaluates a **conversational Spanish tutor**: a model playing a friendly tutor for an English-speaking beginner, talking with a simulated learner. The engine itself is domain-neutral (a suite is a JSON file of prompts, simulated-user cases, checks and a rubric), so the same approach works for other conversational assistants, such as support agents or coaches.

It runs a model (or a prompt) through complete conversations with a **scripted simulated user** (here, the learner), then grades it three ways, cheapest first:

1. **Code-measured metrics:** the turn-length profile, monologues and stacked questions, plus, for the tutor, how much English it uses, how many of its words are above the learner's level, and how much of the talking the learner gets to do.
2. **An LLM rubric judge,** with explicit controls for the judge's own biases.
3. **Pairwise comparison** of two models or prompts, turn by turn, using **mirrored runs**: a method that keeps comparisons fair after the conversations diverge.

**How it fits a real product.** The harness knows nothing about any particular app: it tests whatever a suite describes, meaning a model, a prompt and a set of simulated-user cases. The example suite uses a deliberately simple tutor prompt so it can be public.

To evaluate a real product, you keep a suite next to that product, in the product's own (possibly private) repo, and have it send the model exactly what the product sends: the real system prompt and persona, plus whatever context the product adds, such as a lesson plan or what it remembers about the user. Every prompt or model change can then be checked against the same cases before it ships, and the results describe the product as its users will experience it. In v0.1 a suite's prompts are fixed text; letting a suite build them with the product's own code is next on the [roadmap](#roadmap).

> **Status: v0.1, built October 2026.** The engine, both comparison modes, the graders, cost controls, the report and the tests are working. First published results are coming next; see [Roadmap](#roadmap).

---

## The problem with evaluating conversations

Comparing two models on one prompt is easy: same input, two outputs, compare. Conversations break that. After the first turn, each model's conversation goes its own way, and by turn five you're comparing two different conversations. That's apples to oranges.

This harness uses two complementary modes to handle it.

### Mode A: mirrored runs (how good is each turn?)

Run the conversation **twice** with the same scripted user:

- In run 1, the conversation always continues with **model X's** answer.
- In run 2, it always continues with **model Y's** answer.
- At every turn, the other model also answers from the *same* history (a "shadow" answer), and a judge compares the two.

```
run 1:  history ─► X answers ─► judge(X, Y) ─► continue with X ─► user replies ─► …
                  Y answers ─┘ (shadow)
run 2:  history ─► Y answers ─► judge(X, Y) ─► continue with Y ─► user replies ─► …
                  X answers ─┘ (shadow)
```

Why this design:

- **Fair at every turn.** Both models answer the identical context, so each comparison is apples to apples.
- **Balanced by design.** Each model is judged once continuing its own conversation and once continuing its rival's.
- **It measures the home-field effect.** Comparing a model's win rate on its own track with its win rate on its rival's shows how much it benefits from (or is hurt by) its own earlier choices. A naive "pick one answer at random to continue" design can't separate that.
- **Two tools in one.** Each run's main track is a complete conversation by one model, so it can also be judged as a whole (Mode B's rubric).

Never continuing with "the judge's favorite" is deliberate: that would make the conversation drift toward the stronger model's style and bias every later turn.

Cost is about 2× a single run, so mirrored mode compares exactly two targets. For three or more, compare pairs.

### Mode B: independent conversations (how good is the whole conversation?)

Each model holds its own complete conversations with the simulated user, N times per case. The user follows a **semi-scripted case**: fixed beats at given turns ("say *yo es* instead of *yo soy* at turn 2", "answer in English only at turn 3"), and natural reactions in between. The fixed beats keep conversations comparable without forcing them to be identical.

Mode B is judged at the conversation level: code metrics, case checks, the rubric, and pairwise judgments of whole transcripts. It captures what turn-by-turn comparison can't: pacing, recovering from its own mistakes, consistency, and whether the conversation as a whole went well.

**Use both.** Mode A for turn quality, Mode B for conversation quality.

---

## Grading, cheapest first

| Grader | What it catches | Cost |
|---|---|---|
| **Code metrics** | Median and 90th-percentile words per turn, monologues, turns with stacked questions, native-language share, words above the user's level (against a frequency list), the user's share of the talking | Free, deterministic |
| **Case checks** | Hard rules per case: things that must or must never happen (e.g. never telling a beginner they're fluent) | Free, deterministic |
| **Rubric judge** | Qualities code can't measure: level fit, gentle correction, responsiveness, honesty. A score of 1–5 per criterion, and every score must cite a reason | One call per conversation |
| **Pairwise judge** | Which of two answers (or conversations) is better | Two calls per comparison (both orders) |

For conversations, **length is a quality signal**: a tutor that talks in paragraphs is a bad tutor, especially in voice, where a listener can't skim. So the harness looks at the *shape* of turn lengths (median, 90th percentile, monologues), not just the average.

### Judge bias controls

LLM judges have known biases, and the harness controls for each:

- **Position bias** (favoring whichever option comes first): every pairwise comparison runs in **both orders**. If the two verdicts disagree, the result is a tie, and the report shows the judge's **position consistency**, a direct measure of how much its verdicts can be trusted.
- **Length bias** (favoring longer answers): rubrics explicitly reward brevity where it fits, and the report shows each output's length next to its score.
- **Self-preference** (favoring its own vendor's models): use a judge from a third vendor where possible. Targets and judge are independent settings, and the report names the judge model.
- **Unexplained scores:** every rubric score requires a reason citing specific turns, so you can audit the judge.

Planned: blind human ratings of a sample, to measure how often the judge agrees with a person.

---

## Quick start

Requires Node.js 20 or later. There are no dependencies to install.

```bash
git clone https://github.com/ghelmstetter/multi-turn-llm-eval-harness
cd multi-turn-llm-eval-harness
npm test        # 12 tests, no keys needed
npm run demo    # a mirrored run with mock models: no keys, no cost
```

The demo writes `results/demo/report.html`, a single file that opens in any browser. Mock models are deterministic stand-ins that exercise the whole pipeline; the report labels mock runs clearly, and their numbers say nothing about real models.

### Reading the report

- **The verdict comes first:** which target won, how sure that is, and at what cost. "How sure" is a 95% interval on the head-to-head win rate, so "too close to call" is a possible answer. Below it, the report says whether the rubric judge, the code metrics and the case checks agree.
- **What was compared:** each target's description and its full prompt, and each case's goal.
- **Charts for each kind of evidence:** head-to-head win shares (split by whose conversation was being continued), every reply's length as a dot against the monologue limit, the code metrics and rubric scores side by side, and cost. Every chart has a "Show as a table" view, and hovering a mark shows its exact value.
- **Every conversation in full,** with each reply's word count, the shadow answer and the judge's two reasons at every turn, and the rubric's reason for every score.
- **Every term explained:** each ⓘ button opens what the term is, how to read it and why it matters, and a glossary at the end collects them all.

### Cost and value

The report shows what each target costs to run (per 1,000 replies, from its tokens at the configured price) next to its quality, and says plainly whether the winner is **better and cheaper**, **better at about the same cost**, or **better but more expensive** (and by how much per million replies). Quality here is a win rate or a 1-to-5 score, which isn't measured in dollars, so the report states the trade-off instead of blending the two into a single "quality per dollar" number. The cost of running the evaluation itself (the simulated user and the judge) is reported separately, since it isn't a cost of the product.

### A real run

Put your API key in a `.env` file (git-ignored) or in the environment:

```bash
cp .env.example .env          # Windows: copy .env.example .env  — then edit: GEMINI_API_KEY=...
node src/cli.js estimate      # cost estimate only
node src/cli.js run           # all cases, mirrored mode, 6 turns
```

The example compares **the same model with two prompts**, defined in the suite and named in [`examples/targets.json`](examples/targets.json):

- **`flash-plain`:** Gemini Flash with a three-sentence tutor prompt (who the tutor is, who the learner is, "help them learn") and no guidance on how to talk. The baseline.
- **`flash-coached`:** the same model and the same opening, plus explicit rules: short turns with one question at a time, mostly simple Spanish with English for support, gentle corrections by recasting, honest praise, and responding to hard news first.

That's a prompt A/B test, and it's often the most useful kind: does this prompt change actually fix what it's meant to fix, and what does it break? Target names and descriptions are yours to write; the report shows each target's description and its full prompt, so a reader always knows what was compared.

### Options

| Option | What it does | Default | When to use it |
|---|---|---|---|
| `--mode mirrored` / `--mode independent` | Mirrored compares two targets reply by reply on a shared conversation; independent gives each target its own complete conversations (see [the two modes](#the-problem-with-evaluating-conversations)) | `mirrored` | Mirrored for "which gives the better reply at each moment?"; independent for "which runs the better conversation overall?" |
| `--compare a,b` | Which targets (model + prompt setups) to compare, by their `id` in the targets file | the first two | Once the targets file has more than two (e.g. models from different vendors) |
| `--cases a,b` | Run only these cases, by their `id` in the suite | all | Checking one behavior quickly and cheaply after changing a prompt |
| `--turns N` | Assistant turns per conversation | `6` | Longer conversations surface drift, forgetting and pacing problems |
| `--repeats N` | Conversations per case (and per target) | `1` | Models are random; repeats average out lucky or unlucky conversations and show how much results vary |
| `--no-rubric` | Skip the whole-conversation rubric judge | rubric on | Saving cost when you only need metrics and pairwise verdicts |
| `--max-usd X` | Spending cap for this run | `1.00` | Lower it while experimenting; raise it for big runs |
| `--daily-usd X` | Spending cap per day, across runs | `5.00` | A safety net when running a lot |
| `--mock` | Use mock models: no keys, no cost | off | Trying the harness, and in tests |
| `--yes` | Don't ask for confirmation before running | asks | Scripts (it still asks if the estimate is close to a cap) |
| `--out DIR` | Where to write results | `results/<time>-<suite>-<mode>` | Keeping a run under a name you choose |
| `--suite DIR`, `--targets FILE` | Which suite and targets file | `suites/tutor-es`, `examples/targets.json` | Your own suite or targets |

Run `node src/cli.js` with no command to see this list in the terminal. Options combine freely. Some examples:

```bash
# Whole conversations instead of turn-by-turn, three per case
node src/cli.js run --mode independent --repeats 3

# Just two cases: a quick, cheap check after changing the prompt
node src/cli.js run --cases praise-fishing,english-only

# A chosen pair, longer conversations, and a lower spending cap
node src/cli.js run --compare flash-plain,flash-coached --turns 8 --max-usd 0.50
```

### Cost controls

Repeats, mirrored runs and judge calls multiply cost quickly, so:

- Before a run, the harness prints an **estimate** (deliberately on the high side) and asks for confirmation.
- There is a **per-run cap** (`--max-usd`, default $1) and a **daily cap** (`--daily-usd`, default $5), tracked across runs.
- If a cap is reached mid-run, the run **stops cleanly** and keeps its results so far, marked partial.
- The report breaks spending down by role: models under test, simulated user, judge.

The full example suite in mirrored mode (7 cases × 6 turns, two targets, rubric on) is estimated at about $0.60 with Gemini Flash pricing.

---

## The tutor suite

[`suites/tutor-es/suite.json`](suites/tutor-es/suite.json): a conversational Spanish tutor for an English-speaking beginner (CEFR A1). Besides a baseline, the cases are "torture tests" that commonly trip up conversational models:

| Case | What it tests |
|---|---|
| `baseline` | A cooperative beginner: natural, simple conversation |
| `english-only` | The learner keeps answering in English. Does the tutor patiently keep Spanish going, or give up and switch? |
| `repeated-mistake` | The same error again and again (*yo es* for *yo soy*). A gentle recast first, a brief pointer later, no lecture |
| `praise-fishing` | "Am I fluent yet?" Honest encouragement, never false praise (a code check fails the tutor if it says they're fluent) |
| `overreach` | A beginner attempts advanced grammar. Acknowledge, understand, bring it back to their level |
| `worrying-mention` | "My mom is in the hospital," mentioned in passing. Respond with care first; don't steamroll on with the lesson |
| `off-topic` | The learner wants to talk football in English. Engage briefly, then steer back to Spanish using that topic |

### Writing a suite

A suite is one JSON file:

```jsonc
{
  "id": "my-suite",
  "description": "What the ASSISTANT is and what good looks like (given to the judge).",
  "roleNames": { "assistant": "tutor", "user": "learner" },
  "prompts": { "plain": "...", "coached": "..." },   // prompt variants that targets can pick
  "user": { "system": "How the simulated user behaves in general." },
  "metrics": { "target": "es", "native": "en", "levelRank": 2000, "maxWords": 50,
               "better": { "nativeShare": [0.1, 0.4] } },   // a target range instead of "lower is better"
  "rubric": [{ "id": "turn_length", "description": "..." }],
  "pairwiseQuestion": "Which reply would help the user more right now?",
  "cases": [{
    "id": "praise-fishing",
    "title": "...", "goal": "What good behavior looks like in this case (for the judge).",
    "user": {
      "profile": "Who the simulated user is.",
      "beats": [{ "turn": 0, "say": "Exact words." }, { "turn": 2, "do": "An instruction for that reply." }]
    },
    "checks": [{ "id": "no-false-fluency", "type": "absent", "pattern": "you're fluent" }]
  }]
}
```

Targets live in a separate file ([`examples/targets.json`](examples/targets.json)): vendor, model, settings, prompt variant and price, plus which model plays the simulated user and which judges. Gemini, OpenAI and Anthropic are supported, and adding a vendor is one small file in `src/targets/`.

---

## Code map

```
src/
  cli.js              estimate / run / report commands
  run.js              mirrored and independent modes, and the summary
  conversation.js     the conversation loop and the simulated user (beats + natural replies)
  graders/metrics.js  code metrics and case checks
  graders/judge.js    rubric and pairwise judges, with bias controls
  budget.js           cost tracking, caps, estimates
  targets/            Gemini, OpenAI, Anthropic and mock adapters, retries
  report/html.js      a self-contained HTML report
suites/tutor-es/      the Spanish tutor suite
test/                 tests (node --test), no network or keys needed
```

## Roadmap

- **Suites that build prompts with code**, so a product's eval suite can import the product's own prompt assembly and always test exactly what ships.
- **Published results** for the example suite: plain vs. coached prompt, and model comparisons across vendors.
- **Blind human rating:** shuffled, anonymized transcripts, plus judge-vs-human agreement.
- **Voice spot checks:** play the simulated user through text-to-speech, since speech-to-speech models can behave differently in voice than in text.
- **Memory across sessions:** whether an assistant recalls earlier conversations and keeps its own story consistent. Generic eval tools rarely test this.
- A second, non-tutor suite (e.g. a coding assistant graded by running code), to keep the engine general.

## Background

I built this while developing a voice-based language tutor, where the quality that matters most (short, natural, level-appropriate turns that keep the learner talking) only shows up across a whole conversation. The tutor app is a separate, private project; this harness and its example suite are independent of it.

## License

Code: [MIT](LICENSE). The Spanish frequency list in `data/` is derived from [FrequencyWords](https://github.com/hermitdave/FrequencyWords) (OpenSubtitles 2018) and shared under **CC BY-SA 4.0**; see [`data/README.md`](data/README.md).
