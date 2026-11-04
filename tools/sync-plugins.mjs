#!/usr/bin/env node
/**
 * Copies plugins/ into apps/web/public/plugins and writes index.json, which is
 * what the running app fetches. Run with --watch to keep it in sync.
 */
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sourceDir = path.join(root, 'plugins');
const targetDir = path.join(root, 'apps', 'web', 'public', 'plugins');
const watchMode = process.argv.includes('--watch');

const log = (...args) => console.log('[plugins]', ...args);

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full, base)));
    else if (entry.isFile()) files.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return files;
}

function patternToRegExp(pattern) {
  const clean = pattern.replace(/^\.\//, '');
  let source = clean.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  source = source.replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp(`^${source}$`);
}

function resolveContent(files, patterns, pluginId) {
  const selected = new Set();
  for (const pattern of patterns) {
    const regex = patternToRegExp(pattern);
    const matches = files.filter((file) => regex.test(file));
    if (matches.length === 0) log(`⚠ ${pluginId}：content 模式 "${pattern}" 沒有配對到檔案`);
    for (const match of matches) selected.add(match);
  }
  return [...selected].sort();
}

async function build() {
  const warnings = [];
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });

  if (!(await exists(sourceDir))) {
    await mkdir(sourceDir, { recursive: true });
    log('plugins/ 不存在，已建立空資料夾');
  }

  const entries = (await readdir(sourceDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));

  const plugins = [];
  const seenIds = new Set();
  let deckCount = 0;

  for (const entry of entries) {
    const pluginPath = path.join(sourceDir, entry.name);
    const manifestPath = path.join(pluginPath, 'manifest.json');
    if (!(await exists(manifestPath))) {
      warnings.push(`${entry.name}：缺少 manifest.json，已略過`);
      continue;
    }

    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    } catch (error) {
      warnings.push(`${entry.name}/manifest.json：不是有效 JSON（${error.message}）`);
      continue;
    }

    if (!manifest || typeof manifest.id !== 'string' || typeof manifest.name !== 'string') {
      warnings.push(`${entry.name}/manifest.json：缺少 id 或 name`);
      continue;
    }
    if (seenIds.has(manifest.id)) {
      warnings.push(`${entry.name}：插件 id "${manifest.id}" 重複，已略過`);
      continue;
    }
    seenIds.add(manifest.id);

    const files = await walk(pluginPath);
    const patterns = Array.isArray(manifest.content) ? manifest.content : [];
    const content = resolveContent(files, patterns, manifest.id);
    if (content.length === 0) warnings.push(`${entry.name}：沒有題庫檔案`);
    deckCount += content.length;

    const entryFile = typeof manifest.entry === 'string' && manifest.entry ? manifest.entry : null;
    if (entryFile && !files.includes(entryFile.replace(/^\.\//, ''))) {
      warnings.push(`${entry.name}：entry "${entryFile}" 不存在`);
    }

    await cp(pluginPath, path.join(targetDir, entry.name), { recursive: true });
    plugins.push({ dir: entry.name, manifest, content, entry: entryFile });
    log(`✔ ${manifest.id} (${manifest.name}) — ${content.length} 個題庫`);
  }

  await writeFile(
    path.join(targetDir, 'index.json'),
    `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), plugins }, null, 2)}\n`,
    'utf8',
  );

  for (const warning of warnings) log(`⚠ ${warning}`);
  log(`完成：${plugins.length} 個插件、${deckCount} 個題庫 → apps/web/public/plugins`);
}

let timer = null;
function scheduleBuild() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    build().catch((error) => {
      console.error('[plugins] 同步失敗：', error);
    });
  }, 150);
}

build()
  .then(() => {
    if (!watchMode) return;
    log('監察 plugins/ 變更中（Ctrl+C 結束）');
    watch(sourceDir, { recursive: true }, scheduleBuild);
  })
  .catch((error) => {
    console.error('[plugins] 同步失敗：', error);
    process.exitCode = 1;
  });
