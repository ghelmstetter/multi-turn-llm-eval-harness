// Code-measured graders: cheap, deterministic, run on every conversation before any judge.
// They catch what LLM judges are bad at noticing consistently (length, language mix, level).

const tokens = (t) => String(t ?? '').toLowerCase().match(/\p{L}+(?:'\p{L}+)?/gu) ?? [];
const wordCount = (t) => String(t ?? '').split(/\s+/).filter(Boolean).length;

// Small function-word lists are enough to tell English from Spanish word by word.
const STOP = {
  en: new Set('the and is are you your to of it that in what how do does i my me we they this with for be was have has can will would just not but so if or about like know think really there here'.split(' ')),
  es: new Set('el la los las de que y en un una es son tú tu te yo mi me se lo le por para con qué cómo muy pero más también hoy está estás estoy soy eres del al su sus nos ya bien sí aquí dónde cuál cuándo porque hay tienes tengo quieres quiero vas voy'.split(' ')),
};

const quantile = (xs, q) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.round(q * (s.length - 1))];
};

/**
 * Word frequency ranks (form -> rank) from the text of a suite's word list: tab-separated, with
 * a header row and columns rank, form. Suites that use the "words above level" metric bring their
 * own list for their language (the tutor suite's is suites/tutor-es/es-frequency.tsv). Loaders
 * (src/load-node.js, src/load-browser.js) read the file and attach the result to the suite.
 */
export function parseFrequencyList(text) {
  return new Map(String(text).trim().split(/\r*\n/).slice(1).map((l) => { const [r, f] = l.split('\t'); return [f, Number(r)]; }));
}

/** Share of a text's function words that are in `native` rather than `target` (0 = all target language). */
export function nativeShare(text, { target = 'es', native = 'en' } = {}) {
  let t = 0;
  let n = 0;
  for (const w of tokens(text)) {
    if (STOP[native]?.has(w) && !STOP[target]?.has(w)) n++;
    else if (STOP[target]?.has(w)) t++;
  }
  return t + n ? n / (t + n) : 0;
}

/**
 * Words above the learner's level: target-language words outside the `levelRank` most frequent
 * forms. Native-language words, numbers and capitalized names are skipped.
 */
export function aboveLevel(text, { levelRank = 1500, native = 'en', target = 'es', ranks = null } = {}) {
  if (!ranks) return { share: null, words: [] };
  const out = [];
  let counted = 0;
  // Only sentences that are mostly in the target language: English explanations aren't "hard Spanish".
  const sentences = String(text ?? '').split(/(?<=[.!?])\s+|\n+/).filter((s) => nativeShare(s, { target, native }) < 0.5);
  for (const m of sentences.join(' ').matchAll(/(^|[.!?¿¡]\s*|\s)(\p{L}+)/gu)) {
    const raw = m[2];
    const w = raw.toLowerCase();
    const r = ranks.get(w);
    // Capitalized words are skipped: usually names. (A rare word opening a sentence is missed too.)
    if (/^\p{Lu}/u.test(raw)) continue;
    if (STOP[native]?.has(w)) continue;
    if (r == null && /^[a-z]+$/.test(w) && isLikelyEnglish(w)) continue;
    counted++;
    if (r == null || r > levelRank) out.push(w);
  }
  return { share: counted ? out.length / counted : 0, words: [...new Set(out)] };
}
// Unknown words with English spelling patterns are treated as English (e.g. inside a mixed sentence).
// Spanish words rarely end in consonants other than n, s, r, l, d, z.
const EN_HINT = /(th|wh|sh|ck|ing$|tion$|ly$|^w|ou|ee|oo|[^aeiounsrldz]$)/;
const isLikelyEnglish = (w) => EN_HINT.test(w);

/**
 * All code metrics for one conversation. `opts.metrics` comes from the suite:
 * { target, native, levelRank, maxWords }.
 */
export function conversationMetrics(history, opts = {}) {
  const { target = 'es', native = 'en', levelRank = 1500, maxWords = 50, ranks = null } = opts;
  const a = history.filter((h) => h.role === 'assistant');
  const u = history.filter((h) => h.role === 'user');
  const lens = a.map((h) => wordCount(h.text));
  const aWords = lens.reduce((s, x) => s + x, 0);
  const uWords = u.reduce((s, h) => s + wordCount(h.text), 0);
  const allA = a.map((h) => h.text).join('\n');
  const above = aboveLevel(allA, { levelRank, native, target, ranks });
  return {
    turns: a.length,
    wordsMedian: quantile(lens, 0.5),
    wordsP90: quantile(lens, 0.9),
    wordsMax: Math.max(0, ...lens),
    monologues: lens.filter((x) => x > maxWords).length,
    stackedQuestions: a.filter((h) => (h.text.match(/\?/g) ?? []).length > 1).length,
    nativeShare: nativeShare(allA, { target, native }),
    aboveLevelShare: above.share,
    aboveLevelWords: above.words.slice(0, 25),
    userTalkShare: aWords + uWords ? uWords / (aWords + uWords) : 0,
  };
}

/**
 * Case checks: simple pass/fail rules on the assistant's turns, for things that must or must
 * never happen (e.g. never telling a beginner they're fluent).
 * check: { id, type: 'absent' | 'present', pattern, flags?, fromTurn? }
 */
export function runChecks(history, checks = []) {
  return checks.map((c) => {
    const re = new RegExp(c.pattern, c.flags ?? 'i');
    const hits = history.filter((h) => h.role === 'assistant' && h.turn >= (c.fromTurn ?? 0) && re.test(h.text)).map((h) => h.turn);
    const pass = c.type === 'absent' ? hits.length === 0 : hits.length > 0;
    return { id: c.id, description: c.description ?? '', pass, turns: hits };
  });
}
