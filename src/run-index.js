// The run index: a small JSON list of published runs (docs/runs/index.json) that the web app's
// gallery reads, so it can show every run without downloading each one. Pure functions; the
// CLI's `report --publish` does the file reading and writing.

const labelOf = (results, id) => results.meta.targets.find((t) => t.id === id)?.label ?? id;

/**
 * One gallery entry for a run. `paths` are relative to the index file's folder:
 * { results: '../sample-report/results.json', report: '../sample-report/report.html' }.
 */
export function runEntry(results, { id, title = null, paths }) {
  const m = results.meta;
  const v = results.summary?.verdict ?? null;
  return {
    id,
    title: title ?? m.suite?.title ?? m.suite?.id ?? id,
    suite: { id: m.suite?.id ?? null, title: m.suite?.title ?? null },
    date: m.startedAt ?? null,
    mode: m.mode,
    mock: Boolean(m.mock),
    partial: Boolean(results.partial),
    cases: m.cases?.length ?? 0,
    turns: m.turns,
    repeats: m.repeats,
    targets: m.targets.map((t) => ({ id: t.id, label: t.label ?? t.id, model: t.model ?? null, prompt: t.prompt ?? null })),
    costUsd: m.budget?.spentUsd ?? null,
    calls: m.budget?.calls ?? null,
    verdict: v && {
      strength: v.strength,
      leader: v.leader ?? v.winner ?? null,
      leaderLabel: v.leader || v.winner ? labelOf(results, v.leader ?? v.winner) : null,
      winRate: v.winRate ?? null,
      ci: v.ci ?? null,
      n: v.n ?? null,
      unit: v.unit ?? null,
    },
    results: paths.results,
    report: paths.report,
  };
}

/** Add or replace an entry (matched by id), newest first. */
export function upsertIndex(index, entry) {
  const runs = (index?.runs ?? []).filter((r) => r.id !== entry.id);
  runs.push(entry);
  runs.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
  return { version: 1, runs };
}
