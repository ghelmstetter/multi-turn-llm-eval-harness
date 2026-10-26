// Small inline-SVG charts for the report (no libraries, so the report stays one file that
// opens anywhere). Colors are CSS variables set by the report: --s1 / --s2 for the two
// targets (fixed order: first target blue, second orange), --tie for ties, --r1..--r3 for
// cost roles. Every mark has a hover tooltip (data-tip), values are direct-labeled, and the
// tables in the report double as the table view.

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
 * rows: [{ label, a, tie, b, n }] as fractions.
 */
export function winShareChart(rows, names) {
  // Row labels sit above their bars, so long target names never get cut off.
  const W = 720; const lw = 0; const bw = W; const bh = 22; const gap = 34;
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
    return `<text x="0" y="${y - 6}" class="lab">${esc(r.label)} <tspan class="tick">(${r.n})</tspan></text>${segs}`;
  }).join('');
  const mid = lw + bw / 2;
  return `${legend([{ label: names[0], color: '--s1' }, { label: 'Ties', color: '--tie' }, { label: names[1], color: '--s2' }])}
  <svg viewBox="0 0 ${W} ${H + 16}" class="chart" role="img" aria-label="Head-to-head win shares"><line x1="${mid}" x2="${mid}" y1="14" y2="${H}" class="ref"/>${bars}
  <text x="${mid}" y="${H + 12}" class="tick" text-anchor="middle">50%</text></svg>`;
}

/**
 * Two targets compared on one measure: a pair of horizontal bars on a shared scale.
 * opts: { max, fmt, range?: [lo, hi] (shaded target band), better?: text }
 */
export function pairBars(title, values, names, { max, fmt, range = null, note = '' } = {}) {
  const W = 340; const lw = 0; const bw = W - 60; const bh = 14; const H = 2 * bh + 10 + 18;
  const m = max ?? Math.max(1e-9, ...values.filter((v) => v != null)) * 1.1;
  const sx = (v) => lw + (Math.max(0, Math.min(m, v)) / m) * bw;
  const band = range ? `<rect x="${sx(range[0])}" y="0" width="${Math.max(1, sx(range[1]) - sx(range[0]))}" height="${2 * bh + 10}" class="band" data-tip="Target range ${esc(fmt(range[0]))}–${esc(fmt(range[1]))}"/>` : '';
  const bars = values.map((v, i) => {
    const y = 2 + i * (bh + 6);
    if (v == null) return `<text x="2" y="${y + bh - 3}" class="tick">no data</text>`;
    const w = Math.max(v > 0 ? 3 : 0, sx(v) - lw);
    return `<path d="${seg(lw, y, w, bh, { right: true })}" style="fill:var(--s${i + 1})" data-tip="${esc(names[i])}: ${esc(fmt(v))}"/><text x="${lw + w + 6}" y="${y + bh - 3}" class="val">${esc(fmt(v))}</text>`;
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

/** Hover tooltips for every [data-tip] mark; one small script for the whole report. */
export const TOOLTIP_SCRIPT = `<div id="tip" role="tooltip" hidden></div><script>
(() => {
  const tip = document.getElementById('tip');
  document.addEventListener('pointerover', (e) => { const t = e.target.closest('[data-tip]'); if (!t) return; tip.textContent = t.dataset.tip; tip.hidden = false; });
  document.addEventListener('pointermove', (e) => { if (tip.hidden) return; const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8); tip.style.left = x + 'px'; tip.style.top = (e.clientY + 16) + 'px'; });
  document.addEventListener('pointerout', (e) => { if (e.target.closest('[data-tip]')) tip.hidden = true; });
})();
</script>`;
