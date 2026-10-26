# Writing a suite for your own product

A **suite** describes one conversational product to test: what the assistant is, how it's prompted, who it talks to, the situations to test, and what good looks like. It's one JSON file. This guide walks through writing one, using the two example suites as references:

- [`suites/tutor-es`](../suites/tutor-es/suite.json): a Spanish tutor for beginners
- [`suites/support-bikes`](../suites/support-bikes/suite.json): a support agent for a (fictional) online bike shop

Expect about an hour for a first useful suite: a description, two prompt variants, four or five cases and a rubric.

## 1. Start from an example

Copy the example closest to your product into a new folder:

```bash
mkdir suites/my-product
cp suites/support-bikes/suite.json suites/my-product/suite.json
```

Then change it section by section, and run the validator after each change. It checks everything and explains each problem in plain words:

```bash
node src/cli.js validate --suite suites/my-product
```

## 2. Describe the product and what good looks like

```json
"id": "my-product",
"title": "Onboarding assistant for a budgeting app",
"description": "The ASSISTANT helps new users set up their first budget. The USER is a new user who may not know budgeting terms. A good assistant…",
"roleNames": { "assistant": "assistant", "user": "new user" },
"kickoff": "[A new user has just opened the app. Greet them.]"
```

- **`description` is the most important text in the suite.** The judge reads it before every judgment, so say concretely what good behavior is: tone, length, what to do, what never to do.
- **`roleNames`** label the two sides in transcripts and in the report ("tutor" and "learner", "agent" and "customer").
- **`kickoff`** is the first message the assistant sees, so it opens the conversation. If in your product the user speaks first, make it the user's typical first message instead.

## 3. Prompts: what you're testing

```json
"defaultPrompt": "current",
"prompts": {
  "current": "…your product's system prompt today…",
  "candidate": "…the version you're considering…"
},
"promptNotes": {
  "current": "Today's production prompt.",
  "candidate": "Adds rules for handling confused users."
}
```

- **Paste your product's real system prompt.** The results only describe your product if the model sees what your product sends. If your product adds context at runtime (account details, retrieved documents, memory), paste a realistic example of that into the prompt too.
- **Add a second variant to compare prompts,** or keep one variant and compare models (step 7).
- **`promptNotes`** are one-line descriptions that the report shows next to each target, so a reader knows what differs between the variants.

## 4. The simulated user

```json
"user": { "system": "You are role-playing a new user of a budgeting app, to test its assistant. Stay in character. You don't know budgeting terms…" }
```

These are general instructions for the model that plays your user. Each case then adds who the user is in that situation (step 5). Tell it to stay in character, to write the way your real users write (short and informal in a chat, for example), and never to mention that it's a test.

## 5. Cases: the situations to test

A case is one situation, usually one that commonly goes wrong:

```json
{
  "id": "confused-user",
  "title": "User doesn't understand a key term",
  "goal": "Explain 'envelope' in one plain sentence, check they understood, and continue the setup.",
  "user": {
    "profile": "Jamie, 22, first job, has never made a budget. Easily discouraged.",
    "beats": [
      { "turn": 0, "say": "what's an envelope?? i just want to see where my money goes" },
      { "turn": 2, "do": "Say you're confused again and ask whether this is too complicated for you." }
    ]
  },
  "checks": [
    { "id": "no-jargon-dump", "type": "absent", "pattern": "zero-based|amortiz", "description": "Doesn't answer with more jargon." }
  ]
}
```

- **`goal`**: what good behavior looks like in this case. The judge reads it.
- **`profile`**: who the simulated user is, in a sentence or two.
- **`beats`**: scripted moments. `turn` counts the user's replies from 0 (0 is the user's first reply). Use `say` for exact words and `do` for an instruction. Between beats the simulated user reacts naturally. Beats make sure every target faces the same hard moments, so the conversations stay comparable.
- **`checks`** (optional): pass/fail rules on the assistant's replies. `"type": "absent"` means the pattern must never appear; `"present"` means it must appear at least once (from `fromTurn` on, if given). Patterns are regular expressions, case-insensitive unless you set `"flags": ""`. Use checks for the things that must never happen, such as inventing a discount or giving medical advice.

**Good cases come from real failures.** Start with a baseline case (a cooperative, typical user), then add one case for each way your product has gone wrong or might: a user who's upset, confused, off-topic, trying to break the rules, or mentioning something serious in passing.

## 6. How to judge it

```json
"rubric": [
  { "id": "clarity", "description": "Explains things in plain words a new user understands." },
  { "id": "brevity", "description": "Short replies, one question at a time." }
],
"pairwiseQuestion": "Which reply would help this new user more right now?",
"conversationQuestion": "Across the whole conversation, which assistant helped the user more?",
"metrics": { "include": ["wordsMedian", "wordsP90", "monologues", "stackedQuestions"], "maxWords": 70 }
```

- **`rubric`**: four to six criteria, each with a description of what a good score means. The judge scores each from 1 to 5 and must explain every score.
- **`pairwiseQuestion`**: what the judge asks when comparing two replies at one turn (mirrored mode). **`conversationQuestion`**: the same for whole conversations (independent mode).
- **`metrics`**: which code-measured metrics to report. `wordsMedian`, `wordsP90`, `monologues` (replies over `maxWords`) and `stackedQuestions` fit almost any conversational product. `nativeShare`, `aboveLevelShare` and `userTalkShare` are for language-learning products; see the tutor suite for their settings. `aboveLevelShare` needs a word list for the target language in the suite's folder (`frequencyList`: a .tsv of rank and word, most common first). `better` can override which direction is better for a metric, or give it a target range.

## 7. Targets: which models and prompts to compare

Targets live in a separate file, so the same suite can be run against different models. Copy [`examples/targets.json`](../examples/targets.json) and edit it:

```json
{
  "targets": [
    { "id": "current", "label": "Production model, current prompt", "vendor": "openai", "model": "…", "prompt": "current", "price": { "input": 0, "output": 0 } },
    { "id": "challenger", "label": "Cheaper model, current prompt", "vendor": "gemini", "model": "…", "prompt": "current", "price": { "input": 0, "output": 0 } }
  ],
  "user":  { "id": "sim-user", "vendor": "gemini", "model": "…", "price": { "input": 0, "output": 0 } },
  "judge": { "id": "judge", "vendor": "anthropic", "model": "…", "temperature": 0, "price": { "input": 0, "output": 0 } }
}
```

- A **target** is a vendor, a model, its settings and a prompt variant. Two targets on the same model with different `prompt`s are a prompt A/B test; two models with the same `prompt` are a model comparison.
- Set **`price`** (USD per million input and output tokens) from each vendor's pricing page, so the report's cost comparison is right.
- **Pick a judge from a third vendor** where you can, because judges tend to favor their own vendor's models.
- Supported vendors: `gemini`, `openai`, `anthropic`. Keys come from `GEMINI_API_KEY`, `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`, in the environment or a `.env` file.

## 8. Run it, cheapest first

```bash
# 1. Check the files, for free
node src/cli.js validate --suite suites/my-product --targets my-targets.json

# 2. Try the whole pipeline with mock models, for free
node src/cli.js run --suite suites/my-product --targets my-targets.json --mock --turns 3

# 3. One real case, short, to read the transcripts and sanity-check the judge
node src/cli.js run --suite suites/my-product --targets my-targets.json --cases confused-user --turns 4 --max-usd 0.20

# 4. Everything
node src/cli.js run --suite suites/my-product --targets my-targets.json
```

**Read the transcripts of the first real run before trusting any numbers.** Check that the simulated user behaves like your users and that you agree with the judge's reasons. If the judge's verdicts often flip when the order is swapped (low position consistency in the report), sharpen the rubric descriptions and the pairwise question.

## Tips

- **Keep the suite next to your product, in its own repo** (private if needed), and re-run it whenever the prompt or model changes.
- **Use repeats for decisions:** `--mode independent --repeats 3` averages out lucky and unlucky conversations.
- **A "too close to call" verdict is a result.** It often means the cheaper or faster option is the better choice.
- Invent the people in your cases. Never put real users' conversations or personal data in a suite.
