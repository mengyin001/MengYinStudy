#!/usr/bin/env node
/**
 * One command for local development: start the Worker API (8787) and Vite
 * (5173) together, and stop both when either one exits or Ctrl+C is pressed.
 */
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// When this script is launched by `npm run dev`, npm_execpath points at
// npm-cli.js. Spawning Node with that file avoids Windows' .cmd shell warning.
const npmCli = process.env.npm_execpath;
const useNodeCli = Boolean(npmCli && /\.(c?js|mjs)$/i.test(npmCli));
const children = new Set();
let stopping = false;

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    child.kill('SIGTERM');
  } catch {
    // The process may already have exited.
  }
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) killTree(child);
  children.clear();
  // Give the children a moment to release 5173/8787 before exiting.
  setTimeout(() => process.exit(code), 250);
}

function run(label, args) {
  const child = spawn(useNodeCli ? process.execPath : npm, useNodeCli ? [npmCli, ...args] : args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    // Without npm_execpath, Windows needs cmd.exe to run npm.cmd. taskkill /T
    // still reaches Vite and the API through the shell.
    shell: !useNodeCli && process.platform === 'win32',
    windowsHide: false,
  });
  children.add(child);
  child.on('error', (error) => {
    console.error(`[dev] could not start ${label}: ${error.message}`);
    shutdown(1);
  });
  child.on('exit', (code) => {
    children.delete(child);
    if (stopping) return;
    console.error(`[dev] ${label} stopped; shutting down the other process.`);
    shutdown(code ?? 1);
  });
  return child;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(700, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

const [apiBusy, webBusy] = await Promise.all([portInUse(8787), portInUse(5173)]);
if (apiBusy || webBusy) {
  const busy = [apiBusy ? '8787 (API)' : '', webBusy ? '5173 (Vite)' : ''].filter(Boolean);
  console.error(
    `[dev] ${busy.join(' and ')} already in use. Stop the existing dev server first, then run npm run dev again.`,
  );
  process.exit(1);
}

console.log('[dev] starting the AI API on 127.0.0.1:8787 and Vite on 127.0.0.1:5173');
run('API', ['run', 'dev:api']);
run('web', ['run', 'dev:web']);
