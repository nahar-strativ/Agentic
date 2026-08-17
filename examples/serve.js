#!/usr/bin/env node
/**
 * Tiny static file server for the demo page. Serves the repo root so the demo
 * can import the overlay straight from packages/core/src with no build step.
 *
 *   node examples/serve.js   →   http://127.0.0.1:5173/examples/vanilla/
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(process.env.PORT || 5173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  // normalize() collapses ../ so a request cannot escape ROOT.
  let filePath = join(ROOT, normalize(decodeURIComponent(url.pathname)));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': TYPES[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}).listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`demo: http://127.0.0.1:${PORT}/examples/vanilla/\n`);
});
