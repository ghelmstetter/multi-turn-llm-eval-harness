// Browser side of loading: fetches suites and word lists over HTTP and keeps the daily spend in
// local storage. Mirrors load-node.js, so the browser runs the same engine as the CLI.
import { parseFrequencyList } from './graders/metrics.js';
import { validateSuite } from './suite.js';

const join = (base, name) => new URL(name, new URL(base.endsWith('/') ? base : `${base}/`, location.href)).href;

/** Load a suite from a folder URL: suite.json plus its word list, if it has one. */
export async function loadSuite(dirUrl) {
  const res = await fetch(join(dirUrl, 'suite.json'));
  if (!res.ok) throw new Error(`Couldn't load the suite at ${dirUrl} (${res.status})`);
  return attachWordList(await res.json(), dirUrl);
}

/** Attach a suite's word list from its folder URL (for suites edited or imported in the page). */
export async function attachWordList(suite, dirUrl) {
  const list = suite.metrics?.frequencyList;
  let found = false;
  if (list && dirUrl) {
    const res = await fetch(join(dirUrl, list));
    if (res.ok) { Object.defineProperty(suite, '_frequencyRanks', { value: parseFrequencyList(await res.text()), enumerable: false, configurable: true }); found = true; }
  }
  Object.defineProperty(suite, '_hasFile', { value: (name) => name === list && found, enumerable: false, configurable: true });
  return suite;
}

export const validateLoaded = (suite, targetsCfg = null) => validateSuite(suite, targetsCfg, { hasFile: suite._hasFile ?? null });

/** Today's evaluation spend in this browser. Falls back to no tracking if storage is blocked. */
export function localSpendStore(today = new Date().toISOString().slice(0, 10)) {
  const key = `mtle-spend-${today}`;
  return {
    read() { try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; } },
    write(usd) { try { localStorage.setItem(key, String(usd)); } catch { /* storage blocked: skip */ } },
  };
}
