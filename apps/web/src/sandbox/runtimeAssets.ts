/**
 * Static language runtimes (Pyodide, sql.js).
 *
 * They are copied into `public/runtimes/<name>/<version>/` by
 * `npm run runtimes:fetch` at build time and served by the same static host as
 * the app. `public/runtime-manifest.json` records the installed versions; it
 * deliberately sits outside `public/runtimes/` so the immutable cache rule for
 * the versioned folders cannot pin an old manifest after a release. Keeping
 * everything on our own origin means a deployed site needs no execution server
 * and no third-party CDN; the sandbox iframe only has to allow that one origin
 * in its CSP.
 */
import type { CodeLanguage } from '@mengyin/core';

export interface RuntimeLanguageEntry {
  /** `wasm` for a WebAssembly runtime, `bundled` for code shipped in the app. */
  kind: 'wasm' | 'bundled';
  version: string;
  /** Directory relative to `runtimes/manifest.json`, with a trailing slash. */
  url?: string;
}

export interface RuntimeManifest {
  version: number;
  generatedAt?: string;
  languages: Partial<Record<CodeLanguage, RuntimeLanguageEntry>>;
}

let manifestPromise: Promise<RuntimeManifest | null> | null = null;

export function runtimeManifestUrl(): string {
  if (typeof document === 'undefined') return 'runtime-manifest.json';
  return new URL('runtime-manifest.json', document.baseURI).href;
}

/** Load (and cache) the generated runtime manifest. Missing means JS-only. */
export function loadRuntimeManifest(): Promise<RuntimeManifest | null> {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      try {
        const response = await fetch(runtimeManifestUrl(), { cache: 'no-cache' });
        if (!response.ok) {
          manifestPromise = null;
          return null;
        }
        const raw = (await response.json()) as Partial<RuntimeManifest> | null;
        if (!raw || typeof raw !== 'object' || typeof raw.languages !== 'object') {
          manifestPromise = null;
          return null;
        }
        return {
          version: Number(raw.version) || 1,
          ...(typeof raw.generatedAt === 'string' ? { generatedAt: raw.generatedAt } : {}),
          languages: raw.languages ?? {},
        };
      } catch {
        manifestPromise = null;
        return null;
      }
    })();
  }
  return manifestPromise;
}

export class MissingRuntimeError extends Error {
  constructor(readonly language: CodeLanguage) {
    super(
      `The ${language} runtime is not installed. Run "npm run runtimes:fetch" before starting or building the app.`,
    );
    this.name = 'MissingRuntimeError';
  }
}

/**
 * Absolute base URL for a language that needs a WebAssembly runtime. Throws a
 * clear, actionable error when the build was produced without runtime assets.
 */
export async function runtimeBaseFor(language: CodeLanguage): Promise<string> {
  if (language === 'javascript' || language === 'typescript') return '';
  const manifest = await loadRuntimeManifest();
  const entry = manifest?.languages?.[language];
  if (!entry?.url) throw new MissingRuntimeError(language);
  const base = new URL(entry.url, runtimeManifestUrl()).href;
  return base.endsWith('/') ? base : `${base}/`;
}

/** Human-readable runtime version for the code panel, when one is installed. */
export async function runtimeVersionFor(language: CodeLanguage): Promise<string | null> {
  if (language === 'javascript' || language === 'typescript') return null;
  const manifest = await loadRuntimeManifest();
  return manifest?.languages?.[language]?.version ?? null;
}
