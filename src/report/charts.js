// Small inline-SVG charts for the report (no libraries, so the report stays one file that
// opens anywhere). Colors are CSS variables set by the report: --s1 / --s2 for the two
// targets (fixed order: first target blue, second green), --tie for ties, --r1..--r3 for
// cost roles. Every mark has a hover tooltip (data-tip), values are direct-labeled, and the
// tables in the report double as the table view.

import { shareInterval } from '../run.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => `${Math.round(x * 100)}%`;

/** Legend: a swatch and a name per series. */
export function legend(items) {
  return `<div class="legend">${items.map((it) => `<span><i style="background:var(${it.color})"></i>${esc(it.label)}</span>`).join('')}</div>`;
}

/** A rounded-end bar segment path from x to x+w (rounded only at the data end when `end`). */
function seg(x, y, w, h, { left = false, right = false, r = 4 } = {}) {
  const rl = left ? Math.min(r, w / 2) : 0;
  const rr = right ? Math.min(r, w / 2) : 0;
  return `M${x + rl},${y} H${x + w - rr} ${rr ? `Q${x + w},${y} ${x + w},${y + rr}` : ''} V${y + h - rr} ${rr ? `Q${x + w},${y + h} ${x + w - rr},${y + h}` : ''} H${x + rl} ${rl ? `Q${x},${y + h} ${x},${y + h - rl}` : ''} V${y + rl} ${rl ? `Q${x},${y} ${x + rl},${y}` : ''} Z`;
}

/**
 * Head-to-head shares: one 100% bar per row, split into A wins | ties | B wins.
 * rows: [{ label, a, tie, b, n }] as fractions. Under each bar, a whisker shows the 95%
 * interval of the first target's win rate (ties as half): if it crosses the 50% line, the
 * row isn't settled.
 */
export function winShareChart(rows, names) {
  // Row labels sit above their bars, so long target names never get cut off.
  const W = 720; const lw = 0; const bw = W; const bh = 22; const gap = 38;
  const H = rows.length * (bh + gap);
  const bars = rows.map((r, i) => {
    const y = 20 + i * (bh + gap);
    const parts = [[r.a, '--s1', names[0]], [r.tie, '--tie', 'Ties'], [r.b, '--s2', names[1]]].filter(([v]) => v > 0);
    let x = lw;
    const segs = parts.map(([v, c, who], k) => {
      const w = Math.max(0, v * bw - (k < parts.length - 1 ? 2 : 0)); // 2px surface gap between segments
      const tip = `${who}: ${pct(v)} of ${r.n} comparisons (${r.label.toLowerCase()})`;
      const label = w > 34 ? `<text x="${x + w / 2}" y="${y + bh / 2 + 4}" class="in ${c === '--tie' ? 'dark' : ''}" text-anchor="middle">${pct(v)}</text>` : '';
      const out = `<path d="${seg(x, y, w, bh, { left: k === 0, right: k === parts.length - 1 })}" style="fill:var(${c})" data-tip="${esc(tip)}"/>${label}`;
      x += w + 2;
      return out;
    }).join('');
    const iv = shareInterval(r);
    let whisker = '';
    let status = '';
    if (iv) {
      const [x0, x1, xm, wy] = [lw + iv.ci[0] * bw, lw + iv.ci[1] * bw, lw + iv.rate * bw, y + bh + 7];
      const lead = iv.rate >= 0.5 ? names[0] : names[1];
      const lr = iv.rate >= 0.5 ? iv.rate : 1 - iv.rate;
      const lci = iv.rate >= 0.5 ? iv.ci : [1 - iv.ci[1], 1 - iv.ci[0]];
      const tip = `${lead}: ${pct(lr)} win rate, ties as half (95% interval ${pct(lci[0])}–${pct(lci[1])}). ${iv.settled ? 'The interval excludes 50%: settled.' : 'The interval includes 50%: not settled.'}`;
      whisker = `<g class="ci" data-tip="${esc(tip)}"><line x1="${x0}" x2="${x1}" y1="${wy}" y2="${wy}"/><line x1="${x0}" x2="${x0}" y1="${wy - 3}" y2="${wy + 3}"/><line x1="${x1}" x2="${x1}" y1="${wy - 3}" y2="${wy + 3}"/><circle cx="${xm}" cy="${wy}" r="2.5"/><rect x="${x0}" y="${wy - 5}" width="${Math.max(1, x1 - x0)}" height="10" fill="transparent"/></g>`;
      status = `<text x="${W}" y="${y - 6}" class="tick" text-anchor="end">${iv.settled ? `settled: ${esc(lead)}` : 'not settled'}</text>`;
    }
    return `<text x="0" y="${y - 6}" class="lab">${esc(r.label)} <tspan class="tick">(${r.n})</tspan></text>${status}${segs}${whisker}`;
  }).join('');
  const mid = lw + bw / 2;
  return `${legend([{ label: names[0], color: '--s1' }, { label: 'Ties', color: '--tie' }, { label: names[1], color: '--s2' }])}<p class="ci-key"><svg width="34" height="10" aria-hidden="true"><g class="ci"><line x1="2" x2="32" y1="5" y2="5"/><line x1="2" x2="2" y1="2" y2="8"/><line x1="32" x2="32" y1="2" y2="8"/><circle cx="17" cy="5" r="2.5"/></g></svg> 95% interval of the win rate (ties as half). If it crosses the 50% line, that row could be luck.</p>
  <svg viewBox="0 0 ${W} ${H + 16}" class="chart" role="img" aria-label="Head-to-head win shares"><line x1="${mid}" x2="${mid}" y1="14" y2="${H}" class="ref"/>${bars}
  <text x="${mid}" y="${H + 12}" class="tick" text-anchor="middle">50%</text></svg>`;
}

/**
 * Two targets compared on one measure: a pair of horizontal bars on a shared scale.
 * opts: { max, fmt, range?: [lo, hi] (shaded target band), cis?: [[lo, hi] | null, …] (95%
 * intervals, drawn as whiskers), ciNote?: text for the interval tooltip }
 */
export function pairBars(title, values, names, { max, fmt, range = null, note = '', cis = null, ciNote = '' } = {}) {
  const W = 340; const lw = 0; const bw = W - 60; const bh = 14; const H = 2 * bh + 10 + 18;
  const m = max ?? Math.max(1e-9, ...values.filter((v) => v != null)) * 1.1;
  const sx = (v) => lw + (Math.max(0, Math.min(m, v)) / m) * bw;
  const band = range ? `<rect x="${sx(range[0])}" y="0" width="${Math.max(1, sx(range[1]) - sx(range[0]))}" height="${2 * bh + 10}" class="band" data-tip="Target range ${esc(fmt(range[0]))}–${esc(fmt(range[1]))}"/>` : '';
  const bars = values.map((v, i) => {
    const y = 2 + i * (bh + 6);
    if (v == null) return `<text x="2" y="${y + bh - 3}" class="tick">no data</text>`;
    const w = Math.max(v > 0 ? 3 : 0, sx(v) - lw);
    const ci = cis?.[i];
    const cy = y + bh / 2;
    const whisker = ci ? `<g class="ci" data-tip="${esc(names[i])}: ${esc(fmt(v))}, 95% interval ${esc(fmt(ci[0]))}–${esc(fmt(ci[1]))}${ciNote ? ` ${esc(ciNote)}` : ''}"><line x1="${sx(ci[0])}" x2="${sx(ci[1])}" y1="${cy}" y2="${cy}"/><line x1="${sx(ci[0])}" x2="${sx(ci[0])}" y1="${cy - 4}" y2="${cy + 4}"/><line x1="${sx(ci[1])}" x2="${sx(ci[1])}" y1="${cy - 4}" y2="${cy + 4}"/><rect x="${sx(ci[0])}" y="${y}" width="${Math.max(1, sx(ci[1]) - sx(ci[0]))}" height="${bh}" fill="transparent"/></g>` : '';
    const tx = Math.max(lw + w, ci ? sx(ci[1]) : 0) + 6;
    return `<path d="${seg(lw, y, w, bh, { right: true })}" style="fill:var(--s${i + 1})" data-tip="${esc(names[i])}: ${esc(fmt(v))}"/>${whisker}<text x="${tx}" y="${y + bh - 3}" class="val">${esc(fmt(v))}</text>`;
  }).join('');
  return `<figure class="mini"><figcaption>${title}</figcaption><svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(title.replace(/<[^>]+>/g, ''))}">${band}${bars}
  <line x1="${lw}" x2="${lw}" y1="0" y2="${2 * bh + 10}" class="axis"/>${range ? `<text x="${(sx(range[0]) + sx(range[1])) / 2}" y="${2 * bh + 24}" text-anchor="middle" class="tick">target range</text>` : ''}</svg>${note ? `<p class="note">${note}</p>` : ''}</figure>`;
}

/**
 * The shape of turn lengths: every assistant turn as a dot on a words axis, one row per
 * target, with the monologue limit marked.
 */
export function lengthStrip(series, names, limit) {
  const W = 720; const lw = 210; const bw = W - lw - 20; const rowH = 34;
  const all = series.flat();
  const max = Math.max(limit * 1.2, ...all, 10);
  const sx = (v) => lw + (v / max) * bw;
  const rows = series.map((xs, i) => {
    const y = 30 + i * rowH;
    // Spread identical values slightly so overlapping dots stay visible.
    const seen = {};
    const dots = xs.map((v) => { const k = Math.round(v); seen[k] = (seen[k] ?? 0) + 1; const dy = ((seen[k] - 1) % 3 - 1) * 5; return `<circle cx="${sx(v)}" cy="${y + dy}" r="4.5" style="fill:var(--s${i + 1})" class="dot" data-tip="${esc(names[i])}: a ${Math.round(v)}-word turn"/>`; }).join('');
    return `<text x="${lw - 10}" y="${y + 4}" text-anchor="end" class="lab">${esc(names[i])}</text><line x1="${lw}" x2="${lw + bw}" y1="${y}" y2="${y}" class="grid"/>${dots}`;
  }).join('');
  const H = 30 + series.length * rowH;
  const ticks = [0, Math.round(max / 2), Math.round(max)].map((t) => `<text x="${sx(t)}" y="${H + 4}" text-anchor="middle" class="tick">${t}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H + 22}" class="chart" role="img" aria-label="Words per turn, every turn">${rows}
  <line x1="${sx(limit)}" x2="${sx(limit)}" y1="14" y2="${H - 10}" class="limit" data-tip="Monologue limit: ${limit} words"/><text x="${sx(limit)}" y="9" text-anchor="middle" class="tick">monologue limit (${limit})</text>
  ${ticks}<text x="${lw + bw / 2}" y="${H + 18}" text-anchor="middle" class="tick">words per turn</text></svg>`;
}

/** One bar split by role (part-to-whole), direct-labeled. parts: [{ label, value, color }] */
export function splitBar(parts, fmt) {
  const W = 720; const bh = 22;
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return '<p class="muted small">No spending recorded (mock run).</p>';
  let x = 0;
  const live = parts.filter((p) => p.value > 0);
  const segs = live.map((p, k) => {
    const w = Math.max(0, (p.value / total) * W - (k < live.length - 1 ? 2 : 0));
    const out = `<path d="${seg(x, 0, w, bh, { left: k === 0, right: k === live.length - 1 })}" style="fill:var(${p.color})" data-tip="${esc(p.label)}: ${esc(fmt(p.value))} (${pct(p.value / total)})"/>`;
    x += w + 2;
    return out;
  }).join('');
  return `${legend(live.map((p) => ({ label: `${p.label}: ${fmt(p.value)} (${pct(p.value / total)})`, color: p.color })))}<svg viewBox="0 0 ${W} ${bh}" class="chart" role="img" aria-label="Spending by role">${segs}</svg>`;
}

/**
 * Before → after: one row per item, a win rate (0–100%) in two runs, each with its 95% interval,
 * and an arrow between them. The 50% line marks "no difference from the baseline".
 * rows: [{ label, before: { rate, ci, n }, after: { rate, ci, n }, real, note }]
 */
export function changeChart(rows, { beforeName, afterName, baselineName }) {
  const W = 720; const lw = 0; const bw = W - 20; const rowH = 58;
  const sx = (v) => lw + 10 + v * (bw - 10);
  const H = rows.length * rowH + 8;
  const ci = (c, y, cls) => `<line x1="${sx(c[0])}" x2="${sx(c[1])}" y1="${y}" y2="${y}" class="${cls}"/><line x1="${sx(c[0])}" x2="${sx(c[0])}" y1="${y - 3}" y2="${y + 3}" class="${cls}"/><line x1="${sx(c[1])}" x2="${sx(c[1])}" y1="${y - 3}" y2="${y + 3}" class="${cls}"/>`;
  const body = rows.map((r, i) => {
    const y = 14 + i * rowH;
    const lab = `<text x="0" y="${y}" class="lab">${esc(r.label)}${r.note ? ` <tspan class="tick">${esc(r.note)}</tspan>` : ''}</text>`;
    if (!r.before || !r.after) return `${lab}<text x="0" y="${y + 22}" class="tick">not in both runs</text>`;
    const [yb, ya] = [y + 16, y + 30];
    const tipB = `${beforeName}: ${pct(r.before.rate)} vs ${baselineName} (95% interval ${pct(r.before.ci[0])}–${pct(r.before.ci[1])}, ${r.before.n} turns)`;
    const tipA = `${afterName}: ${pct(r.after.rate)} vs ${baselineName} (95% interval ${pct(r.after.ci[0])}–${pct(r.after.ci[1])}, ${r.after.n} turns)`;
    const d = Math.round((r.after.rate - r.before.rate) * 100);
    return `${lab}<text x="${W}" y="${y}" text-anchor="end" class="tick">${d > 0 ? '+' : ''}${d} pts · ${r.real ? 'more than noise' : 'within noise'}</text>
      <g data-tip="${esc(tipB)}">${ci(r.before.ci, yb, 'ci-before')}<circle cx="${sx(r.before.rate)}" cy="${yb}" r="5" class="dot-before"/></g>
      <g data-tip="${esc(tipA)}">${ci(r.after.ci, ya, 'ci-after')}<circle cx="${sx(r.after.rate)}" cy="${ya}" r="5" class="dot-after"/></g>`;
  }).join('');
  const mid = sx(0.5);
  return `<div class="legend"><span><i class="ring"></i>${esc(beforeName)}</span><span><i style="background:var(--s2)"></i>${esc(afterName)}</span><span class="muted">each against ${esc(baselineName)}; lines are 95% intervals</span></div>
  <svg viewBox="0 0 ${W} ${H + 18}" class="chart" role="img" aria-label="Win rate before and after, by case"><line x1="${mid}" x2="${mid}" y1="0" y2="${H}" class="ref"/>${body}
  <text x="${sx(0)}" y="${H + 14}" class="tick" text-anchor="middle">0%</text><text x="${mid}" y="${H + 14}" class="tick" text-anchor="middle">50%: even with ${esc(baselineName)}</text><text x="${sx(1)}" y="${H + 14}" class="tick" text-anchor="end">100%</text></svg>`;
}

/** Hover tooltips for every [data-tip] mark; one small script for the whole report. */
export const TOOLTIP_SCRIPT = `<div id="tip" role="tooltip" hidden></div><script>
(() => {
  const tip = document.getElementById('tip');
  document.addEventListener('pointerover', (e) => { const t = e.target.closest('[data-tip]'); if (!t) return; tip.textContent = t.dataset.tip; tip.hidden = false; });
  document.addEventListener('pointermove', (e) => { if (tip.hidden) return; const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8); tip.style.left = x + 'px'; tip.style.top = (e.clientY + 16) + 'px'; });
  document.addEventListener('pointerout', (e) => { if (e.target.closest('[data-tip]')) tip.hidden = true; });
  // "Copy" buttons copy a command.
  for (const b of document.querySelectorAll('button.copy[data-copy]')) b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); } catch { const r = document.createRange(); r.selectNodeContents(b.previousElementSibling); getSelection().removeAllRanges(); getSelection().addRange(r); } };
  // "More…" buttons expand a clamped block of text.
  for (const b of document.querySelectorAll('button.more[data-clamp]')) {
    const box = document.getElementById(b.dataset.clamp);
    if (box.scrollHeight <= box.clientHeight + 4) { box.classList.add('open'); b.hidden = true; continue; }
    b.onclick = () => { const open = box.classList.toggle('open'); b.textContent = open ? 'Less' : 'More…'; b.setAttribute('aria-expanded', String(open)); };
  }
})();
</script>`;
