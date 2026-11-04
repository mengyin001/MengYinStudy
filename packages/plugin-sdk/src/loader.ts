import type { Deck } from '@mengyin/core';
import {
  adaptDeck,
  formatIssues,
  parseDeckFile,
  parseManifest,
  type Issue,
  type PluginManifest,
} from './schema';
import type { PluginModule } from './types';

export interface PluginIndexEntry {
  dir: string;
  manifest: PluginManifest;
  content: string[];
  entry: string | null;
}

export interface PluginIndexFile {
  schemaVersion: number;
  generatedAt?: string;
  plugins: PluginIndexEntry[];
}

export interface LoadedPlugin {
  dir: string;
  manifest: PluginManifest;
  decks: Deck[];
  module: PluginModule | null;
  entryUrl: string | null;
  issues: Issue[];
}

export interface PluginLoadReport {
  dir: string;
  plugin: LoadedPlugin | null;
  issues: Issue[];
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type ModuleLoader = (url: string) => Promise<PluginModule>;

/** Keeps relative paths inside the plugin folder and strips `./`. */
export function joinAssetUrl(base: string, dir: string, file?: string | null): string {
  const parts: string[] = [base.replace(/\/+$/, '')];
  for (const part of [dir, file ?? '']) {
    const cleaned = part.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
    if (cleaned) parts.push(cleaned);
  }
  return parts.join('/');
}

export const defaultModuleLoader: ModuleLoader = async (url) => {
  const module = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
  const candidate = (module.default ?? module) as PluginModule;
  if (!candidate || (typeof candidate !== 'object' && typeof candidate !== 'function')) {
    throw new Error('插件模組沒有匯出物件');
  }
  return candidate;
};

export async function loadPluginIndex(
  baseUrl: string,
  fetcher: Fetcher = fetch,
): Promise<{ entries: PluginIndexEntry[]; issues: Issue[] }> {
  const issues: Issue[] = [];
  let text: string;
  try {
    const response = await fetcher(joinAssetUrl(baseUrl, 'index.json'));
    if (!response.ok) {
      return { entries: [], issues: [{ path: 'index.json', message: `HTTP ${response.status}` }] };
    }
    text = await response.text();
  } catch (error) {
    return {
      entries: [],
      issues: [{ path: 'index.json', message: error instanceof Error ? error.message : '網絡錯誤' }],
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { entries: [], issues: [{ path: 'index.json', message: '不是有效的 JSON' }] };
  }

  const plugins = (raw as { plugins?: unknown }).plugins;
  if (!Array.isArray(plugins)) {
    return { entries: [], issues: [{ path: 'index.json', message: '缺少 plugins 陣列' }] };
  }

  const entries: PluginIndexEntry[] = [];
  for (const [index, candidate] of plugins.entries()) {
    const dir = (candidate as { dir?: unknown }).dir;
    if (typeof dir !== 'string' || !dir) {
      issues.push({ path: `plugins[${index}]`, message: '缺少 dir' });
      continue;
    }
    const parsed = parseManifest((candidate as { manifest?: unknown }).manifest);
    if (!parsed.ok) {
      issues.push({ path: `${dir}/manifest.json`, message: formatIssues(parsed.issues) });
      continue;
    }
    const content = (candidate as { content?: unknown }).content;
    const entry = (candidate as { entry?: unknown }).entry;
    entries.push({
      dir,
      manifest: parsed.value,
      content: Array.isArray(content) ? content.filter((item): item is string => typeof item === 'string') : [],
      entry: typeof entry === 'string' && entry ? entry : null,
    });
  }
  return { entries, issues };
}

export interface LoadPluginOptions {
  baseUrl: string;
  fetcher?: Fetcher;
  moduleLoader?: ModuleLoader;
}

export async function loadPlugin(entry: PluginIndexEntry, options: LoadPluginOptions): Promise<PluginLoadReport> {
  const { baseUrl, fetcher = fetch, moduleLoader = defaultModuleLoader } = options;
  const issues: Issue[] = [];
  const decks: Deck[] = [];
  const manifest = entry.manifest;

  for (const file of entry.content) {
    const url = joinAssetUrl(baseUrl, entry.dir, file);
    try {
      const response = await fetcher(url);
      if (!response.ok) {
        issues.push({ path: `${entry.dir}/${file}`, message: `HTTP ${response.status}` });
        continue;
      }
      const text = await response.text();
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        issues.push({ path: `${entry.dir}/${file}`, message: '不是有效的 JSON' });
        continue;
      }
      const parsed = parseDeckFile(raw);
      if (!parsed.ok) {
        issues.push({ path: `${entry.dir}/${file}`, message: formatIssues(parsed.issues) });
        continue;
      }
      // Relative image paths resolve against the plugin folder.
      decks.push(adaptDeck(manifest.id, parsed.value, `${joinAssetUrl(baseUrl, entry.dir)}/`));
    } catch (error) {
      issues.push({
        path: `${entry.dir}/${file}`,
        message: error instanceof Error ? error.message : '載入失敗',
      });
    }
  }

  let module: PluginModule | null = null;
  let entryUrl: string | null = null;
  if (entry.entry) {
    entryUrl = joinAssetUrl(baseUrl, entry.dir, entry.entry);
    try {
      module = await moduleLoader(entryUrl);
    } catch (error) {
      issues.push({
        path: `${entry.dir}/${entry.entry}`,
        message: `執行插件程式碼失敗：${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const plugin: LoadedPlugin = { dir: entry.dir, manifest, decks, module, entryUrl, issues };
  return { dir: entry.dir, plugin, issues };
}

export async function loadPluginsFromIndex(
  baseUrl: string,
  fetcher: Fetcher = fetch,
  moduleLoader: ModuleLoader = defaultModuleLoader,
): Promise<PluginLoadReport[]> {
  const { entries, issues } = await loadPluginIndex(baseUrl, fetcher);
  const reports: PluginLoadReport[] = [];
  if (issues.length > 0) {
    reports.push({ dir: '_index', plugin: null, issues });
  }
  for (const entry of entries) {
    reports.push(await loadPlugin(entry, { baseUrl, fetcher, moduleLoader }));
  }
  return reports;
}

/** Parse one deck JSON document (used by the local-file importer). */
export function parseDeckText(pluginId: string, text: string): { deck: Deck | null; issues: Issue[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { deck: null, issues: [{ path: 'deck', message: '不是有效的 JSON' }] };
  }
  const parsed = parseDeckFile(raw);
  if (!parsed.ok) return { deck: null, issues: parsed.issues };
  return { deck: adaptDeck(pluginId, parsed.value), issues: [] };
}

export { adaptDeck, parseDeckFile, parseManifest };
