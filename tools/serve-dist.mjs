#!/usr/bin/env node
/** Minimal static file server for the built app (no bundler, no temp files). */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'dist');
const port = Number(process.env.PORT ?? 4173);

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.map', 'application/json; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.zip', 'application/zip'],
  ['.data', 'application/octet-stream'],
]);

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  let relative = decodeURIComponent(url.pathname);
  if (relative.endsWith('/')) relative += 'index.html';
  const filePath = path.join(root, relative);
  if (!filePath.startsWith(root)) {
    response.writeHead(403).end('forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    const headers = {
      'Content-Type': MIME.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream',
    };
    // The sandbox iframe has an opaque origin, so its runtime requests need
    // CORS. Cloudflare Pages gets the same rules from public/_headers.
    if (url.pathname.startsWith('/runtimes/')) {
      headers['Access-Control-Allow-Origin'] = '*';
      headers['Cross-Origin-Resource-Policy'] = 'cross-origin';
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    }
    response.writeHead(200, headers);
    response.end(data);
  } catch {
    response.writeHead(404).end('not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} at http://127.0.0.1:${port}/`);
});
