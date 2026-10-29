// The "Judge vs. human" section: how often the LLM judge agreed with a person's blind ratings.
// Shared by the report (when a run carries ratings) and the web app's rating results screen.
import { agreement } from '../ratings.js';
import { winShareChart } from './charts.js';
import { info } from './glossary.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const range = (g) => (g ? `${pct(g.ci[0])}–${pct(g.ci[1])}` : '–');

/** opts.rater: who rated (e.g. "Greg"); defaults to "the human". opts.you: address the rater as "you". */
export function agreementSection(results, ratings, { rater = null, you = false } = {}) {
  const a = agreement(results, ratings);
  if (!a.n) return '';
  const label = Object.fromEntries(results.meta.targets.map((t) => [t.id, t.label ?? t.id]));
  const names = a.ids.map((id) => label[id]);
  const who = you ? 'you' : rater ? esc(rater) : 'the human';
  const Who = you ? 'You' : rater ? esc(rater) : 'The human';
  const Whose = you ? 'Your' : `${Who}'s`;
  const title = (id) => (results.meta.caseInfo ?? []).find((c) => c.id === id)?.title ?? id;
  const pick = (p) => (p === 'tie' ? 'a tie' : esc(label[p] ?? p));
  const tile = (k, g, note) => `<div class="tile"><span class="k">${k}</span><span class="v">${pct(g?.rate)}</span><span class="small muted">${g ? `${g.k} of ${g.n} turns · 95% interval ${range(g)}` : 'no turns'}${note ? ` · ${note}` : ''}</span></div>`;
  const verdictRows = [
    { label: `${Whose} picks`, ...a.human },
    { label: 'The judge\'s picks, same turns', ...a.judge },
  ];
  const caseRows = a.byCase.map((c) => `<tr><th>${esc(title(c.case))}</th><td>${pct(c.rate)}</td><td>${c.k} of ${c.n}</td><td class="muted">${range(c)}</td></tr>`).join('');
  const dis = a.disagreements.map((d) => `<li><b>${esc(title(d.case))}</b>, turn ${d.turn + 1}: ${who} picked ${pick(d.human)}, the judge ${pick(d.judge)}${d.reason ? `. <span class="muted">“${esc(d.reason)}”</span>` : ''}</li>`).join('');
  // Benchmarks: expert human-human agreement in the MT-Bench study (Zheng et al., 2023),
  // 63–67% counting ties and 81–82% when both picked a winner.
  const g = a.decisive ?? a.overall;
  const bench = a.decisive ? 0.81 : 0.65;
  const level = g.ci[1] < bench - 0.1
    ? `That's clearly below how often expert raters agree with each other (about ${pct(bench)} in the MT-Bench study ${info('agreement')}), so treat the judge's head-to-head verdict with caution and read the disagreements below.`
    : g.rate >= bench - 0.05
      ? `That's about as often as expert raters agree with each other (about ${pct(bench)} in the MT-Bench study ${info('agreement')}), so the judge is roughly as reliable as a second person here${g.n < 40 ? `, though with ${g.n} turns the range is still wide` : ''}.`
      : `That's somewhat below how often expert raters agree with each other (about ${pct(bench)} in the MT-Bench study ${info('agreement')}); read the disagreements below to see where the judge differs.`;
  const consistencyNote = a.consistent && a.inconsistent
    ? ` When the judge gave the same verdict in both reply orders, it agreed with ${who} ${pct(a.consistent.rate)} of the time; when the two orders disagreed (counted as a tie), ${pct(a.inconsistent.rate)}.`
    : '';
  return `<h2>Judge vs. human ${info('agreement')}</h2>
  <p class="lead">${Who} rated ${a.n} turns blind ${info('humanRating')}: the same two replies the judge compared, with the names hidden and the order shuffled. ${a.decisive ? `When both picked a winner, the judge agreed ${pct(g.rate)} of the time` : `The judge made the same pick ${pct(g.rate)} of the time`}. ${level}${consistencyNote}</p>
  <div class="tiles">${tile(`Agreement ${info('agreement')}`, a.overall, 'ties count when both chose one')}${tile('When both picked a winner', a.decisive, 'ties left out')}</div>
  <h3>Who won, by each rater</h3>
  ${winShareChart(verdictRows, names)}
  <details class="tv"><summary>Agreement by case</summary><table><tr><th>Case</th><th>Agreement</th><th>Turns</th><th>95% interval</th></tr>${caseRows}</table></details>
  ${dis ? `<details class="tv"><summary>Where they disagreed (${a.disagreements.length})</summary><ul class="findings">${dis}</ul></details>` : ''}`;
}
