#!/usr/bin/env node
// Serves dist/ with the two headers that give the split its worker threads.
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { exec } from 'node:child_process';

const root = resolve(import.meta.dirname, '..', 'dist');
const port = Number(process.env.PORT ?? 8791);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(root, url));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    statSync(file);
  } catch {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': types[extname(file)] ?? 'application/octet-stream',
    // ISOLATE=0 behaves like static hosts that cannot set these, such as GitHub Pages.
    ...(process.env.ISOLATE === '0'
      ? {}
      : { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }),
    'Cache-Control': 'no-cache',
  });
  createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => {
  const url = `http://localhost:${port}/`;
  console.log(`Serving ${url}  (Ctrl+C to stop)`);
  if (process.argv.includes('--open')) exec(`open ${url} || xdg-open ${url}`);
});
