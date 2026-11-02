// Run Eval: run an eval in the browser: pick or edit a suite, choose targets, add keys (or use free mock
// models), check the estimate, run, watch it live, and get the full report. Same engine as the
// CLI (../src), so the results.json it produces works with every CLI command.
// Keys stay in this page's memory (or this browser's storage, if the user opts in) and are sent
// only to the vendor they belong to.
import { loadSuite, attachWordList, validateLoaded, localSpendStore } from '../src/load-browser.js';
import { buildPlan, estimateFor, execute } from '../src/engine.js';
import { Budget, SECONDS_PER_CALL, durationText } from '../src/budget.js';
import { renderReport } from '../src/report/html.js';
import { extensionPlan, mergeExtension, settleSize, extensionEstimate, caseRepeats, extendedCases } from '../src/extend.js';
import { byCase } from '../src/analysis.js';
import { makeTarget } from '../src/targets/index.js';
import { runMirrored, runIndependent } from '../src/run.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (x) => `$${x < 0.1 ? x.toFixed(3) : x.toFixed(2)}`;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage blocked */ } },
};

const EXAMPLES = [
  { id: 'tutor-es', title: 'Spanish tutor for a beginner', dir: '../suites/tutor-es/' },
  { id: 'support-bikes', title: 'Customer support for a bike shop', dir: '../suites/support-bikes/' },
];
const VENDORS = { gemini: { name: 'Google Gemini', key: 'GEMINI_API_KEY' }, openai: { name: 'OpenAI', key: 'OPENAI_API_KEY' }, anthropic: { name: 'Anthropic', key: 'ANTHROPIC_API_KEY' } };
const KEYS_STORE = 'mtle-keys';

let box;
let S; // { suite, suiteText, dirUrl, cfg, keys, remember, mock, running, budget }

export async function mountRun(el) {
  box = el;
  const remembered = store.get(KEYS_STORE);
  S = { keys: remembered ?? {}, remember: Boolean(remembered), mock: true, running: false };
  let defaults = null;
  try { defaults = await (await fetch(new URL('../examples/targets.json', import.meta.url))).json(); } catch { /* fall back below */ }
  S.cfg = structuredClone(defaults ?? {
    targets: [
      { id: 'a', label: 'Target A', vendor: 'gemini', model: 'gemini-3.8-flash', prompt: null, temperature: 0.7, price: { input: 0.75, output: 3.75 } },
      { id: 'b', label: 'Target B', vendor: 'gemini', model: 'gemini-3.8-flash', prompt: null, temperature: 0.7, price: { input: 0.75, output: 3.75 } },
    ],
    user: { id: 'sim-user', vendor: 'gemini', model: 'gemini-3.8-flash', temperature: 0.9, price: { input: 0.75, output: 3.75 } },
    judge: { id: 'judge', vendor: 'gemini', model: 'gemini-3.8-flash', temperature: 0, price: { input: 0.75, output: 3.75 } },
  });
  S.cfg.targets = S.cfg.targets.slice(0, 2);
  render();
  markReady();
  await chooseExample(EXAMPLES[0]);
}

// ---------- suite ----------
async function chooseExample(ex) {
  setSuiteStatus('Loading the suite…');
  try {
    const suite = await loadSuite(new URL(ex.dir, import.meta.url).href);
    S.dirUrl = new URL(ex.dir, import.meta.url).href;
    S.exampleId = ex.id;
    setSuite(suite, JSON.stringify(suite, null, 2));
  } catch (e) { setSuiteStatus(`Couldn't load the suite: ${e.message}`, true); }
}

function setSuite(suite, text) {
  S.suite = suite;
  S.suiteText = text;
  // Keep each target's prompt variant valid for this suite.
  const variants = Object.keys(suite.prompts ?? {});
  S.cfg.targets.forEach((t, i) => { if (!variants.includes(t.prompt)) t.prompt = variants[Math.min(i, variants.length - 1)] ?? null; });
  S.caseIds = (suite.cases ?? []).map((c) => c.id);
  renderSuite();
  renderTargets();
  renderSettings();
  update();
}

async function onSuiteEdited(text) {
  S.suiteText = text;
  let suite;
  try { suite = JSON.parse(text); } catch (e) { S.suite = null; showProblems([`The suite isn't valid JSON: ${e.message}`]); update(); return; }
  await attachWordList(suite, S.dirUrl);
  S.suite = suite;
  const variants = Object.keys(suite.prompts ?? {});
  S.cfg.targets.forEach((t, i) => { if (!variants.includes(t.prompt)) t.prompt = variants[Math.min(i, variants.length - 1)] ?? null; });
  const known = new Set((suite.cases ?? []).map((c) => c.id));
  S.caseIds = (S.caseIds ?? []).filter((id) => known.has(id));
  if (!S.caseIds.length) S.caseIds = [...known];
  renderPromptForms();
  renderTargets();
  renderSettings();
  update();
}

// ---------- rendering ----------
function render() {
  box.innerHTML = `<div class="runner">
    <p class="open-saved small">Have a saved run? <button type="button" class="linkish" id="r-open-saved">Open its results.json</button> to see its report and settle its close cases. <input type="file" id="r-saved" accept=".json,application/json" hidden></p>
    <section class="card step" id="r-suite"><h3><span class="n">1</span> The suite</h3>
      <p class="small muted">What the assistant is, how it's prompted, the situations to test and how to judge them.</p>
      <div class="row">
        <label class="field inline"><span>Start from</span><select id="r-example">${EXAMPLES.map((e) => `<option value="${e.id}">${esc(e.title)}</option>`).join('')}<option value="import">Import a suite.json…</option></select></label>
        <input type="file" id="r-file" accept=".json,application/json" hidden>
      </div>
      <p id="r-suite-status" class="small muted"></p>
      <details id="r-edit"><summary>Edit the suite</summary>
        <div id="r-prompts"></div>
        <details class="json"><summary>All of it, as JSON</summary><textarea id="r-json" spellcheck="false" rows="18"></textarea>
          <p class="small muted">Changes are checked as you type. <button type="button" class="linkish" id="r-reset">Reset to the example</button> · <button type="button" class="linkish" id="r-export">Download suite.json</button></p></details>
      </details>
      <div id="r-problems"></div>
    </section>

    <section class="card step"><h3><span class="n">2</span> What to compare</h3>
      <p class="small muted">Two targets: each a model plus a prompt variant from the suite. Same model with two prompts is a prompt A/B test.</p>
      <div id="r-targets"></div>
      <details><summary>Simulated user and judge</summary><div id="r-roles"></div>
        <p class="small muted">A judge from a third vendor avoids judges' tendency to favor their own vendor's models.</p></details>
    </section>

    <section class="card step"><h3><span class="n">3</span> Keys</h3>
      <label class="check"><input type="checkbox" id="r-mock" checked> <span><b>Free mock models</b>, no keys needed. Mock models exercise the whole pipeline; their numbers only demonstrate the report.</span></label>
      <div id="r-keys"></div>
    </section>

    <section class="card step"><h3><span class="n">4</span> Settings</h3><div id="r-settings"></div></section>

    <section class="card step" id="r-go"><h3><span class="n">5</span> Run</h3>
      <p id="r-estimate" class="estimate"></p>
      <p class="actions"><button type="button" class="primary" id="r-run">Run</button><button type="button" id="r-stop" hidden>Stop</button></p>
      <div id="r-live"></div>
    </section>
    <section id="r-result"></section>
  </div>`;
  box.querySelector('#r-open-saved').addEventListener('click', () => box.querySelector('#r-saved').click());
  box.querySelector('#r-saved').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const results = JSON.parse(await f.text());
      if (!results?.meta?.targets || !Array.isArray(results.conversations)) throw new Error('this doesn\'t look like a results.json from the harness');
      showResult(results, { from: f.name });
    } catch (err) { box.querySelector('#r-result').innerHTML = `<p class="err">Couldn't open ${esc(f.name)}: ${esc(err.message)}</p>`; }
    e.target.value = '';
  });
  box.querySelector('#r-example').addEventListener('change', (e) => {
    if (e.target.value === 'import') { box.querySelector('#r-file').click(); return; }
    chooseExample(EXAMPLES.find((x) => x.id === e.target.value));
  });
  box.querySelector('#r-file').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    S.exampleId = null;
    S.dirUrl = null;
    const text = await f.text();
    box.querySelector('#r-json').value = text;
    box.querySelector('#r-edit').open = true;
    await onSuiteEdited(text);
    setSuiteStatus(`Imported ${f.name}. A word list for "words above level" can't be imported here; that metric is skipped unless the suite is an example.`);
  });
  let t;
  box.querySelector('#r-json').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => onSuiteEdited(e.target.value), 300); });
  box.querySelector('#r-reset').addEventListener('click', () => chooseExample(EXAMPLES.find((x) => x.id === (S.exampleId ?? 'tutor-es'))));
  box.querySelector('#r-export').addEventListener('click', () => download('suite.json', S.suiteText, 'application/json'));
  box.querySelector('#r-mock').addEventListener('change', (e) => { S.mock = e.target.checked; renderKeys(); update(); });
  box.querySelector('#r-run').addEventListener('click', run);
  box.querySelector('#r-stop').addEventListener('click', () => { S.budget?.stop('Stopped by you'); box.querySelector('#r-stop').disabled = true; box.querySelector('#r-stop').textContent = 'Stopping after the current call…'; });
  renderKeys();
}

function setSuiteStatus(msg, bad = false) {
  const el = box.querySelector('#r-suite-status');
  el.textContent = msg;
  el.className = `small ${bad ? 'fail' : 'muted'}`;
}

function renderSuite() {
  const s = S.suite;
  setSuiteStatus(`${s.title} · ${s.cases.length} cases · prompt variants: ${Object.keys(s.prompts).join(', ')}`);
  box.querySelector('#r-json').value = S.suiteText;
  box.querySelector('#r-example').value = S.exampleId ?? 'import';
  renderPromptForms();
}

function renderPromptForms() {
  const s = S.suite;
  const el = box.querySelector('#r-prompts');
  if (!s?.prompts) { el.innerHTML = ''; return; }
  el.innerHTML = `<p class="small muted">The prompts, the part most often edited. The rest of the suite is in the JSON below.</p>${Object.entries(s.prompts).map(([k, v]) => `<label class="field"><span>Prompt "${esc(k)}"${s.promptNotes?.[k] ? ` <span class="muted small">${esc(s.promptNotes[k])}</span>` : ''}</span><textarea data-prompt="${esc(k)}" rows="5" spellcheck="false">${esc(v)}</textarea></label>`).join('')}`;
  for (const ta of el.querySelectorAll('[data-prompt]')) ta.addEventListener('input', () => {
    try {
      const obj = JSON.parse(S.suiteText);
      obj.prompts[ta.dataset.prompt] = ta.value;
      const text = JSON.stringify(obj, null, 2);
      box.querySelector('#r-json').value = text;
      S.suiteText = text;
      S.suite.prompts[ta.dataset.prompt] = ta.value;
      update();
    } catch { /* JSON is mid-edit below; fix it there first */ }
  });
}

const vendorSelect = (v, attr) => `<select ${attr}>${Object.entries(VENDORS).map(([k, x]) => `<option value="${k}"${k === v ? ' selected' : ''}>${x.name}</option>`).join('')}</select>`;
const priceInputs = (p, attr) => `<span class="price"><input type="number" min="0" step="0.01" ${attr}="input" value="${p?.input ?? 0}" aria-label="Input price"> / <input type="number" min="0" step="0.01" ${attr}="output" value="${p?.output ?? 0}" aria-label="Output price"></span>`;

function renderTargets() {
  const variants = Object.keys(S.suite?.prompts ?? {});
  const el = box.querySelector('#r-targets');
  el.innerHTML = S.cfg.targets.map((t, i) => `<div class="target" data-i="${i}"><span class="sw" style="background:var(--s${i + 1})"></span>
    <label class="field"><span>Label</span><input type="text" data-k="label" value="${esc(t.label ?? t.id)}"></label>
    <label class="field"><span>Vendor</span>${vendorSelect(t.vendor, 'data-k="vendor"')}</label>
    <label class="field"><span>Model</span><input type="text" data-k="model" value="${esc(t.model ?? '')}" spellcheck="false"></label>
    <label class="field"><span>Prompt</span><select data-k="prompt">${variants.map((v) => `<option${v === t.prompt ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
    <label class="field"><span>Price per 1M tokens, in / out ($)</span>${priceInputs(t.price, 'data-price')}</label></div>`).join('');
  for (const row of el.querySelectorAll('.target')) bindRow(row, S.cfg.targets[Number(row.dataset.i)]);
  const roles = box.querySelector('#r-roles');
  roles.innerHTML = [['user', 'Simulated user'], ['judge', 'Judge']].map(([k, name]) => `<div class="target" data-role="${k}"><b class="role">${name}</b>
    <label class="field"><span>Vendor</span>${vendorSelect(S.cfg[k].vendor, 'data-k="vendor"')}</label>
    <label class="field"><span>Model</span><input type="text" data-k="model" value="${esc(S.cfg[k].model ?? '')}" spellcheck="false"></label>
    <label class="field"><span>Price in / out ($)</span>${priceInputs(S.cfg[k].price, 'data-price')}</label></div>`).join('');
  for (const row of roles.querySelectorAll('.target')) bindRow(row, S.cfg[row.dataset.role]);
}

function bindRow(row, obj) {
  for (const inp of row.querySelectorAll('[data-k]')) inp.addEventListener('input', () => { obj[inp.dataset.k] = inp.value; if (inp.dataset.k === 'vendor') renderKeys(); update(); });
  for (const inp of row.querySelectorAll('[data-price]')) inp.addEventListener('input', () => { obj.price = { ...obj.price, [inp.dataset.price]: Number(inp.value) || 0 }; update(); });
}

const usedVendors = () => [...new Set([...S.cfg.targets, S.cfg.user, S.cfg.judge].map((t) => t.vendor))];

function renderKeys() {
  const el = box.querySelector('#r-keys');
  if (S.mock) { el.innerHTML = '<p class="small muted">Turn off mock models to use real ones with your own API keys.</p>'; return; }
  el.innerHTML = `${usedVendors().map((v) => `<label class="field"><span>${VENDORS[v].name} API key</span><input type="password" autocomplete="off" spellcheck="false" data-key="${v}" value="${esc(S.keys[v] ?? '')}" placeholder="paste your key"></label>`).join('')}
    <label class="check"><input type="checkbox" id="r-remember"${S.remember ? ' checked' : ''}> <span>Remember my keys in this browser. Off by default: keys then live only in this page's memory and are gone when you close it.</span></label>
    <p class="small muted">Keys are sent only to their own vendor, straight from your browser. This page has no server, no analytics and no third-party scripts. Set a spending limit on each vendor's dashboard as a backstop.</p>`;
  for (const inp of el.querySelectorAll('[data-key]')) inp.addEventListener('input', () => { S.keys[inp.dataset.key] = inp.value.trim(); if (S.remember) store.set(KEYS_STORE, S.keys); update(); });
  el.querySelector('#r-remember').addEventListener('change', (e) => { S.remember = e.target.checked; if (S.remember) store.set(KEYS_STORE, S.keys); else store.del(KEYS_STORE); });
}

function renderSettings() {
  const s = S.suite;
  if (!s?.cases) return;
  const el = box.querySelector('#r-settings');
  el.innerHTML = `<fieldset class="cases"><legend>Cases</legend>${s.cases.map((c) => `<label class="check"><input type="checkbox" data-case="${esc(c.id)}"${S.caseIds.includes(c.id) ? ' checked' : ''}> <span>${esc(c.title ?? c.id)}</span></label>`).join('')}</fieldset>
    <div class="row">
      <label class="field"><span>Mode</span><select id="r-mode"><option value="mirrored">Mirrored (turn by turn)</option><option value="independent">Independent (whole conversations)</option></select></label>
      <label class="field"><span>Turns per conversation</span><input type="number" id="r-turns" min="1" max="20" value="6"></label>
      <label class="field"><span>Repeats</span><input type="number" id="r-repeats" min="1" max="10" value="1"></label>
      <label class="field"><span>Cap for this run ($)</span><input type="number" id="r-cap" min="0.05" step="0.25" value="1"></label>
      <label class="field"><span>Daily cap ($)</span><input type="number" id="r-daily" min="0.05" step="0.5" value="5"></label>
    </div>`;
  for (const cb of el.querySelectorAll('[data-case]')) cb.addEventListener('change', () => { S.caseIds = [...el.querySelectorAll('[data-case]:checked')].map((x) => x.dataset.case); update(); });
  for (const inp of el.querySelectorAll('select, input[type=number]')) inp.addEventListener('input', update);
}

function settings() {
  const v = (id, d) => box.querySelector(id)?.value ?? d;
  return { mode: v('#r-mode', 'mirrored'), turns: Number(v('#r-turns', 6)), repeats: Number(v('#r-repeats', 1)), cap: Number(v('#r-cap', 1)), daily: Number(v('#r-daily', 5)) };
}

function showProblems(list) {
  box.querySelector('#r-problems').innerHTML = list.length ? `<div class="problems"><b>To fix before running:</b><ul>${list.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : '';
}

// ---------- plan, estimate ----------
function makePlan() {
  const st = settings();
  const cfg = structuredClone(S.cfg);
  cfg.targets.forEach((t, i) => { t.id = t.id || `t${i + 1}`; t.mockBehavior = t.mockBehavior ?? (i === 0 ? 'verbose' : 'concise'); });
  if (cfg.targets[0].id === cfg.targets[1].id) cfg.targets[1].id += '-2';
  const env = Object.fromEntries(Object.entries(VENDORS).map(([k, v]) => [v.key, S.keys[k] ?? '']));
  const plan = buildPlan(S.suite, cfg, { mode: st.mode, cases: S.caseIds.join(','), turns: st.turns, repeats: st.repeats, mock: S.mock, 'max-usd': st.cap, 'daily-usd': st.daily }, { fetchImpl: (...a) => fetch(...a), env, validate: validateLoaded });
  return { plan, st };
}

function update() {
  const est = box.querySelector('#r-estimate');
  const runBtn = box.querySelector('#r-run');
  if (!S.suite) { runBtn.disabled = true; est.textContent = ''; return; }
  const problems = [];
  if (!S.caseIds?.length) problems.push('Pick at least one case.');
  let plan = null;
  let st = null;
  try { ({ plan, st } = makePlan()); } catch (e) { problems.push(...String(e.message).replace(/^The suite or targets file needs fixing:\n/, '').split('\n').map((x) => x.replace(/^\s*-\s*/, '')).filter(Boolean)); }
  if (plan && !S.mock) {
    const missing = usedVendors().filter((v) => !S.keys[v]);
    if (missing.length) problems.push(`Add your ${missing.map((v) => VENDORS[v].name).join(' and ')} API key, or turn on mock models.`);
  }
  showProblems(problems);
  if (!plan) { est.textContent = ''; runBtn.disabled = true; return; }
  const e = estimateFor(plan);
  const spent = localSpendStore().read();
  const convs = plan.cases.length * plan.repeats * (plan.mode === 'mirrored' ? 2 : plan.targets.length);
  est.innerHTML = S.mock
    ? `<b>Free</b> with mock models · ${convs} conversations, ${e.calls} model calls · ${durationText(e.calls * 0.05)}`
    : `Estimated <b>${usd(e.totalUsd)}</b> and <b>${durationText(e.calls * SECONDS_PER_CALL)}</b> · ${convs} conversations, ${e.calls} model calls, one at a time. Caps: ${usd(st.cap)} for this run, ${usd(st.daily)} per day (${usd(spent)} spent today in this browser).${e.totalUsd > st.cap ? ' <b class="fail">The estimate is over this run\'s cap: the run would stop early, keeping what it finished.</b>' : ''}`;
  runBtn.disabled = problems.length > 0 || S.running;
}

// ---------- running ----------
async function run() {
  let plan;
  try { ({ plan } = makePlan()); } catch (e) { showProblems([e.message]); return; }
  const st = settings();
  const total = plan.cases.length * plan.repeats * (plan.mode === 'mirrored' ? 2 : plan.targets.length);
  const budget = new Budget({ runCapUsd: st.cap, dailyCapUsd: st.daily, spendStore: S.mock ? null : localSpendStore() });
  S.budget = budget;
  S.running = true;
  box.querySelector('.runner').classList.add('is-running');
  for (const el of box.querySelectorAll('#r-suite, .step:not(#r-go)')) el.inert = true;
  box.querySelector('#r-run').hidden = true;
  const stop = box.querySelector('#r-stop');
  Object.assign(stop, { hidden: false, disabled: false, textContent: 'Stop' });
  box.querySelector('#r-result').innerHTML = '';
  const live = box.querySelector('#r-live');
  live.innerHTML = `<div class="bar"><i style="width:0%"></i></div><p class="progress small"></p><div class="feed" aria-live="off"></div>`;
  const bar = live.querySelector('.bar i');
  const prog = live.querySelector('.progress');
  const feed = live.querySelector('.feed');
  const t0 = Date.now();
  let k = 0;
  let current = '';
  const tick = () => {
    const secs = (Date.now() - t0) / 1000;
    const left = k > 1 ? ` · ${durationText((secs / (k - 1)) * (total - k + 1))} left` : '';
    prog.textContent = `Conversation ${Math.max(k, 1)} of ${total}${left} · ${budget.calls} model calls · ${usd(budget.spent)} spent${current ? ` · ${current}` : ''}`;
    bar.style.width = `${(100 * Math.max(0, k - 1)) / total}%`;
  };
  const timer = setInterval(tick, 500);
  // Show replies as they arrive: wrap each model's chat to post to the live feed.
  const ids = plan.targets.map((t) => t.id);
  const roleName = plan.suite.roleNames ?? { assistant: 'assistant', user: 'user' };
  const wrap = (t, kind) => {
    const chat = t.chat.bind(t);
    t.chat = async (req) => {
      if (S.mock) await new Promise((r) => setTimeout(r, 40)); // so a mock run is watchable
      const out = await chat(req);
      const purpose = req.purpose ?? 'assistant';
      if (purpose === 'assistant' || purpose === 'user') {
        const who = purpose === 'user' ? `${roleName.user} (simulated)` : `${roleName.assistant}: ${t.label}`;
        const cls = purpose === 'user' ? 'user' : `s${ids.indexOf(t.id) + 1}`;
        feed.insertAdjacentHTML('beforeend', `<div class="msg ${cls}"><span class="who">${esc(who)}</span>${esc(out.text)}</div>`);
        while (feed.children.length > 8) feed.firstElementChild.remove();
        feed.scrollTop = feed.scrollHeight;
      } else current = purpose === 'pairwise' ? 'judging a turn' : 'scoring the conversation';
      return out;
    };
    return kind;
  };
  for (const t of plan.targets) wrap(t, 'target');
  wrap(plan.user, 'user');
  wrap(plan.judge, 'judge');
  let results;
  try {
    results = await execute(plan, { budget, version: 'web', log: (msg) => { k++; current = msg.replace(/^[^:]+: /, ''); feed.insertAdjacentHTML('beforeend', `<p class="conv small muted">${esc(msg)}</p>`); tick(); } });
  } catch (e) {
    live.insertAdjacentHTML('beforeend', `<p class="err">The run failed: ${esc(e.message)}</p>`);
  } finally {
    clearInterval(timer);
    S.running = false;
    box.querySelector('.runner').classList.remove('is-running');
    for (const el of box.querySelectorAll('#r-suite, .step')) el.inert = false;
    stop.hidden = true;
    box.querySelector('#r-run').hidden = false;
    update();
  }
  if (!results) return;
  bar.style.width = '100%';
  prog.textContent = `${results.partial ? `Stopped early: ${results.stopReason}. Results so far are kept. ` : 'Done. '}${budget.calls} model calls · ${usd(budget.spent)} spent · ${durationText((Date.now() - t0) / 1000)}.`;
  showResult(results);
}

/** Open a published run (from the Previous Runs gallery) to view and extend it. */
export async function openSavedRun(url, title = '') {
  await ready;
  const el = box.querySelector('#r-result');
  el.innerHTML = '<p class="muted">Loading the run…</p>';
  el.scrollIntoView({ block: 'start' });
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`it returned ${res.status}`);
    showResult(await res.json(), { from: title || 'the gallery' });
  } catch (e) { el.innerHTML = `<p class="err">Couldn't load the run: ${esc(e.message)}</p>`; }
}
let markReady;
const ready = new Promise((r) => { markReady = r; });

function showResult(results, { from = null } = {}) {
  S.results = results;
  const html = renderReport(results);
  const el = box.querySelector('#r-result');
  el.innerHTML = `<div class="card result"><h3>The report${from ? ` <span class="muted small">from ${esc(from)}</span>` : ''}</h3>
    <div id="r-extend"></div>
    <p class="actions"><button type="button" class="primary" id="r-dl">Download results.json</button><button type="button" id="r-dl-html">Download report.html</button><button type="button" id="r-open">Open in a new tab</button></p>
    <p class="small muted">results.json works with every command-line command: re-score it, extend it, compare it with another run, or publish it. Nothing is saved anywhere unless you download it.</p>
    <iframe id="r-frame" title="Report" sandbox="allow-scripts allow-popups"></iframe></div>`;
  const frame = el.querySelector('#r-frame');
  frame.srcdoc = html;
  el.querySelector('#r-dl').addEventListener('click', () => download('results.json', JSON.stringify(results, null, 2), 'application/json'));
  el.querySelector('#r-dl-html').addEventListener('click', () => download('report.html', html, 'text/html'));
  el.querySelector('#r-open').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([html], { type: 'text/html' })); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60000); });
  renderExtend(results);
  el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// ---------- settling close cases: extend, in the browser ----------
function renderExtend(results) {
  const panel = box.querySelector('#r-extend');
  const m = results.meta;
  const title = (id) => (m.caseInfo ?? []).find((c) => c.id === id)?.title ?? id;
  const done = extendedCases(results);
  const reps = caseRepeats(results);
  const open = byCase(results).filter((c) => c.share?.interval && !c.share.interval.settled);
  if (results.partial) { panel.innerHTML = '<p class="small muted">This run stopped early, so it can\'t be extended; run it again instead.</p>'; return; }
  if (!open.length) { panel.innerHTML = '<p class="small muted">Every case in this run is settled: nothing to extend.</p>'; return; }
  const rows = open.map((c) => {
    if (done.has(c.case)) return `<tr><th>${esc(title(c.case))}</th><td>${c.share.n}</td><td colspan="3" class="muted">Already extended once. To settle it, plan a new run with more repeats.</td></tr>`;
    const s = settleSize(c.share, c.share.n / (reps[c.case] || 1));
    const k = s?.repeats ?? 3;
    return `<tr data-case="${esc(c.case)}"><th>${esc(title(c.case))}</th><td>${c.share.n}</td>
      <td><input type="number" min="1" max="10" value="${k}" class="ext-n" aria-label="More repeats for ${esc(title(c.case))}">${s ? `<span class="small muted"> suggested</span>` : '<span class="small muted"> (unlikely to settle with 5 or fewer)</span>'}</td>
      <td class="ext-est small"></td><td><button type="button" class="ext-go">Extend</button></td></tr>`;
  }).join('');
  panel.innerHTML = `<details class="extend"${S.extendOpen === false ? '' : ' open'}><summary><b>Settle the close cases</b> <span class="muted small">${open.length} not settled</span></summary>
    <p class="small">Add more conversations to a case to narrow its interval. The suggested number would likely settle it even if its lead shrank by a quarter. Choose the number once: each case can be extended once, because adding a few at a time until a case happens to settle makes luck look like a result.${m.mock ? ' This is a mock run, so extending it is free.' : ` Uses the run's own models and settings, with your ${[...new Set([...m.targets, m.user, m.judge].map((t) => VENDORS[t.vendor]?.name ?? t.vendor))].join(' and ')} key from step 3.`}</p>
    <div class="tw"><table><tr><th>Case</th><th>Turns now</th><th>More repeats</th><th>Estimated</th><th></th></tr>${rows}</table></div>
    <p class="ext-status small" aria-live="polite"></p></details>`;
  panel.querySelector('details').addEventListener('toggle', (e) => { S.extendOpen = e.target.open; });
  const est = (tr) => {
    const n = Math.max(1, Math.min(10, Number(tr.querySelector('.ext-n').value) || 1));
    const e = extensionEstimate(results, 1, n);
    tr.querySelector('.ext-est').textContent = m.mock ? `free, ${durationText(e.calls * 0.05)}` : `${usd(e.usd)}, ${durationText(e.seconds)}`;
  };
  for (const tr of panel.querySelectorAll('tr[data-case]')) {
    est(tr);
    tr.querySelector('.ext-n').addEventListener('input', () => est(tr));
    tr.querySelector('.ext-go').addEventListener('click', () => extendCase(results, tr.dataset.case, Number(tr.querySelector('.ext-n').value)));
  }
}

async function extendCase(results, caseId, repeats) {
  const panel = box.querySelector('#r-extend');
  const status = panel.querySelector('.ext-status');
  const say = (msg, bad = false) => { status.innerHTML = msg; status.className = `ext-status small${bad ? ' fail' : ''}`; };
  if (S.running) { say('Another run is in progress.', true); return; }
  const m = results.meta;
  // The run's own suite: the one in step 1 if it matches, otherwise the example with that id.
  let suite = S.suite?.id === m.suite.id ? S.suite : null;
  if (!suite) {
    try { suite = await loadSuite(new URL(`../suites/${m.suite.id}/`, import.meta.url).href); } catch { /* not an example */ }
  }
  if (!suite) { say(`This run's suite ("${esc(m.suite.id)}") isn't one of the examples. Import its suite.json in step 1, then try again.`, true); return; }
  let ext;
  try { ext = extensionPlan(results, suite, { cases: [caseId], repeats }); } catch (e) { say(esc(e.message).replace(/\n/g, '<br>'), true); return; }
  const env = Object.fromEntries(Object.entries(VENDORS).map(([k, v]) => [v.key, S.keys[k] ?? '']));
  const opts = { fetchImpl: (...a) => fetch(...a), env, mock: Boolean(m.mock) };
  const targets = m.targets.map((t) => makeTarget(t, opts));
  const user = makeTarget(m.user, opts);
  const judge = makeTarget(m.judge, opts);
  const missing = [...new Set([...targets, user, judge].filter((t) => !t.ready).map((t) => VENDORS[t.vendor]?.name ?? t.vendor))];
  if (missing.length) { say(`Add your ${missing.join(' and ')} API key in step 3 first (untick mock models there to see the key fields).`, true); return; }
  const st = settings();
  const budget = new Budget({ runCapUsd: st.cap, dailyCapUsd: st.daily, spendStore: m.mock ? null : localSpendStore() });
  S.budget = budget;
  S.running = true;
  update();
  for (const b of panel.querySelectorAll('button, input')) b.disabled = true;
  const total = repeats * (m.mode === 'mirrored' ? 2 : m.targets.length);
  let k = 0;
  const t0 = Date.now();
  say(`Extending: conversation 1 of ${total}… <button type="button" class="linkish" id="ext-stop">Stop</button>`);
  const tick = () => {
    const left = k > 1 ? ` · ${durationText(((Date.now() - t0) / 1000 / (k - 1)) * (total - k + 1))} left` : '';
    const line = status.querySelector('.line');
    const text = `Extending ${esc(caseId)}: conversation ${Math.max(k, 1)} of ${total}${left} · ${budget.calls} model calls · ${usd(budget.spent)} spent`;
    if (line) line.textContent = text; else status.innerHTML = `<span class="line">${text}</span> · <button type="button" class="linkish" id="ext-stop">Stop</button>`;
    status.querySelector('#ext-stop')?.addEventListener('click', () => budget.stop('Stopped by you'), { once: true });
  };
  const timer = setInterval(tick, 500);
  if (m.mock) for (const t of [...targets, user, judge]) { const chat = t.chat.bind(t); t.chat = async (req) => { await new Promise((r) => setTimeout(r, 40)); return chat(req); }; }
  let out;
  try {
    const runner = m.mode === 'mirrored' ? runMirrored : runIndependent;
    out = await runner({ suite, cases: [suite.cases.find((c) => c.id === caseId)], targets, mode: m.mode, user, judge, turns: m.turns, repeats, repeatStart: ext.repeatStart, rubric: Boolean(m.rubric), budget, log: () => { k++; tick(); } });
  } catch (e) {
    clearInterval(timer);
    S.running = false;
    update();
    say(`The extension failed: ${esc(e.message)}`, true);
    for (const b of panel.querySelectorAll('button, input')) b.disabled = false;
    return;
  }
  clearInterval(timer);
  S.running = false;
  update();
  const merged = mergeExtension(results, { cases: [caseId], repeats, conversations: out.conversations, pairs: out.pairs ?? [], budget: budget.summary(), partial: out.partial, stopReason: out.stopReason }, suite);
  const c = byCase(merged).find((x) => x.case === caseId);
  const iv = c?.share?.interval;
  showResult(merged, { from: 'this page (extended; download results.json to keep it)' });
  const s2 = box.querySelector('#r-extend .ext-status') ?? box.querySelector('#r-extend');
  const lead = iv && (iv.rate >= 0.5 ? m.targets[0].label : m.targets[1].label);
  const pct = (x) => `${Math.round(x * 100)}%`;
  const msg = `${out.partial ? `Stopped early (${esc(out.stopReason)}); kept what finished. ` : ''}Extended "${esc(c ? (m.caseInfo ?? []).find((x) => x.id === caseId)?.title ?? caseId : caseId)}" by ${repeats} repeat${repeats > 1 ? 's' : ''} (${usd(budget.spent)}). ${iv ? `Now ${c.share.n} turns: ${esc(lead)} ${pct(Math.max(iv.rate, 1 - iv.rate))} (95% interval ${pct(iv.rate >= 0.5 ? iv.ci[0] : 1 - iv.ci[1])}–${pct(iv.rate >= 0.5 ? iv.ci[1] : 1 - iv.ci[0])}), <b>${iv.settled ? 'settled' : 'still not settled'}</b>.` : ''} Download results.json to keep it.`;
  const note = document.createElement('p');
  note.className = 'ext-done small';
  note.innerHTML = msg;
  box.querySelector('#r-extend').prepend(note);
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Leaving mid-run loses it: warn first.
addEventListener('beforeunload', (e) => { if (S?.running) { e.preventDefault(); e.returnValue = ''; } });
