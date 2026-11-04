#!/usr/bin/env node
/**
 * Copy the browser code runtimes into the web app's static folder.
 *
 * The app never imports these packages into its own bundle: Pyodide, sql.js,
 * the javac + TeaVM toolchain and the JSCPP interpreter are loaded lazily by
 * the sandbox from `apps/web/public/runtimes/<name>/<version>/`. That keeps the
 * initial page small and makes the deployed site a plain static site — no
 * execution server, no third-party CDN.
 *
 * Run automatically before `dev` and `build`; `npm run runtimes:fetch` also
 * works on its own.
 */
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuildBuild } from 'esbuild';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRuntimes = path.join(root, 'apps', 'web', 'public', 'runtimes');
const require = createRequire(import.meta.url);

const PYODIDE_FILES = [
  'pyodide.js',
  'pyodide.asm.js',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
];
const SQLJS_FILES = ['sql-wasm.js', 'sql-wasm.wasm'];
const JAVA_FILES = [
  'java-wasm.iife.js',
  'worker-java.js',
  'teavm/compile-classlib-teavm.bin',
  'teavm/compiler.wasm',
  'teavm/compiler.wasm-deobfuscator.wasm',
  'teavm/compiler.wasm-runtime.js',
  'teavm/runtime-classlib-teavm.bin',
];

function packageVersion(name) {
  try {
    return JSON.parse(readFileSync(path.join(packageRoot(name), 'package.json'))).version;
  } catch {
    return null;
  }
}

function packageRoot(name) {
  try {
    return path.dirname(require.resolve(`${name}/package.json`));
  } catch {
    // Packages with an "exports" map may hide package.json. Walk up from the
    // resolved entry point until the package root is found.
    let dir = path.dirname(require.resolve(name));
    while (!existsSync(path.join(dir, 'package.json'))) {
      const parent = path.dirname(dir);
      if (parent === dir) throw new Error(`Cannot locate the package root for "${name}".`);
      dir = parent;
    }
    return dir;
  }
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function copyIfChanged(source, destination) {
  if (!(await exists(source))) {
    throw new Error(`Missing runtime file: ${path.relative(root, source)}`);
  }
  if (await exists(destination)) {
    const [from, to] = await Promise.all([stat(source), stat(destination)]);
    if (from.size === to.size) return false;
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { force: true });
  return true;
}

async function pruneOldVersions(parent, keep) {
  if (!(await exists(parent))) return;
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== keep) {
      await rm(path.join(parent, entry.name), { recursive: true, force: true });
    }
  }
}

async function install(name, files, foldername, sourceDir = '') {
  const version = packageVersion(name);
  if (!version) {
    throw new Error(
      `Cannot find the "${name}" package. Run "npm install" in the repository root first.`,
    );
  }
  const source = path.join(packageRoot(name), sourceDir);
  const target = path.join(publicRuntimes, foldername, version);
  let copied = 0;
  for (const file of files) {
    if (await copyIfChanged(path.join(source, file), path.join(target, file))) copied += 1;
  }
  await pruneOldVersions(path.join(publicRuntimes, foldername), version);
  return { version, copied };
}

async function installJava() {
  const name = '@live-codes/java-wasm';
  const result = await install(name, JAVA_FILES, 'java', 'dist');
  const target = path.join(publicRuntimes, 'java', result.version);
  for (const file of ['LICENSE', 'THIRD-PARTY-NOTICES.md']) {
    if (await copyIfChanged(path.join(packageRoot(name), file), path.join(target, file))) {
      result.copied += 1;
    }
  }
  return result;
}

async function installCpp() {
  const name = 'JSCPP';
  const version = packageVersion(name);
  if (!version) {
    throw new Error(
      `Cannot find the "${name}" package. Run "npm install" in the repository root first.`,
    );
  }
  const folder = path.join(publicRuntimes, 'cpp', version);
  const outfile = path.join(folder, 'JSCPP.bundle.js');
  let copied = 0;
  if (!(await exists(outfile))) {
    await mkdir(folder, { recursive: true });
    await esbuildBuild({
      stdin: {
        contents:
          "import launcher from 'JSCPP/lib/launcher.js'; globalThis.JSCPP = launcher;",
        resolveDir: root,
        sourcefile: 'jscpp-entry.js',
        loader: 'js',
      },
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2020',
      minify: true,
      outfile,
      logLevel: 'silent',
      plugins: [
        {
          name: 'node-stubs',
          setup(build) {
            build.onResolve({ filter: /^(util|stream)$/ }, (args) => ({
              path: args.path,
              namespace: 'node-stub',
            }));
            build.onLoad({ filter: /.*/, namespace: 'node-stub' }, (args) => ({
              contents:
                args.path === 'util'
                  ? 'export function inspect(value) { try { return typeof value === "string" ? value : JSON.stringify(value); } catch { return String(value); } }'
                  : 'export class Stream {}',
              loader: 'js',
            }));
          },
        },
      ],
    });
    copied += 1;
  }
  if (
    await copyIfChanged(
      path.join(packageRoot(name), 'LICENSE'),
      path.join(folder, 'LICENSE.txt'),
    )
  ) {
    copied += 1;
  }
  await pruneOldVersions(path.join(publicRuntimes, 'cpp'), version);
  return { version, copied };
}

async function main() {
  await mkdir(publicRuntimes, { recursive: true });

  const pyodide = await install('pyodide', PYODIDE_FILES, 'pyodide');
  const sqljs = await install('sql.js', SQLJS_FILES, 'sqljs', 'dist');
  const java = await installJava();
  const cpp = await installCpp();
  const sucraseVersion = packageVersion('sucrase');

  const manifest = {
    version: 1,
    languages: {
      javascript: { kind: 'bundled', version: 'browser' },
      typescript: { kind: 'bundled', version: sucraseVersion ?? 'bundled' },
      python: {
        kind: 'wasm',
        version: pyodide.version,
        url: `./runtimes/pyodide/${pyodide.version}/`,
      },
      sql: {
        kind: 'wasm',
        version: sqljs.version,
        url: `./runtimes/sqljs/${sqljs.version}/`,
      },
      java: {
        kind: 'wasm',
        version: java.version,
        url: `./runtimes/java/${java.version}/`,
      },
      cpp: {
        kind: 'bundled',
        version: cpp.version,
        url: `./runtimes/cpp/${cpp.version}/`,
      },
    },
  };
  // Keep the manifest outside /runtimes/ so the immutable cache rule for the
  // versioned runtime files cannot pin an old manifest after a release.
  await writeFile(
    path.join(root, 'apps', 'web', 'public', 'runtime-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  const changed = pyodide.copied + sqljs.copied + java.copied + cpp.copied;
  console.log(
    `[runtimes] Pyodide ${pyodide.version}, sql.js ${sqljs.version}, Java ${java.version}, ` +
      `JSCPP ${cpp.version}, Sucrase ${sucraseVersion ?? 'bundled'}` +
      (changed > 0 ? ` (${changed} file${changed === 1 ? '' : 's'} updated)` : ' (up to date)'),
  );
}

main().catch((error) => {
  console.error(`[runtimes] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
