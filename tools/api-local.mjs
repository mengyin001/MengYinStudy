#!/usr/bin/env node
/**
 * Local API server for development.
 *
 * Cloudflare's Worker runtime is the deployment target, but bundling the same
 * `apps/api/src/index.ts` with esbuild and serving it over Node gives us the
 * complete flow — SSE, auth, images, demo provider — without a Cloudflare
 * account or `wrangler dev`. It listens on 127.0.0.1 only.
 */
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.API_PORT ?? 8787);

function loadEnvFile(file) {
  try {
    process.loadEnvFile(file);
  } catch {
    // The file is optional.
  }
}

async function loadDotVars(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals === -1) continue;
    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(root, '.env'));
await loadDotVars(path.join(root, '.dev.vars'));

const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (typeof value === 'string') env[key] = value;
}

const hasProviderKey = Boolean((env.GLM_API_KEY ?? '').trim() || (env.DEEPSEEK_API_KEY ?? '').trim());
if (!hasProviderKey && !env.AI_MOCK) {
  env.AI_MOCK = '1';
  console.log('No GLM_API_KEY or DEEPSEEK_API_KEY found — starting the demo provider (AI_MOCK=1).');
}
if (!env.AUTH_REQUIRED) {
  env.AUTH_REQUIRED = 'false';
  console.log('AUTH_REQUIRED=false for local development (the server listens on 127.0.0.1 only).');
}
if (!env.IMAGE_PROVIDER) {
  const cloudflareReady = Boolean(
    (env.CLOUDFLARE_ACCOUNT_ID ?? '').trim() && (env.CLOUDFLARE_AI_TOKEN ?? '').trim(),
  );
  env.IMAGE_PROVIDER = env.AI_MOCK === '1' || !cloudflareReady ? 'demo' : 'cloudflare';
  if (env.IMAGE_PROVIDER === 'demo') {
    console.log('Image generation uses placeholder SVGs locally. Deploy the Worker for Workers AI images.');
  }
}

const outDir = path.join(root, '.tmp', 'api');
const outfile = path.join(outDir, 'worker.mjs');
await mkdir(outDir, { recursive: true });
await build({
  entryPoints: [path.join(root, 'apps', 'api', 'src', 'index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  outfile,
  logLevel: 'silent',
  sourcemap: false,
  // The Worker uses Web APIs; Node 20+ provides fetch, Request, Response.
  mainFields: ['module', 'main'],
  conditions: ['import', 'module', 'default'],
});
await writeFile(path.join(outDir, 'package.json'), '{"type":"module"}\n');

const worker = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);

function nodeHeaders(request) {
  const headers = new Headers();
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index];
    const value = request.rawHeaders[index + 1];
    if (name && value !== undefined) headers.append(name, value);
  }
  return headers;
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

const server = createServer(async (request, response) => {
  try {
    const host = request.headers.host ?? `127.0.0.1:${port}`;
    const url = `http://${host}${request.url ?? '/'}`;
    const body = await readBody(request);
    const workerRequest = new Request(url, {
      method: request.method ?? 'GET',
      headers: nodeHeaders(request),
      ...(body ? { body } : {}),
    });
    const workerResponse = await worker.default.fetch(workerRequest, env, {
      waitUntil() {
        // The stream keeps the async work alive for the duration of the response.
      },
    });
    response.statusCode = workerResponse.status;
    workerResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'connection') return;
      response.setHeader(key, value);
    });
    if (workerResponse.body) {
      for await (const chunk of workerResponse.body) response.write(chunk);
    }
    response.end();
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      response.statusCode = 500;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    response.end(JSON.stringify({ error: { code: 'server_error', message: 'Local API failed.' } }));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`AI API listening on http://127.0.0.1:${port}`);
  console.log(`Health: http://127.0.0.1:${port}/api/ai/health`);
  console.log('Vite proxies /api here; `npm run dev` starts both, `npm run dev:web` starts only Vite.');
});
