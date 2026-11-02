#!/usr/bin/env node
// Re-renders every published report listed in docs/runs/index.json, keeping each run's id,
// title and notes, so a change to the report's look reaches all of them at once:  npm run reports
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const indexFile = join(root, 'docs', 'runs', 'index.json');
const { runs = [] } = JSON.parse(readFileSync(indexFile, 'utf8'));
for (const r of runs) {
  const results = join(dirname(indexFile), r.results);
  execFileSync(process.execPath, [join(root, 'src', 'cli.js'), 'report', results, '--publish', indexFile, '--id', r.id, '--title', r.title], { cwd: root, stdio: 'ignore' });
  console.log(`Re-rendered ${r.id}: ${r.title}`);
}
