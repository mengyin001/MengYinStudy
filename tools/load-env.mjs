#!/usr/bin/env node
/**
 * Minimal .env loader for the Node tooling. The web app gets its variables from
 * Vite (`envDir` points at the repository root), but the seed/check scripts run
 * outside Vite and must not require a shell-specific `export`.
 *
 * Real environment variables win over files. `.env.local` wins over `.env`.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function parse(text) {
  const values = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value.replace(/\\n/g, '\n'));
  }
  return values;
}

export function loadEnvFiles() {
  for (const name of ['.env.local', '.env']) {
    const file = path.join(root, name);
    if (!existsSync(file)) continue;
    for (const [key, value] of parse(readFileSync(file, 'utf8'))) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

export function required(name, hint = '') {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing ${name}.${hint ? ` ${hint}` : ''}`);
    process.exit(1);
  }
  return value;
}

export default loadEnvFiles;
