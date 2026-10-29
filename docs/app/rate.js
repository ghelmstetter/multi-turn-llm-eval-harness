// Rate blind: pick the better of two anonymized replies, turn by turn, then see how often the
// LLM judge agreed. Ratings stay in this browser (so a session can be resumed) and export as
// ratings.json, which the CLI adds to a run's report with `report … --ratings ratings.json`.
import { ratingItems, sampleItems } from '../src/ratings.js';
import { agreementSection } from '../src/report/agreement.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Replies are plain text with a little markdown (bold, italics); show those, nothing else.
const rich = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: the session just won't resume */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

let S = null; // the session: { run, results, items: Map, sample, picks, i, startedAt }
let box = null;
let ctx0 = null; // { runs, loadResults } for returning to the start screen
const keyOf = (runId) => `mtle-rate-${runId}`;

export function mountRate(el, runs, loadResults) {
  box = el;
  S = null;
  ctx0 = { runs, loadResults };
  const mirrored = runs.filter((r) => r.mode === 'mirrored' && !r.mock);
  if (!mirrored.length) { box.innerHTML = '<p class="muted">No mirrored runs to rate yet. Blind rating needs a run in mirrored mode, where both targets answered every turn.</p>'; return; }
  startScreen(mirrored, loadResults);
}

function startScreen(runs, loadResults) {
  const opts = runs.map((r) => `<option value="${esc(r.id)}">${esc(r.title)}</option>`).join('');
  box.innerHTML = `<div class="rate-start card">
    <h2>Rate blind</h2>
    <p>You'll see a moment from a conversation, then two replies that could come next, labeled only <b>Reply 1</b> and <b>Reply 2</b>. Pick the better one, or call it a tie. The names are hidden and the order is shuffled every time. These are the same pairs the LLM judge compared, so at the end you'll see how often it agreed with you.</p>
    <label class="field"><span>Run</span><select id="rate-run">${opts}</select></label>
    <label class="field"><span>How many turns</span><select id="rate-n"></select></label>
    <div id="rate-resume"></div>
    <p class="actions"><button type="button" class="primary" id="rate-go">Start rating</button></p>
    <p class="muted small">Everything stays in this browser. Nothing is sent anywhere; at the end you can download your ratings.</p>
  </div>`;
  const sel = box.querySelector('#rate-run');
  const nSel = box.querySelector('#rate-n');
  const refresh = async () => {
    const run = runs.find((r) => r.id === sel.value);
    const per = [3, 6].map((k) => k * run.cases);
    nSel.innerHTML = per.map((n) => `<option value="${n}"${n === per[1] ? ' selected' : ''}>${n} turns (about ${Math.round(n * 0.6)} minutes)</option>`).join('') + `<option value="0">All of them (each case's shared first turn once)</option>`;
    const saved = store.get(keyOf(run.id));
    const done = saved ? Object.keys(saved.picks ?? {}).length : 0;
    box.querySelector('#rate-resume').innerHTML = saved && done
      ? `<p class="resume">You have a session in progress: ${done} of ${saved.sample.length} rated. <button type="button" class="linkish" id="rate-continue">Continue it</button> · <button type="button" class="linkish" id="rate-discard">Start over</button></p>`
      : '';
    box.querySelector('#rate-continue')?.addEventListener('click', () => begin(run, loadResults, saved));
    box.querySelector('#rate-discard')?.addEventListener('click', () => { store.del(keyOf(run.id)); refresh(); });
  };
  sel.addEventListener('change', refresh);
  refresh();
  box.querySelector('#rate-go').addEventListener('click', () => {
    const run = runs.find((r) => r.id === sel.value);
    const saved = store.get(keyOf(run.id));
    if (saved && Object.keys(saved.picks ?? {}).length && !confirmReplace()) return;
    begin(run, loadResults, null, Number(nSel.value));
  });
  function confirmReplace() {
    // No browser dialogs: show an inline confirmation instead.
    const r = box.querySelector('#rate-resume');
    if (r.dataset.confirm) return true;
    r.dataset.confirm = '1';
    r.insertAdjacentHTML('beforeend', '<p class="warn">Starting a new session replaces the one in progress. Press Start rating again to confirm.</p>');
    return false;
  }
}

async function begin(run, loadResults, saved, n = 0) {
  box.innerHTML = '<p class="muted">Loading the run…</p>';
  const results = await loadResults(run);
  const all = ratingItems(results);
  const ids = results.meta.targets.slice(0, 2).map((t) => t.id);
  const seed = saved?.seed ?? (Math.floor(Math.random() * 2 ** 31) || 1);
  const sample = saved?.sample ?? sampleItems(all, n || all.length, seed, ids);
  S = { run, results, items: new Map(all.map((it) => [it.key, it])), sample, seed, picks: saved?.picks ?? {}, i: 0, startedAt: saved?.startedAt ?? new Date().toISOString(), shownAt: 0 };
  S.i = S.sample.findIndex((x) => !S.picks[x.key]);
  if (S.i < 0) return finish();
  save();
  show();
}

const save = () => store.set(keyOf(S.run.id), { seed: S.seed, sample: S.sample, picks: S.picks, startedAt: S.startedAt, startedAtRun: S.results.meta.startedAt });

function show() {
  const x = S.sample[S.i];
  const it = S.items.get(x.key);
  const meta = S.results.meta;
  const roles = { assistant: meta.roleNames?.assistant ?? 'assistant', user: meta.roleNames?.user ?? 'user' };
  const info = (meta.caseInfo ?? []).find((c) => c.id === it.case);
  const done = Object.keys(S.picks).length;
  const ctx = it.context;
  const recent = 4;
  const msg = (m) => `<div class="msg ${m.role === 'user' ? 'user' : 'tutor'}"><span class="who">${esc(roles[m.role])}</span>${rich(m.text)}</div>`;
  const older = ctx.length > recent ? `<details class="earlier"><summary>Show the ${ctx.length - recent} earlier message${ctx.length - recent > 1 ? 's' : ''}</summary><div class="transcript">${ctx.slice(0, -recent).map(msg).join('')}</div></details>` : '';
  box.innerHTML = `<div class="rate">
    <div class="rate-top"><span>Turn ${S.i + 1} of ${S.sample.length}</span><span class="muted">${done} rated</span></div>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${S.sample.length}" aria-valuenow="${done}"><i style="width:${(100 * done) / S.sample.length}%"></i></div>
    <div class="case card"><b>${esc(info?.title ?? it.case)}</b>${info?.goal ? `<p class="small">${esc(info.goal)}</p>` : ''}</div>
    <h3>The conversation so far</h3>
    ${older}<div class="transcript">${ctx.length ? ctx.slice(-recent).map(msg).join('') : `<p class="muted small">This is the start of the conversation: the ${esc(roles.assistant)} speaks first.</p>`}</div>
    <h3>${esc(meta.suite?.pairwiseQuestion ?? 'Which reply is better here?')}</h3>
    <div class="pair">${x.order.map((id, k) => `<div class="reply"><span class="who">Reply ${k + 1}</span>${rich(it.replies[id])}</div>`).join('')}</div>
    <div class="choices">
      <button type="button" data-pick="0"><kbd>1</kbd> Reply 1 is better</button>
      <button type="button" data-pick="tie"><kbd>T</kbd> About the same</button>
      <button type="button" data-pick="1"><kbd>2</kbd> Reply 2 is better</button>
    </div>
    <label class="field reason"><span>Why? <span class="muted">(optional, one line)</span></span><input id="rate-why" type="text" maxlength="200" autocomplete="off" placeholder="e.g. Reply 2 corrects the mistake without lecturing"></label>
    <p class="actions small"><button type="button" class="linkish" data-pick="skip"><kbd>S</kbd> Skip this one</button>${S.i > 0 ? ' · <button type="button" class="linkish" id="rate-back"><kbd>U</kbd> Back</button>' : ''} · <button type="button" class="linkish" id="rate-stop">Stop and see results so far</button></p>
  </div>`;
  S.shownAt = performance.now();
  for (const b of box.querySelectorAll('[data-pick]')) b.addEventListener('click', () => pick(b.dataset.pick));
  box.querySelector('#rate-back')?.addEventListener('click', back);
  box.querySelector('#rate-stop').addEventListener('click', finish);
  box.querySelector('.rate').scrollIntoView({ block: 'start' });
}

function pick(p) {
  const x = S.sample[S.i];
  const why = box.querySelector('#rate-why')?.value.trim() ?? '';
  const choice = p === 'tie' || p === 'skip' ? p : x.order[Number(p)];
  S.picks[x.key] = { pick: choice, reason: why || undefined, order: x.order, ms: Math.round(performance.now() - S.shownAt), at: new Date().toISOString() };
  save();
  S.i = S.sample.findIndex((y, j) => j > S.i && !S.picks[y.key]);
  if (S.i < 0) S.i = S.sample.findIndex((y) => !S.picks[y.key]);
  if (S.i < 0) finish(); else show();
}

function back() {
  const prev = S.i - 1;
  if (prev < 0) return;
  delete S.picks[S.sample[prev].key];
  S.i = prev;
  save();
  show();
}

function exportRatings() {
  return {
    version: 1,
    tool: 'multi-turn-llm-eval-harness',
    run: { id: S.run.id, startedAt: S.results.meta.startedAt },
    sample: { seed: S.seed, size: S.sample.length },
    startedAt: S.startedAt,
    exportedAt: new Date().toISOString(),
    items: S.sample.filter((x) => S.picks[x.key]).map((x) => ({ key: x.key, ...S.picks[x.key] })),
  };
}

function finish() {
  const ratings = exportRatings();
  const rated = ratings.items.filter((r) => r.pick !== 'skip').length;
  const left = S.sample.length - ratings.items.length;
  const section = agreementSection(S.results, ratings, { you: true });
  box.innerHTML = `<div class="rate-done">
    ${section || '<p>No turns rated yet.</p>'}
    <p class="muted small">${rated} rated${ratings.items.length - rated ? `, ${ratings.items.length - rated} skipped` : ''}${left ? `, ${left} not reached yet` : ''}. The judge used the same pairs; the names above are now revealed.</p>
    <p class="actions"><button type="button" class="primary" id="rate-dl">Download ratings.json</button>${left ? '<button type="button" id="rate-more">Keep rating</button>' : ''}<button type="button" id="rate-new">Start a new session</button></p>
    <p class="muted small">To add your ratings to the run's report, run this in the repo folder:</p>
    <pre class="cmd">node src/cli.js report ${esc(S.run.results.replace(/^\.\.\//, 'docs/'))} --ratings ratings.json --rater "Your name"</pre>
  </div>`;
  box.querySelector('#rate-dl').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(ratings, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'ratings.json' });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  box.querySelector('#rate-more')?.addEventListener('click', () => { S.i = S.sample.findIndex((x) => !S.picks[x.key]); show(); });
  box.querySelector('#rate-new').addEventListener('click', () => { store.del(keyOf(S.run.id)); mountRate(box, ctx0.runs, ctx0.loadResults); });
  box.scrollIntoView({ block: 'start' });
}

// Keyboard: 1 / 2 / T / S / U, unless typing in the reason box.
addEventListener('keydown', (e) => {
  if (!S || !box?.querySelector('.rate') || location.hash !== '#rate') return;
  if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const map = { 1: '0', 2: '1', t: 'tie', s: 'skip' };
  if (k in map) { e.preventDefault(); pick(map[k]); } else if (k === 'u') { e.preventDefault(); back(); }
});
