// Node side of loading: reads suites and word lists from disk and keeps the daily spend in a
// file. The engine itself never touches the file system, so the browser can run it too
// (see load-browser.js for the browser side).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseFrequencyList } from './graders/metrics.js';
import { validateSuite } from './suite.js';

/** Read a word list (.tsv of rank and form) into a Map of form -> rank. */
export const readFrequencyList = (file) => parseFrequencyList(readFileSync(file, 'utf8'));

/**
 * Load a suite folder: suite.json plus its word list, if it has one (attached as a hidden
 * property, so saved results don't carry it).
 */
export function loadSuite(dir) {
  const suiteDir = resolve(dir);
  const suite = JSON.parse(readFileSync(join(suiteDir, 'suite.json'), 'utf8'));
  const list = suite.metrics?.frequencyList;
  if (list && existsSync(join(suiteDir, list))) Object.defineProperty(suite, '_frequencyRanks', { value: readFrequencyList(join(suiteDir, list)), enumerable: false });
  Object.defineProperty(suite, '_hasFile', { value: (name) => existsSync(join(suiteDir, name)), enumerable: false });
  return suite;
}

/** Validate a loaded suite, checking files in its folder too. */
export const validateLoaded = (suite, targetsCfg = null) => validateSuite(suite, targetsCfg, { hasFile: suite._hasFile ?? null });

/** Today's evaluation spend, kept in <dir>/spend-YYYY-MM-DD.json. */
export function fileSpendStore(dir, today = new Date().toISOString().slice(0, 10)) {
  const file = join(dir, `spend-${today}.json`);
  return {
    read() { try { return JSON.parse(readFileSync(file, 'utf8')).usd ?? 0; } catch { return 0; } },
    write(usd) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify({ usd })); },
  };
}
