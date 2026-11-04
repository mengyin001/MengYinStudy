/**
 * Code sandbox.
 *
 * A hidden `<iframe sandbox="allow-scripts">` gets the strictest CSP we can
 * express, then runs every test program inside short-lived Web Workers:
 *
 *   app  ──postMessage──▶  iframe (opaque origin, CSP: default-src 'none')
 *                             └─ Worker (own thread, network blocked)
 *
 * JavaScript runs one fresh worker per test, so globals cannot leak between
 * cases. Python (Pyodide) and SQL (sql.js) load a WebAssembly runtime once and
 * reuse a single worker, because booting the runtime per case would be far too
 * slow. A timeout still terminates that worker, and the batch resumes in a
 * fresh one for the remaining cases.
 *
 * Why the layering:
 * - a Worker has its own thread, so `while (true)` can be terminated without
 *   freezing the page;
 * - the iframe gives an opaque origin (no app DOM, storage or cookies) and its
 *   CSP is inherited by blob workers, blocking fetch/XHR/WebSocket;
 * - the runtime is served from the app's own origin with CORS, so a static
 *   deployment needs no execution server.
 *
 * This is a study aid, not a security boundary for hostile code. It stops
 * runaway loops, network access and storage; it cannot cap memory.
 */

export interface SandboxProgramResult {
  ok: boolean;
  output: string;
  error?: string;
  ms: number;
}

/** Languages the sandbox can execute. TypeScript is transpiled before it gets here. */
export type SandboxLanguage = 'javascript' | 'python' | 'sql' | 'java' | 'cpp';

export interface SandboxOptions {
  /** Per-program wall clock limit. */
  timeoutMs?: number;
  /** Abort the whole batch (e.g. the user left the question). */
  signal?: AbortSignal;
  /** Defaults to JavaScript. */
  language?: SandboxLanguage;
  /** Absolute URL of the runtime directory, required outside JavaScript. */
  runtimeBase?: string;
  /** Per-program stdin text (Java/C++). */
  stdins?: readonly string[];
}

const CHANNEL = 'mengyin:code-sandbox';
const MAX_PROGRAMS = 20;
const MAX_PROGRAM_CHARS = 200_000;
const RUNTIME_LOAD_TIMEOUT_MS = 90_000;

/**
 * Runs inside the iframe's JavaScript worker. Kept as a string because it
 * becomes a Blob. One worker per case gives each program a clean global scope.
 */
const JS_WORKER_SOURCE = String.raw`
'use strict';
const MAX_OUTPUT = 100000;

function stringify(value, depth) {
  const level = depth || 0;
  if (level > 4) return '…';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value === 'undefined') return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'function') return '[Function ' + (value.name || 'anonymous') + ']';
  if (typeof value === 'symbol') return value.toString();
  if (value instanceof Error) return value.name + ': ' + value.message;
  if (Array.isArray(value)) return '[' + value.map((item) => stringify(item, level + 1)).join(', ') + ']';
  if (typeof value === 'object') {
    const seen = new WeakSet();
    try {
      const text = JSON.stringify(value, (key, item) => {
        if (item && typeof item === 'object') {
          if (seen.has(item)) return '[Circular]';
          seen.add(item);
        }
        return item;
      });
      return text === undefined ? String(value) : text;
    } catch (error) {
      return '[Object]';
    }
  }
  return String(value);
}

function formatError(error) {
  if (error && typeof error === 'object' && 'stack' in error) return String(error.stack);
  if (error && typeof error === 'object' && 'message' in error) return String(error.name || 'Error') + ': ' + String(error.message);
  return String(error);
}

const networkBlocked = function () {
  throw new Error('Sandbox: network access is disabled');
};

for (const key of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'sendBeacon']) {
  try {
    Object.defineProperty(self, key, { value: networkBlocked, writable: false, configurable: false });
  } catch (error) {
    try { self[key] = networkBlocked; } catch (ignored) { /* non-writable */ }
  }
}
for (const key of ['indexedDB', 'caches']) {
  try { Object.defineProperty(self, key, { value: undefined, writable: false, configurable: false }); } catch (error) { /* ignore */ }
}

// Capture the real channel before learner code can replace it, then disable it.
const postRaw = self.postMessage.bind(self);
try {
  Object.defineProperty(self, 'postMessage', {
    value: function () { throw new Error('Sandbox: postMessage is disabled'); },
    writable: false,
    configurable: false,
  });
} catch (error) { /* ignore */ }

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

self.onmessage = async function (event) {
  const data = event.data || {};
  if (data.type !== 'run') return;
  // Everything below lives in this closure. The learner's program is compiled
  // in global scope and cannot read the token or the captured postMessage, so
  // it cannot forge an output or a passing result.
  const token = data.token;
  const id = data.id;
  let sent = 0;
  let truncated = false;

  function send(message) {
    try { postRaw(Object.assign({ token: token }, message)); } catch (error) { /* channel closed */ }
  }

  function emit(text) {
    if (sent >= MAX_OUTPUT) {
      if (!truncated) {
        truncated = true;
        send({ type: 'output', id: id, text: '\n[output truncated]\n' });
      }
      return;
    }
    const chunk = String(text);
    const room = MAX_OUTPUT - sent;
    sent += Math.min(room, chunk.length);
    send({ type: 'output', id: id, text: chunk.slice(0, room) });
  }

  const fakeConsole = {
    log: (...args) => emit(args.map((item) => stringify(item)).join(' ') + '\n'),
    info: (...args) => emit(args.map((item) => stringify(item)).join(' ') + '\n'),
    warn: (...args) => emit(args.map((item) => stringify(item)).join(' ') + '\n'),
    error: (...args) => emit(args.map((item) => stringify(item)).join(' ') + '\n'),
    debug: (...args) => emit(args.map((item) => stringify(item)).join(' ') + '\n'),
    table: (...args) => emit(args.map((item) => stringify(item)).join(' ') + '\n'),
  };
  try { Object.defineProperty(self, 'console', { value: fakeConsole, writable: false, configurable: false }); } catch (error) { /* ignore */ }
  try {
    const fn = new AsyncFunction(
      'console', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'postMessage',
      '"use strict";\n' + String(data.code),
    );
    const value = await fn(
      fakeConsole,
      networkBlocked,
      networkBlocked,
      networkBlocked,
      networkBlocked,
      networkBlocked,
      function () { throw new Error('Sandbox: postMessage is disabled'); },
    );
    if (value !== undefined) emit(stringify(value) + '\n');
    send({ type: 'done', id: id, ok: true });
  } catch (error) {
    send({ type: 'done', id: id, ok: false, error: formatError(error) });
  }
};
`;

/**
 * Runs inside the iframe's runtime worker. The runtime is loaded once, then
 * each test starts from a fresh Python namespace or a fresh SQLite database.
 */
const RUNTIME_WORKER_SOURCE = String.raw`
'use strict';
const MAX_OUTPUT = 100000;
const RUNTIME_LOAD_TIMEOUT_MS = ${RUNTIME_LOAD_TIMEOUT_MS};

let LANGUAGE = '';
let RUNTIME_BASE = '';
let TOKEN = '';
let ready = false;
let pyodide = null;
let SQL = null;
let queue = Promise.resolve();
let currentRun = null;

const postRaw = self.postMessage.bind(self);

function send(message) {
  try { postRaw(Object.assign({ token: TOKEN }, message)); } catch (error) { /* channel closed */ }
}

function formatError(error) {
  if (error && typeof error === 'object') {
    if ('stack' in error && error.stack) return String(error.stack);
    if ('message' in error) return String(error.name || 'Error') + ': ' + String(error.message);
  }
  return String(error);
}

function emit(text) {
  const run = currentRun;
  if (!run) return;
  if (run.sent >= MAX_OUTPUT) {
    if (!run.truncated) {
      run.truncated = true;
      run.output += '\n[output truncated]\n';
    }
    return;
  }
  const chunk = String(text);
  const room = MAX_OUTPUT - run.sent;
  run.sent += Math.min(room, chunk.length);
  run.output += chunk.slice(0, room);
}

function emitLine(text) {
  emit(String(text) + '\n');
}

function emitStderr(text) {
  const run = currentRun;
  if (!run) return;
  run.stderr += String(text) + '\n';
}

function networkBlocked() {
  throw new Error('Sandbox: network access is disabled');
}

/**
 * The runtime has finished loading, so nothing trusted needs the network or the
 * message channel any more. Learner code (including Python through the js
 * module) sees only these disabled globals.
 */
function lockDown() {
  for (const key of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'sendBeacon']) {
    try {
      Object.defineProperty(self, key, { value: networkBlocked, writable: false, configurable: false });
    } catch (error) {
      try { self[key] = networkBlocked; } catch (ignored) { /* non-writable */ }
    }
  }
  for (const key of ['indexedDB', 'caches']) {
    try { Object.defineProperty(self, key, { value: undefined, writable: false, configurable: false }); } catch (error) { /* ignore */ }
  }
  try {
    Object.defineProperty(self, 'postMessage', {
      value: function () { throw new Error('Sandbox: postMessage is disabled'); },
      writable: false,
      configurable: false,
    });
  } catch (error) { /* ignore */ }
  const fakeConsole = {
    log: function () { emitLine(Array.prototype.map.call(arguments, String).join(' ')); },
    info: function () { emitLine(Array.prototype.map.call(arguments, String).join(' ')); },
    warn: function () { emitLine(Array.prototype.map.call(arguments, String).join(' ')); },
    error: function () { emitLine(Array.prototype.map.call(arguments, String).join(' ')); },
    debug: function () { emitLine(Array.prototype.map.call(arguments, String).join(' ')); },
  };
  try { Object.defineProperty(self, 'console', { value: fakeConsole, writable: false, configurable: false }); } catch (error) { /* ignore */ }
}

async function initRuntime() {
  if (LANGUAGE === 'python') {
    importScripts(RUNTIME_BASE + 'pyodide.js');
    pyodide = await loadPyodide({ indexURL: RUNTIME_BASE });
    pyodide.setStdout({ batched: function (text) { emitLine(text); } });
    pyodide.setStderr({ batched: function (text) { emitStderr(text); } });
  } else if (LANGUAGE === 'sql') {
    importScripts(RUNTIME_BASE + 'sql-wasm.js');
    SQL = await initSqlJs({ locateFile: function (file) { return RUNTIME_BASE + file; } });
  } else if (LANGUAGE === 'cpp') {
    importScripts(RUNTIME_BASE + 'JSCPP.bundle.js');
    if (!globalThis.JSCPP || typeof globalThis.JSCPP.run !== 'function') {
      throw new Error('The C++ interpreter could not be loaded');
    }
  } else {
    throw new Error('Unsupported runtime language: ' + LANGUAGE);
  }
  lockDown();
  ready = true;
  send({ type: 'runtime-ready' });
}

async function runPython(code) {
  const globals = pyodide.globals.get('dict')();
  try {
    globals.set('__name__', '__main__');
    await pyodide.runPythonAsync(code, { globals: globals });
  } finally {
    try { globals.destroy(); } catch (error) { /* already gone */ }
  }
}

function cellText(value) {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Uint8Array) return '[blob]';
  return String(value);
}

function formatSqlResults(results) {
  return results.map(function (result) {
    const lines = [result.columns.join(' | ')];
    for (const row of result.values) lines.push(row.map(cellText).join(' | '));
    return lines.join('\n');
  }).join('\n\n');
}

function runSql(code) {
  const db = new SQL.Database();
  try {
    const results = db.exec(code);
    if (results && results.length > 0) emit(formatSqlResults(results) + '\n');
  } finally {
    try { db.close(); } catch (error) { /* already closed */ }
  }
}

function runCpp(code, stdin) {
  const exitCode = globalThis.JSCPP.run(code, stdin || '', {
    stdio: {
      write: function (text) {
        emit(String(text));
      },
    },
  });
  if (typeof exitCode === 'number' && exitCode !== 0) {
    throw new Error('Program exited with code ' + exitCode);
  }
}

async function runOne(data) {
  const id = data.id;
  const code = String(data.code || '');
  const started = performance.now();
  const run = { output: '', stderr: '', sent: 0, truncated: false };
  currentRun = run;
  let error;
  try {
    if (LANGUAGE === 'python') await runPython(code);
    else if (LANGUAGE === 'sql') runSql(code);
    else if (LANGUAGE === 'cpp') runCpp(code, data.stdin === undefined ? '' : String(data.stdin));
    else throw new Error('Unsupported runtime language: ' + LANGUAGE);
  } catch (caught) {
    error = formatError(caught);
    const stderr = run.stderr.trim();
    if (stderr && error.indexOf(stderr) === -1) error += '\n' + stderr;
  } finally {
    currentRun = null;
  }
  send({
    type: 'case',
    id: id,
    ok: !error,
    output: run.output,
    ms: Math.round(performance.now() - started),
    ...(error ? { error: error } : {}),
  });
}

self.onmessage = function (event) {
  const data = event.data || {};
  if (data.type === 'init') {
    LANGUAGE = String(data.language || '');
    RUNTIME_BASE = String(data.runtimeBase || '');
    TOKEN = String(data.token || '');
    initRuntime().catch(function (error) {
      send({ type: 'runtime-error', error: formatError(error) });
    });
    return;
  }
  if (data.type !== 'run') return;
  if (!ready) {
    send({ type: 'case', id: data.id, ok: false, output: '', error: 'The runtime is not ready', ms: 0 });
    return;
  }
  queue = queue
    .then(function () { return runOne(data); })
    .catch(function (error) {
      send({ type: 'case', id: data.id, ok: false, output: '', error: formatError(error), ms: 0 });
    });
};
`;

function runtimeOrigin(runtimeBase?: string): string | null {
  if (!runtimeBase) return null;
  try {
    const url = new URL(runtimeBase, document.baseURI);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin;
  } catch {
    // A missing or malformed runtime URL only matters for non-JS languages.
  }
  return null;
}

function sandboxCsp(runtimeBase?: string): string {
  const origin = runtimeOrigin(runtimeBase);
  const script = ["'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", 'blob:'];
  const connect = ["'none'"];
  if (origin) {
    script.push(origin);
    connect.length = 0;
    connect.push(origin);
  }
  return [
    "default-src 'none'",
    `script-src ${script.join(' ')}`,
    `connect-src ${connect.join(' ')}`,
    'worker-src blob:',
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

function buildDocument(token: string, runtimeBase?: string): string {
  const bootstrap = String.raw`
(function () {
  'use strict';
  var CHANNEL = ${JSON.stringify(CHANNEL)};
  var TOKEN = ${JSON.stringify(token)};
  var JS_WORKER_SOURCE = ${JSON.stringify(JS_WORKER_SOURCE)};
  var RUNTIME_WORKER_SOURCE = ${JSON.stringify(RUNTIME_WORKER_SOURCE)};
  var RUNTIME_LOAD_TIMEOUT_MS = ${RUNTIME_LOAD_TIMEOUT_MS};
  var running = false;

  function post(message) {
    try { parent.postMessage(Object.assign({ channel: CHANNEL, token: TOKEN }, message), '*'); } catch (error) {}
  }

  function randomToken() {
    try {
      var bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.prototype.map.call(bytes, function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');
    } catch (error) {
      return String(Math.random()).slice(2) + '-' + String(Date.now());
    }
  }

  function workerUrl(source) {
    return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  }

  function runJsProgram(program, index, timeoutMs) {
    return new Promise(function (resolve) {
      var url = workerUrl(JS_WORKER_SOURCE);
      var runToken = randomToken();
      var worker;
      try {
        worker = new Worker(url);
      } catch (error) {
        URL.revokeObjectURL(url);
        resolve({ ok: false, output: '', error: 'Sandbox unavailable: ' + String(error), ms: 0 });
        return;
      }
      var output = '';
      var settled = false;
      var started = performance.now();
      function finish(result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        URL.revokeObjectURL(url);
        resolve({ ok: result.ok === true, output: output, error: result.error, ms: Math.round(performance.now() - started) });
      }
      var timer = setTimeout(function () {
        finish({ ok: false, error: 'Time limit exceeded (' + timeoutMs + ' ms)' });
      }, timeoutMs);
      worker.onmessage = function (event) {
        var data = event.data || {};
        if (data.token !== runToken) return;
        if (data.type === 'output') {
          output += String(data.text || '');
          if (output.length > 200000) output = output.slice(0, 200000) + '\n[output truncated]\n';
        } else if (data.type === 'done') {
          finish({ ok: data.ok, error: typeof data.error === 'string' ? data.error : undefined });
        }
      };
      worker.onerror = function (event) {
        finish({ ok: false, error: (event && event.message) || 'Worker failed to start' });
      };
      worker.postMessage({ type: 'run', id: index, code: program, token: runToken });
    });
  }

  function loadRuntimeWorker(language, runtimeBase, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var url = workerUrl(RUNTIME_WORKER_SOURCE);
      var worker;
      try {
        worker = new Worker(url);
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(new Error('Sandbox unavailable: ' + String(error)));
        return;
      }
      var runToken = randomToken();
      var settled = false;
      var timer = setTimeout(function () {
        finish(new Error('The ' + language + ' runtime took too long to load'));
      }, timeoutMs);
      function finish(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        if (error) {
          worker.terminate();
          URL.revokeObjectURL(url);
          reject(error);
        } else {
          resolve({ worker: worker, token: runToken, url: url });
        }
      }
      function onMessage(event) {
        var data = event.data || {};
        if (data.token !== runToken) return;
        if (data.type === 'runtime-ready') finish(null);
        else if (data.type === 'runtime-error') finish(new Error(String(data.error || 'The runtime could not be loaded')));
      }
      function onError(event) {
        finish(new Error((event && event.message) || 'The runtime worker failed to start'));
      }
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage({ type: 'init', language: language, runtimeBase: runtimeBase, token: runToken });
    });
  }

  function runOneInSession(session, program, index, timeoutMs, stdin) {
    return new Promise(function (resolve) {
      var output = '';
      var settled = false;
      var started = performance.now();
      function finish(result, restart) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        session.worker.removeEventListener('message', onMessage);
        session.worker.removeEventListener('error', onError);
        resolve({ result: result, restart: restart === true });
      }
      function onMessage(event) {
        var data = event.data || {};
        if (data.token !== session.token) return;
        if (data.type === 'output') {
          output += String(data.text || '');
          if (output.length > 200000) output = output.slice(0, 200000) + '\n[output truncated]\n';
        } else if (data.type === 'case' && data.id === index) {
          finish({
            ok: data.ok === true,
            // Runtime workers accumulate output inside the worker and send it
            // with the case, while the JavaScript worker streams it.
            output: typeof data.output === 'string' ? data.output : output,
            error: typeof data.error === 'string' ? data.error : undefined,
            ms: typeof data.ms === 'number' ? data.ms : Math.round(performance.now() - started),
          });
        }
      }
      function onError(event) {
        finish({
          ok: false,
          output: output,
          error: (event && event.message) || 'The runtime worker crashed',
          ms: Math.round(performance.now() - started),
        }, true);
      }
      var timer = setTimeout(function () {
        finish({
          ok: false,
          output: output,
          error: 'Time limit exceeded (' + timeoutMs + ' ms)',
          ms: timeoutMs,
        }, true);
      }, timeoutMs);
      session.worker.addEventListener('message', onMessage);
      session.worker.addEventListener('error', onError);
      session.worker.postMessage({
        type: 'run',
        id: index,
        code: program,
        stdin: stdin === undefined ? '' : String(stdin),
        token: session.token,
      });
    });
  }

  function loadJavaBundle(runtimeBase) {
    if (typeof JavaWasm !== 'undefined') return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = runtimeBase + 'java-wasm.iife.js';
      script.onload = function () {
        if (typeof JavaWasm !== 'undefined') resolve();
        else reject(new Error('The Java runtime bundle did not expose JavaWasm'));
      };
      script.onerror = function () {
        reject(new Error('The Java runtime could not be loaded'));
      };
      document.head.appendChild(script);
    });
  }

  function createJavaRuntime(runtimeBase) {
    var init = JavaWasm.createRuntime({ baseUrl: runtimeBase });
    var timeout = new Promise(function (_, reject) {
      setTimeout(function () {
        reject(new Error('The Java runtime took too long to load'));
      }, RUNTIME_LOAD_TIMEOUT_MS);
    });
    return Promise.race([init, timeout]);
  }

  function runJavaCase(runtime, program, stdin, timeoutMs) {
    return new Promise(function (resolve) {
      var settled = false;
      var started = performance.now();
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        try { runtime.destroy(); } catch (error) { /* already gone */ }
        resolve({
          result: {
            ok: false,
            output: '',
            error: 'Time limit exceeded (' + timeoutMs + ' ms)',
            ms: timeoutMs,
          },
          restart: true,
        });
      }, timeoutMs);
      runtime.run(String(program), { input: stdin === undefined ? '' : String(stdin) }).then(
        function (value) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          var ms = 0;
          if (value && typeof value.compileMs === 'number') ms += value.compileMs;
          if (value && typeof value.generateMs === 'number') ms += value.generateMs;
          if (value && typeof value.runMs === 'number') ms += value.runMs;
          resolve({
            result: {
              ok: !!(value && value.ok),
              output: String((value && value.output) || ''),
              ...(value && value.error ? { error: String(value.error) } : {}),
              ms: Math.max(Math.round(ms), Math.round(performance.now() - started)),
            },
            restart: false,
          });
        },
        function (error) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            result: {
              ok: false,
              output: '',
              error: String((error && error.message) || error),
              ms: Math.round(performance.now() - started),
            },
            restart: true,
          });
        },
      );
    });
  }

  async function runJavaBatch(programs, stdins, runtimeBase, timeoutMs) {
    var results = [];
    try {
      await loadJavaBundle(runtimeBase);
    } catch (error) {
      var message = String((error && error.message) || error);
      for (var i = 0; i < programs.length; i += 1) {
        results[i] = { ok: false, output: '', error: message, ms: 0 };
      }
      return results;
    }

    var runtime = null;
    var index = 0;
    while (index < programs.length) {
      if (!runtime) {
        try {
          runtime = await createJavaRuntime(runtimeBase);
        } catch (error) {
          var initMessage = String((error && error.message) || error);
          for (var rest = index; rest < programs.length; rest += 1) {
            results[rest] = { ok: false, output: '', error: initMessage, ms: 0 };
          }
          break;
        }
      }
      var outcome = await runJavaCase(
        runtime,
        programs[index],
        Array.isArray(stdins) ? stdins[index] : '',
        timeoutMs,
      );
      results[index] = outcome.result;
      index += 1;
      if (outcome.restart) {
        try { runtime.destroy(); } catch (error) { /* already gone */ }
        runtime = null;
      }
    }
    if (runtime) {
      try { runtime.destroy(); } catch (error) { /* already gone */ }
    }
    return results;
  }

  async function runRuntimeBatch(programs, language, runtimeBase, timeoutMs, stdins) {
    var results = [];
    var index = 0;
    while (index < programs.length) {
      var session;
      try {
        session = await loadRuntimeWorker(language, runtimeBase, RUNTIME_LOAD_TIMEOUT_MS);
      } catch (error) {
        var message = String((error && error.message) || error);
        for (var rest = index; rest < programs.length; rest += 1) {
          results[rest] = { ok: false, output: '', error: message, ms: 0 };
        }
        break;
      }
      while (index < programs.length) {
        var outcome = await runOneInSession(
          session,
          String(programs[index]),
          index,
          timeoutMs,
          Array.isArray(stdins) ? stdins[index] : '',
        );
        results[index] = outcome.result;
        index += 1;
        if (outcome.restart) {
          session.worker.terminate();
          URL.revokeObjectURL(session.url);
          session = null;
          break;
        }
      }
      if (session) {
        session.worker.terminate();
        URL.revokeObjectURL(session.url);
      }
    }
    return results;
  }

  window.addEventListener('message', function (event) {
    if (event.source !== parent) return;
    var data = event.data || {};
    if (data.channel !== CHANNEL || data.token !== TOKEN || data.type !== 'run') return;
    if (running) return;
    running = true;
    var programs = Array.isArray(data.programs) ? data.programs : [];
    var stdins = Array.isArray(data.stdins) ? data.stdins : [];
    var timeoutMs = Number(data.timeoutMs) || 3000;
    var language = String(data.language || 'javascript');
    var runtimeBase = String(data.runtimeBase || '');
    (async function () {
      if (language === 'javascript') {
        for (var i = 0; i < programs.length; i += 1) {
          var result = await runJsProgram(String(programs[i]), i, timeoutMs);
          post({ type: 'case', index: i, ok: result.ok, output: result.output, error: result.error, ms: result.ms });
        }
      } else {
        var results = language === 'java'
          ? await runJavaBatch(programs, stdins, runtimeBase, timeoutMs)
          : await runRuntimeBatch(programs, language, runtimeBase, timeoutMs, stdins);
        for (var index = 0; index < results.length; index += 1) {
          var item = results[index] || { ok: false, output: '', error: 'The runtime did not run this case', ms: 0 };
          post({ type: 'case', index: index, ok: item.ok, output: item.output, error: item.error, ms: item.ms });
        }
      }
      post({ type: 'done' });
    })().catch(function (error) {
      post({ type: 'fatal', message: String(error) });
    });
  });

  post({ type: 'ready' });
})();
`;
  // Closing tags inside the bootstrap would end the script element early.
  const safeBootstrap = bootstrap.replace(/<\/script/gi, '<\\/script');
  return [
    '<!doctype html><html><head><meta charset="utf-8" />',
    `<meta http-equiv="Content-Security-Policy" content="${sandboxCsp(runtimeBase)}" />`,
    '</head><body>',
    `<script>${safeBootstrap}</script>`,
    '</body></html>',
  ].join('');
}

function makeToken(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function abortError(): DOMException {
  return new DOMException('The code run was cancelled', 'AbortError');
}

/**
 * Run each program in the sandbox. Output is stdout captured from the
 * language's print function (or `console.*` for JavaScript) plus a trailing
 * `return` value when a JavaScript program has one.
 */
export async function runPrograms(
  programs: readonly string[],
  options: SandboxOptions = {},
): Promise<SandboxProgramResult[]> {
  if (programs.length === 0) return [];
  if (programs.length > MAX_PROGRAMS) throw new Error(`Too many sandbox programs (max ${MAX_PROGRAMS})`);
  for (const program of programs) {
    if (program.length > MAX_PROGRAM_CHARS) {
      throw new Error(`Sandbox program is too large (max ${MAX_PROGRAM_CHARS} characters)`);
    }
  }
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    throw new Error('The code sandbox needs a browser environment');
  }
  if (options.signal?.aborted) throw abortError();

  const language = options.language ?? 'javascript';
  if (language !== 'javascript' && !options.runtimeBase) {
    throw new Error(`The ${language} runtime is not installed`);
  }

  const maxTimeout = language === 'java' ? 30_000 : 10_000;
  const timeoutMs = Math.min(maxTimeout, Math.max(500, Math.round(options.timeoutMs ?? 3000)));
  const token = makeToken();
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('tabindex', '-1');
  iframe.title = 'Code sandbox';
  iframe.style.cssText =
    'position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;';

  const results: SandboxProgramResult[] = Array.from({ length: programs.length }, () => ({
    ok: false,
    output: '',
    error: 'The sandbox did not return a result',
    ms: 0,
  }));

  let cleanup = () => {};
  const batch = new Promise<SandboxProgramResult[]>((resolve, reject) => {
    let settled = false;
    let started = false;
    let received = 0;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(hardTimer);
      window.clearTimeout(readyTimer);
      window.removeEventListener('message', onMessage);
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
      iframe.remove();
      if (error) reject(error);
      else resolve(results);
    };

    const onAbort = () => finish(abortError());

    const sendRun = () => {
      if (started || settled) return;
      started = true;
      iframe.contentWindow?.postMessage(
        {
          channel: CHANNEL,
          token,
          type: 'run',
          programs: [...programs],
          stdins: options.stdins ? [...options.stdins] : [],
          timeoutMs,
          language,
          runtimeBase: options.runtimeBase ?? '',
        },
        '*',
      );
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.channel !== CHANNEL || data.token !== token) return;

      if (data.type === 'ready') {
        sendRun();
        return;
      }
      if (data.type === 'case') {
        const index = Number(data.index);
        if (!Number.isInteger(index) || index < 0 || index >= results.length) return;
        results[index] = {
          ok: data.ok === true,
          output: typeof data.output === 'string' ? data.output : '',
          ...(typeof data.error === 'string' ? { error: data.error } : {}),
          ms: typeof data.ms === 'number' ? data.ms : 0,
        };
        received += 1;
        if (received === results.length) finish();
        return;
      }
      if (data.type === 'done') {
        finish();
        return;
      }
      if (data.type === 'fatal') {
        finish(new Error(typeof data.message === 'string' ? data.message : 'Sandbox failed'));
      }
    };

    const loadBudget = language === 'javascript' ? 0 : RUNTIME_LOAD_TIMEOUT_MS;
    const hardTimer = window.setTimeout(
      () => finish(new Error('The code sandbox timed out')),
      Math.min(600_000, loadBudget + programs.length * timeoutMs + 30_000),
    );
    const readyTimer = window.setTimeout(
      () => finish(new Error('The code sandbox could not be started')),
      20_000,
    );

    window.addEventListener('message', onMessage);
    if (options.signal) {
      if (options.signal.aborted) {
        finish(abortError());
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
    iframe.srcdoc = buildDocument(token, options.runtimeBase);
    document.body.appendChild(iframe);
    cleanup = () => finish(abortError());
  });

  try {
    return await batch;
  } finally {
    cleanup();
    iframe.remove();
  }
}
