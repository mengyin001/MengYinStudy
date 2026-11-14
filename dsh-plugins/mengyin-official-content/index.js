/**
 * DSH Host plugin: official content authoring for MengYin Study.
 *
 * The tools are thin model-facing wrappers. The real work lives in
 * `tools/official-content.mjs` in this workspace, which reuses the app's own
 * generation Worker in-process, uploads images to the public `official-media`
 * bucket and writes `official_packs` / `official_decks`.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const inject = ['tools'];

const here = fileURLToPath(import.meta.url);
const workspace = path.resolve(path.dirname(here), '..', '..');
const cli = path.join(workspace, 'tools', 'official-content.mjs');
const CLI_TIMEOUT_MS = 25 * 60 * 1000;
const MAX_STDOUT_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 128 * 1024;

function nodeExecutable() {
  const explicit = (process.env.MENGYIN_NODE || '').trim();
  if (explicit && existsSync(explicit)) return explicit;

  const home = process.env.DSH_HOME;
  if (home) {
    const runtimes = path.join(home, 'dsh-runtimes');
    try {
      const entries = readdirSync(runtimes, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(
          runtimes,
          entry.name,
          'dependencies',
          'node',
          'bin',
          process.platform === 'win32' ? 'node.exe' : 'node',
        );
        if (existsSync(candidate)) return candidate;
      }
    } catch {
      // Fall through to the executable that runs this Host.
    }
  }

  return process.execPath;
}

function parseLastJson(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith('{')) continue;
    try {
      return JSON.parse(line);
    } catch {
      // Keep looking: a warning line may contain braces.
    }
  }
  return null;
}

function runCli(command, spec, signal) {
  return new Promise((resolve, reject) => {
    if (!existsSync(cli)) {
      reject(
        new Error(
          `The MengYin Study authoring script was not found at ${cli}. Install this plugin from the MengYinStudy workspace.`,
        ),
      );
      return;
    }

    let child;
    try {
      child = spawn(nodeExecutable(), [cli, command, '--spec', '-'], {
        cwd: workspace,
        env: {
          ...process.env,
          ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
          NODE_NO_WARNINGS: '1',
          AUTH_REQUIRED: 'false',
          BILLING_ENFORCE: 'false',
        },
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(new Error(`Could not start the official authoring process: ${error.message}`));
      return;
    }

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(value);
    };

    const kill = () => {
      try {
        child.kill();
      } catch {
        // The process may have exited already.
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, CLI_TIMEOUT_MS);

    const onAbort = () => {
      kill();
    };
    if (signal) {
      if (signal.aborted) {
        kill();
        finish(new Error('The official content request was cancelled.'));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout?.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        stdout += chunk.toString('utf8');
        kill();
        finish(new Error('The official content process returned more output than expected.'));
        return;
      }
      stdout += chunk.toString('utf8');
    });

    child.stderr?.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_STDERR_BYTES) {
        stderr = `${stderr.slice(-MAX_STDERR_BYTES / 2)}\n${chunk.toString('utf8')}`;
        stderr = stderr.slice(-MAX_STDERR_BYTES);
      } else {
        stderr += chunk.toString('utf8');
      }
    });

    child.on('error', (error) => {
      finish(
        new Error(
          `Could not start Node for official authoring (${nodeExecutable()}): ${error.message}`,
        ),
      );
    });

    child.on('close', (code) => {
      if (settled) return;
      if (timedOut) {
        finish(
          new Error(
            'Official content creation timed out after 25 minutes. Try fewer questions, or turn images off.',
          ),
        );
        return;
      }
      if (signal?.aborted) {
        finish(new Error('The official content request was cancelled.'));
        return;
      }

      const result = parseLastJson(stdout);
      if (code === 0 && result && result.ok !== false) {
        finish(null, result);
        return;
      }

      const stderrTail = stderr.trim().split(/\r?\n/).slice(-12).join('\n');
      const message =
        (result && result.error && result.error.message) ||
        stderrTail ||
        `The official content process exited with code ${code}.`;
      finish(new Error(message));
    });

    child.stdin?.on('error', () => {
      // A closed stdin is reported by the exit path; the message is clearer there.
    });
    child.stdin?.end(JSON.stringify(spec ?? {}));
  });
}

const genericOutput = {
  schema: { type: 'object', additionalProperties: true },
  render(_args, value) {
    const lines = [
      value && typeof value.summary === 'string' ? value.summary : JSON.stringify(value ?? {}),
    ];
    if (value && Array.isArray(value.warnings) && value.warnings.length > 0) {
      const shown = value.warnings.slice(0, 3).map((warning) => String(warning));
      const more = value.warnings.length > shown.length ? ` (+${value.warnings.length - shown.length} more)` : '';
      lines.push(`Warnings: ${shown.join(' | ')}${more}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
};

function bankSpec(args) {
  return {
    description: args.description,
    title: args.title,
    count: args.count,
    types: args.types,
    codeLanguage: args.code_language,
    difficulty: args.difficulty,
    language: args.language,
    images: args.images,
    imageMax: args.image_max,
    model: args.model,
    tags: args.tags,
    packId: args.pack_id,
    packName: args.pack_name,
    packDescription: args.pack_description,
    deckDescription: args.deck_description,
    published: args.published,
    attachments: args.attachments,
  };
}

function collectionSpec(args) {
  return {
    name: args.name,
    description: args.description,
    tags: args.tags,
    author: args.author,
    homepage: args.homepage,
    license: args.license,
    published: args.published,
    id: args.id,
    sortOrder: args.sort_order,
  };
}

function catalogText(value) {
  const lines = [value && typeof value.summary === 'string' ? value.summary : 'Official catalogue'];
  for (const pack of (value && Array.isArray(value.packs) ? value.packs : [])) {
    const state = pack.published ? (pack.visibleInApp ? 'visible' : 'no published banks') : 'draft';
    lines.push('');
    lines.push(`[${pack.id}] ${pack.name} — ${pack.deckCount} bank(s), ${state}`);
    for (const deck of Array.isArray(pack.decks) ? pack.decks : []) {
      const marks = [
        `${deck.questions} question${deck.questions === 1 ? '' : 's'}`,
        deck.figures ? `${deck.figures} figure${deck.figures === 1 ? '' : 's'}` : '',
        deck.images ? `${deck.images} image${deck.images === 1 ? '' : 's'}` : '',
        deck.examMinutes ? `${deck.examMinutes} min` : '',
        deck.published ? '' : 'draft',
        deck.visibleInApp ? '' : 'hidden',
      ].filter(Boolean);
      lines.push(`  - ${deck.id}: ${deck.title} (${marks.join(', ')})`);
    }
  }
  if (value && value.truncated) lines.push('', 'More collections exist; narrow with pack_id or raise limit.');
  return [{ type: 'text', text: lines.join('\n') }];
}

const catalogTool = {
  name: 'official_catalog',
  description:
    'List MengYin Study official collections (合集) and question banks (題庫) with their ids, question and image counts, and whether each is visible in the Plaza. Use it to find an existing collection id before publishing, or to identify content before deleting it.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      pack_id: {
        type: 'string',
        description: 'Show only this collection id.',
      },
      include_unpublished: {
        type: 'boolean',
        description: 'Include drafts (unpublished collections and banks). Defaults to false.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum collections to return, 1–100. Defaults to 50.',
      },
    },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => catalogText(value),
  },
  timeoutMs: 2 * 60 * 1000,
  async execute(args, exec) {
    return runCli(
      'list',
      {
        packId: args.pack_id,
        includeUnpublished: args.include_unpublished,
        limit: args.limit,
      },
      exec.signal,
    );
  },
  presentCall: (args) => ({
    card: 'generic',
    title: 'List official content',
    kind: 'read',
    rawInput: args,
  }),
};

const collectionCreateTool = {
  name: 'official_collection_create',
  description:
    'Create an official collection (合集) — the Plaza pack that groups question banks. A collection appears in the Plaza only after it has at least one published question bank, so create the bank next (or pass this collection id as pack_id to official_question_bank_create).',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: {
        type: 'string',
        description: 'Collection name shown in the Plaza, 1–80 characters.',
      },
      description: {
        type: 'string',
        description: 'Short catalogue description, at most 2000 characters.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Up to 8 tags, each at most 40 characters.',
      },
      author: {
        type: 'string',
        description: 'Author shown in the catalogue. Defaults to "MengYin Study".',
      },
      homepage: {
        type: 'string',
        description: 'Optional homepage URL.',
      },
      license: {
        type: 'string',
        description: 'Optional licence label.',
      },
      id: {
        type: 'string',
        description:
          'Optional stable id: 2–64 letters, digits, dots, underscores or hyphens. Omit for a generated id.',
      },
      sort_order: {
        type: 'integer',
        description: 'Optional catalogue position. Omit to append.',
      },
      published: {
        type: 'boolean',
        description: 'Publish immediately. Defaults to true.',
      },
    },
  },
  output: genericOutput,
  timeoutMs: 2 * 60 * 1000,
  isConcurrencySafe: () => false,
  async execute(args, exec) {
    return runCli('create-pack', collectionSpec(args), exec.signal);
  },
  presentCall: (args) => ({
    card: 'generic',
    title: 'Create official collection',
    kind: 'other',
    rawInput: args,
  }),
};

const bankCreateTool = {
  name: 'official_question_bank_create',
  description:
    'Create and publish an official question bank (題庫) from a written description. The app’s own AI generation pipeline writes and validates the questions, and attaches exact diagrams or photos when images is not off. If pack_id is omitted, a new collection (合集) is created for the bank. Generation usually takes 10–90 seconds and can take several minutes when photos are enabled.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['description'],
    properties: {
      description: {
        type: 'string',
        description:
          'The authoring brief: topic, level, scope and any constraints. The questions are written from this text. At most 20,000 characters.',
      },
      title: {
        type: 'string',
        description: 'Bank title, at most 200 characters. Defaults to the first line of the description.',
      },
      count: {
        type: 'integer',
        description: 'Number of questions to write, 1–50. Defaults to 10.',
      },
      types: {
        type: 'array',
        items: { type: 'string', enum: ['single', 'multi', 'boolean', 'fill', 'short', 'code'] },
        description:
          'Question types to allow. Defaults to single, multi and boolean (all auto-gradable).',
      },
      code_language: {
        type: 'string',
        enum: ['javascript', 'typescript', 'python', 'sql', 'java', 'cpp'],
        description: 'Language for code questions when types includes code. Defaults to javascript.',
      },
      difficulty: {
        type: 'string',
        enum: ['mixed', 'easy', 'hard'],
        description: 'Difficulty band. Defaults to mixed.',
      },
      language: {
        type: 'string',
        enum: ['auto', 'en', 'zh-Hant'],
        description: 'Question language. auto follows the description.',
      },
      images: {
        type: 'string',
        enum: ['off', 'auto', 'on'],
        description:
          'off writes text only; auto adds a figure where it helps; on asks for a visual on every eligible question. Figures are vector specs drawn by the app; photos are uploaded to the official media bucket. Defaults to auto.',
      },
      image_max: {
        type: 'integer',
        description: 'Maximum generated photos, 0–20. Diagrams are not counted. Defaults to 4.',
      },
      model: {
        type: 'string',
        description:
          'Optional exact text model id. Omit to use the configured default with automatic fallback on a provider rate limit.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Up to 8 extra tags, each at most 40 characters.',
      },
      pack_id: {
        type: 'string',
        description: 'Existing collection id to publish into. Omit to create a new collection.',
      },
      pack_name: {
        type: 'string',
        description: 'Name for the new collection when pack_id is omitted. Defaults to the bank title.',
      },
      pack_description: {
        type: 'string',
        description: 'Description for the new collection when pack_id is omitted.',
      },
      deck_description: {
        type: 'string',
        description: 'Optional catalogue description for the bank itself.',
      },
      published: {
        type: 'boolean',
        description: 'Publish immediately. Defaults to true.',
      },
      attachments: {
        type: 'array',
        description:
          'Local image files (SVG, PNG, JPEG, WebP, GIF, AVIF) to attach after generation. Each path is resolved against the workspace.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['question', 'path'],
          properties: {
            question: {
              type: 'integer',
              description: '1-based question number in the generated bank.',
            },
            path: {
              type: 'string',
              description: 'Workspace-relative or absolute image file path.',
            },
            alt: {
              type: 'string',
              description: 'Optional alt text, at most 160 characters.',
            },
          },
        },
      },
    },
  },
  output: genericOutput,
  timeoutMs: 30 * 60 * 1000,
  isConcurrencySafe: () => false,
  async execute(args, exec) {
    return runCli('create-bank', bankSpec(args), exec.signal);
  },
  presentCall: (args) => ({
    card: 'generic',
    title: 'Create official question bank',
    kind: 'other',
    rawInput: args,
  }),
};

const deleteTool = {
  name: 'official_delete',
  description:
    'Permanently delete one official question bank (題庫) or one collection (合集) and its stored images. Deleting a collection also deletes every question bank inside it. Call official_catalog first to confirm the ids, and only call this after the user explicitly confirms the deletion.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'pack_id', 'confirm'],
    properties: {
      kind: {
        type: 'string',
        enum: ['question_bank', 'collection'],
        description: 'What to delete.',
      },
      pack_id: {
        type: 'string',
        description: 'Collection id that owns the content.',
      },
      deck_id: {
        type: 'string',
        description: 'Question bank id. Required when kind is question_bank.',
      },
      confirm: {
        type: 'boolean',
        description: 'Must be true. Confirms the destructive deletion.',
      },
    },
  },
  output: genericOutput,
  timeoutMs: 5 * 60 * 1000,
  isConcurrencySafe: () => false,
  async execute(args, exec) {
    if (args.kind === 'collection') {
      return runCli(
        'delete-pack',
        { packId: args.pack_id, confirm: args.confirm },
        exec.signal,
      );
    }
    if (args.kind === 'question_bank') {
      if (!args.deck_id) throw new Error('deck_id is required when kind is question_bank.');
      return runCli(
        'delete-deck',
        { packId: args.pack_id, deckId: args.deck_id, confirm: args.confirm },
        exec.signal,
      );
    }
    throw new Error('kind must be question_bank or collection.');
  },
  presentCall: (args) => ({
    card: 'generic',
    title: 'Delete official content',
    kind: 'delete',
    rawInput: args,
  }),
};

const API_PREFIX = '/api/mengyin-official';
const MAX_API_BODY = 200_000;
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function sendJson(res, status, value) {
  if (res.writableEnded || res.destroyed) return;
  if (res.headersSent) {
    res.end();
    return;
  }
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

function readNodeBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_API_BODY) {
        fail(new Error('The request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', fail);
    req.on('aborted', () => fail(new Error('The request was aborted.')));
  });
}

async function parseNodeJson(req) {
  const text = await readNodeBody(req);
  let body;
  try {
    body = JSON.parse(text || '{}');
  } catch {
    throw new Error('The request body is not valid JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('The request body must be a JSON object.');
  }
  return body;
}

/**
 * Node handler for the management page. A resource route only answers GET and
 * HEAD, so the page's mutations use this handler seat and a loopback-only
 * check; the route is never reachable from another host on the network.
 */
async function officialHandler(req, res) {
  const remote = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '';
  if (remote && !LOOPBACK_ADDRESSES.has(remote)) {
    sendJson(res, 403, {
      ok: false,
      error: { message: 'Only the local owner can manage official content.' },
    });
    return;
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  req.on('aborted', abort);
  res.on('close', () => {
    if (!res.writableEnded) abort();
  });

  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const path = url.pathname.replace(/\/+$/, '');

    if (req.method === 'GET' && path === `${API_PREFIX}/catalog`) {
      const spec = { includeUnpublished: url.searchParams.get('includeUnpublished') === '1' };
      const packId = url.searchParams.get('packId');
      if (packId) spec.packId = packId;
      sendJson(res, 200, await runCli('list', spec, controller.signal));
      return;
    }

    if (req.method === 'POST' && path === `${API_PREFIX}/action`) {
      const body = await parseNodeJson(req);
      const spec =
        body.spec && typeof body.spec === 'object' && !Array.isArray(body.spec) ? body.spec : {};

      switch (body.action) {
        case 'catalog':
          sendJson(res, 200, await runCli('list', spec, controller.signal));
          return;
        case 'create-bank':
          sendJson(res, 200, await runCli('create-bank', spec, controller.signal));
          return;
        case 'create-pack':
          sendJson(res, 200, await runCli('create-pack', spec, controller.signal));
          return;
        case 'delete': {
          if (body.confirm !== true) throw new Error('confirm must be true.');
          if (body.kind === 'collection') {
            sendJson(
              res,
              200,
              await runCli('delete-pack', { packId: body.packId, confirm: true }, controller.signal),
            );
            return;
          }
          if (body.kind === 'question_bank') {
            sendJson(
              res,
              200,
              await runCli(
                'delete-deck',
                { packId: body.packId, deckId: body.deckId, confirm: true },
                controller.signal,
              ),
            );
            return;
          }
          throw new Error('kind must be collection or question_bank.');
        }
        default:
          throw new Error('Unknown action.');
      }
    }

    sendJson(res, 404, { ok: false, error: { message: 'Not found.' } });
  } catch (error) {
    sendJson(res, 400, {
      ok: false,
      error: { message: error instanceof Error ? error.message : String(error) },
    });
  } finally {
    req.removeListener('aborted', abort);
  }
}

export function apply(ctx) {
  if (!existsSync(cli)) {
    throw new Error(
      `MengYin Study official content: ${cli} was not found. Install this bundle from the MengYinStudy repository.`,
    );
  }
  for (const definition of [catalogTool, collectionCreateTool, bankCreateTool, deleteTool]) {
    ctx.effect(() => ctx.tools.register(definition));
  }

  const webServer = ctx.get('webServer');
  if (webServer) {
    ctx.effect(() =>
      webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: officialHandler,
      }),
    );
  }
}
