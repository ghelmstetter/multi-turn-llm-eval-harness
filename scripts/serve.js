#!/usr/bin/env node
// A tiny local server for the web app, laid out the way GitHub Pages serves it: docs/ at the
// root and the engine (src/) at /src/. Browsers won't load modules from file:// pages, so
// open the app through this:  npm start (or npm run app)  →  http://localhost:8787/app/
// With --open it also opens that page in your browser (start-app.bat does this on Windows).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const port = Number(process.env.PORT ?? 8787);
const url = `http://localhost:${port}/app/`;

/** Open the app in the default browser (Windows, macOS or Linux). */
function openBrowser() {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* no browser to open: the address is printed */ }
}
const wantOpen = process.argv.includes('--open');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.tsv': 'text/tab-separated-values', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown' };

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') { res.writeHead(302, { Location: '/app/' }); return res.end(); }
  if (path.endsWith('/')) path += 'index.html';
  // /src/*, /suites/* and /examples/* come from the repo; everything else from docs/.
  const base = /^\/(src|suites|examples)\//.test(path) ? root : join(root, 'docs');
  const file = normalize(join(base, path));
  if (!file.startsWith(base + sep)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': `${TYPES[extname(file)] ?? 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}).on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  // Already running (say, in another window): just open it.
  console.log(`The web app is already running at ${url}`);
  if (wantOpen) openBrowser();
}).listen(port, () => {
  console.log(`Web app: ${url}  (Ctrl+C to stop)`);
  if (wantOpen) openBrowser();
});
