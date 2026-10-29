#!/usr/bin/env node
// A tiny local server for the web app, laid out the way GitHub Pages serves it: docs/ at the
// root and the engine (src/) at /src/. Browsers won't load modules from file:// pages, so
// open the app through this:  npm run app  →  http://localhost:8787/app/
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const port = Number(process.env.PORT ?? 8787);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.tsv': 'text/tab-separated-values', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown' };

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') { res.writeHead(302, { Location: '/app/' }); return res.end(); }
  if (path.endsWith('/')) path += 'index.html';
  // /src/* and /suites/* come from the repo; everything else from docs/.
  const base = /^\/(src|suites)\//.test(path) ? root : join(root, 'docs');
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
}).listen(port, () => console.log(`Web app: http://localhost:${port}/app/  (Ctrl+C to stop)`));
