import { z } from 'zod';
import {
  CODE_BLANK,
  CODE_LANGUAGES,
  MAX_CODE_BLANKS,
  codeLanguageInfo,
  codeTemplateInfo,
  type AnswerKey,
  type Deck,
  type Question,
} from '@mengyin/core';

/** Bump only with a breaking change to the plugin contract. */
export const PLUGIN_SCHEMA_VERSION = 1;

export const rendererKindSchema = z.enum(['text', 'number', 'choice', 'multichoice']);
export type RendererKind = z.infer<typeof rendererKindSchema>;

const mediaSchema = z.object({
  type: z.literal('image'),
  src: z.string().min(1),
  alt: z.string().optional(),
});

const optionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  media: z.array(mediaSchema).optional(),
});

const answerKeySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('single'), optionId: z.string().min(1) }),
  z.object({ kind: z.literal('multi'), optionIds: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal('boolean'), value: z.boolean() }),
  z.object({
    kind: z.literal('fill'),
    accept: z.array(z.string().min(1)).min(1),
    ignoreCase: z.boolean().optional(),
    ignoreSpaces: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('short'),
    model: z.string().min(1),
    keywords: z.array(z.string()).optional(),
  }),
  z.object({ kind: z.literal('custom'), value: z.unknown() }),
]);

/** Question types that ship with the app and must agree with their answer key. */
const BUILTIN_TYPE_KIND: Record<string, AnswerKey['kind']> = {
  single: 'single',
  multi: 'multi',
  boolean: 'boolean',
  fill: 'fill',
  short: 'short',
  // Code questions keep the model solution in meta.code; the answer key is
  // carried as a custom value so the same question shape works everywhere.
  code: 'custom',
};

/**
 * The `meta.code` payload of a code question. One or more blanks, at least one
 * test, and a model snippet for every blank. JavaScript, TypeScript, Python and
 * SQL all run in the browser sandbox; no server-side execution is involved.
 */
export const codeTestSchema = z.object({
  name: z.string().min(1).optional(),
  setup: z.string().optional(),
  input: z.unknown().optional(),
  /** Text fed to stdin (Java/C++). */
  stdin: z.string().optional(),
  expect: z.string(),
});

export const codeBlankSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/, '空白名稱只可用英文字母、數字、底線和連字號'),
  label: z.string().min(1).optional(),
  placeholder: z.string().min(1).optional(),
});

const TEMPLATE_PROBLEM: Record<string, string> = {
  missing: `模板必須包含至少一個 ${CODE_BLANK} 或 {{blank:名稱}} 空白標記`,
  malformed: '空白標記格式錯誤；可用 {{blank}} 或 {{blank:名稱}}',
  mixed: '不可同時使用 {{blank}} 與 {{blank:名稱}}',
  'unnamed-multiple': '多個空白必須命名，例如 {{blank:init}}、{{blank:cond}}、{{blank:step}}',
  duplicate: '空白名稱不可重複',
  'too-many': `空白數量不可超過 ${MAX_CODE_BLANKS} 個`,
};

export const codeSpecSchema = z
  .object({
    language: z.enum(CODE_LANGUAGES).default('javascript'),
    template: z.string().min(1),
    /** `body` gives the learner a large editor for a whole function body. */
    layout: z.enum(['inline', 'body']).optional(),
    /** Legacy label for a single unnamed blank. */
    blankLabel: z.string().min(1).optional(),
    blanks: z.array(codeBlankSchema).max(MAX_CODE_BLANKS).optional(),
    /** Model snippet for a single blank. */
    solution: z.string().min(1).optional(),
    /** Model snippets keyed by blank id; required when there is more than one. */
    solutions: z.record(z.string(), z.string().min(1)).optional(),
    tests: z.array(codeTestSchema).min(1).max(20),
    timeoutMs: z.number().int().min(500).max(10_000).optional(),
  })
  .superRefine((value, ctx) => {
    const info = codeTemplateInfo(value.template);
    if (info.problem) {
      ctx.addIssue({
        code: 'custom',
        path: ['template'],
        message: TEMPLATE_PROBLEM[info.problem] ?? '程式碼模板的空白標記無效',
      });
      return;
    }
    if (value.layout === 'body' && info.ids.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['layout'],
        message: 'body 模式只能有一個空白（整個函式本體）',
      });
    }
    if (value.blanks) {
      const seen = new Set<string>();
      value.blanks.forEach((blank, index) => {
        if (!info.ids.includes(blank.id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['blanks', index, 'id'],
            message: `空白 "${blank.id}" 不存在於 template`,
          });
        }
        if (seen.has(blank.id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['blanks', index, 'id'],
            message: `空白 "${blank.id}" 的設定重複`,
          });
        }
        seen.add(blank.id);
      });
    }
    for (const id of info.ids) {
      const solution =
        value.solutions?.[id] ?? (info.ids.length === 1 ? value.solution : undefined);
      if (!solution || !solution.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: info.ids.length === 1 ? ['solution'] : ['solutions', id],
          message: `缺少空白 "${id}" 的參考答案`,
        });
      }
    }
    const inputMode = codeLanguageInfo(value.language).input;
    if (inputMode === 'sql') {
      value.tests.forEach((test, index) => {
        if (test.input !== undefined && typeof test.input !== 'string') {
          ctx.addIssue({
            code: 'custom',
            path: ['tests', index, 'input'],
            message: 'SQL 題的 input 必須是 SQL 字串（建表與插入資料），不能是 JSON 值',
          });
        }
      });
    } else if (inputMode === 'stdin') {
      value.tests.forEach((test, index) => {
        if (test.input !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['tests', index, 'input'],
            message: 'Java/C++ 題使用 tests[].stdin 字串作為標準輸入，不要使用 input',
          });
        }
      });
    }
  });

export type CodeSpecFile = z.infer<typeof codeSpecSchema>;

export const questionSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1).default('single'),
    prompt: z.string().min(1),
    options: z.array(optionSchema).optional(),
    answer: answerKeySchema,
    explanation: z.string().optional(),
    hint: z.string().optional(),
    tags: z.array(z.string()).default([]),
    difficulty: z.number().int().min(1).max(5).default(2),
    points: z.number().positive().optional(),
    source: z.string().optional(),
    media: z
      .array(z.object({ type: z.literal('image'), src: z.string().min(1), alt: z.string().optional() }))
      .optional(),
    /** Plugin specific payload, e.g. numeric tolerance. */
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((question, ctx) => {
    const expected = BUILTIN_TYPE_KIND[question.type];
    if (expected && expected !== question.answer.kind) {
      ctx.addIssue({
        code: 'custom',
        path: ['answer', 'kind'],
        message: `題型 "${question.type}" 需要 answer.kind = "${expected}"，實際為 "${question.answer.kind}"`,
      });
    }
    if (question.answer.kind === 'single' || question.answer.kind === 'multi') {
      if (!question.options || question.options.length < 2) {
        ctx.addIssue({ code: 'custom', path: ['options'], message: '選擇題需要至少兩個選項' });
        return;
      }
      const ids = new Set(question.options.map((option) => option.id));
      if (new Set(question.options.map((o) => o.id)).size !== question.options.length) {
        ctx.addIssue({ code: 'custom', path: ['options'], message: '選項 id 不可重複' });
      }
      const wanted = question.answer.kind === 'single' ? [question.answer.optionId] : question.answer.optionIds;
      for (const id of wanted) {
        if (!ids.has(id)) {
          ctx.addIssue({ code: 'custom', path: ['answer'], message: `答案選項 "${id}" 不存在於 options` });
        }
      }
    }
    if (question.type === 'boolean' && question.options && question.options.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: '是非題不需要 options' });
    }
    if (question.type === 'code') {
      const rawCode = (question.meta as Record<string, unknown> | undefined)?.code;
      const parsed = codeSpecSchema.safeParse(rawCode);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          ctx.addIssue({
            code: 'custom',
            path: ['meta', 'code', ...issue.path],
            message: `code 題型格式錯誤：${issue.message}`,
          });
        }
      }
    }
  });

export const deckFileSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  questions: z.array(questionSchema).min(1),
  /**
   * Whole-paper exam length. Official decks publish it; generated decks set it
   * from the model's per-question estimates. Omitted means the app estimates.
   */
  examMinutes: z.number().int().min(1).max(600).optional(),
});

export const manifestSchema = z.object({
  schemaVersion: z.number().int().min(1).max(PLUGIN_SCHEMA_VERSION).default(PLUGIN_SCHEMA_VERSION),
  id: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/, '插件 id 只可使用英文字母、數字、點、底線和連字號'),
  name: z.string().min(1).max(80),
  version: z.string().min(1),
  description: z.string().optional(),
  author: z.string().optional(),
  homepage: z.string().optional(),
  license: z.string().optional(),
  tags: z.array(z.string()).default([]),
  /** Deck files, relative to the plugin folder. */
  content: z.array(z.string()).default([]),
  /** Optional ES module loaded at runtime for code-level extensions. */
  entry: z.string().optional(),
  questionTypes: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        rendererKind: rendererKindSchema,
        description: z.string().optional(),
      }),
    )
    .default([]),
  minAppVersion: z.string().optional(),
});

export type PluginManifest = z.infer<typeof manifestSchema>;
export type DeckFile = z.infer<typeof deckFileSchema>;
export type QuestionFile = z.infer<typeof questionSchema>;

export interface Issue {
  path: string;
  message: string;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

function toIssues(error: z.ZodError): Issue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(根)',
    message: issue.message,
  }));
}

export function parseManifest(raw: unknown): ParseResult<PluginManifest> {
  const result = manifestSchema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, issues: toIssues(result.error) };
}

export function parseDeckFile(raw: unknown): ParseResult<DeckFile> {
  const result = deckFileSchema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, issues: toIssues(result.error) };
}

function uniqueTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

/**
 * Plugin-relative image paths (`./assets/x.png`) are resolved against the
 * plugin folder so decks can ship their own pictures.
 */
function resolveSrc(src: string, assetBase?: string): string {
  if (!assetBase) return src;
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(src)) return src;
  if (/^(?:data|blob|file):/i.test(src)) return src;
  if (src.startsWith('/')) return src;
  try {
    return new URL(src.replace(/^\.\//, ''), assetBase).href;
  } catch {
    return `${assetBase.replace(/\/?$/, '/')}${src.replace(/^\.\//, '')}`;
  }
}

type RawMedia = { type: 'image'; src: string; alt?: string };

function resolveMedia(media: readonly RawMedia[] | undefined, assetBase?: string) {
  if (!media) return undefined;
  return media.map((item) => ({ ...item, src: resolveSrc(item.src, assetBase) }));
}

export function adaptQuestion(raw: QuestionFile, assetBase?: string): Question {
  return {
    id: raw.id,
    type: raw.type,
    prompt: raw.prompt,
    ...(raw.options
      ? {
          options: raw.options.map((option) => ({
            id: option.id,
            text: option.text,
            ...(option.media ? { media: resolveMedia(option.media, assetBase) } : {}),
          })),
        }
      : {}),
    answer: raw.answer as AnswerKey,
    ...(raw.explanation ? { explanation: raw.explanation } : {}),
    ...(raw.hint ? { hint: raw.hint } : {}),
    tags: uniqueTags(raw.tags),
    difficulty: raw.difficulty,
    ...(raw.points ? { points: raw.points } : {}),
    ...(raw.source ? { source: raw.source } : {}),
    ...(raw.media ? { media: resolveMedia(raw.media, assetBase) } : {}),
    ...(raw.meta ? { meta: raw.meta } : {}),
  };
}

export function adaptDeck(pluginId: string, raw: DeckFile, assetBase?: string): Deck {
  return {
    key: `${pluginId}::${raw.id}`,
    id: raw.id,
    pluginId,
    title: raw.title,
    ...(raw.description ? { description: raw.description } : {}),
    tags: uniqueTags(raw.tags),
    questions: raw.questions.map((question) => adaptQuestion(question, assetBase)),
    ...(raw.examMinutes === undefined ? {} : { examMinutes: raw.examMinutes }),
  };
}

export function formatIssues(issues: readonly Issue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join('；');
}
