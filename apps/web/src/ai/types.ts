import type { CodeLanguage } from '@mengyin/core';

/** Persistent AI provider configuration. Kept out of progress backups. */
export interface AiConfig {
  /** OpenAI-compatible base URL, e.g. https://api.openai.com/v1 */
  baseUrl: string;
  /** Bearer token. Local servers may leave this empty. */
  apiKey: string;
  model: string;
  /** 0–2. */
  temperature: number;
  /** Send response_format: { type: "json_object" } when the provider supports it. */
  jsonMode: boolean;
  maxTokens: number;
  timeoutMs: number;
}

export type MaterialKind = 'text' | 'pdf' | 'docx' | 'pptx';

export interface AiMaterial {
  id: string;
  name: string;
  /** Original file size in bytes, used for the 1 GB budget. */
  size: number;
  kind: MaterialKind;
  chars: number;
  /** Extraction hit the per-material character cap. */
  truncated: boolean;
  addedAt: number;
  text: string;
}

export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type GeneratedDifficulty = 'mixed' | 'easy' | 'hard';
export type GeneratedLanguage = 'auto' | 'en' | 'zh-Hant';
export type GeneratedQuestionType = 'single' | 'multi' | 'boolean' | 'fill' | 'short' | 'code';

/** Canonical display and request order. */
export const ALL_GENERATED_TYPES: GeneratedQuestionType[] = [
  'single',
  'multi',
  'boolean',
  'fill',
  'short',
  'code',
];

export interface GenerationRequest {
  topic: string;
  count: number;
  difficulty: GeneratedDifficulty;
  language: GeneratedLanguage;
  /** One or more types. If exactly one is selected, every question uses it. */
  types: GeneratedQuestionType[];
  /** Language used by generated code questions. Defaults to JavaScript. */
  codeLanguage?: CodeLanguage;
  /** Extra steer from the learner, e.g. "focus on chapter 4". */
  focus?: string;
  /** Free-form brief used when there is no material file, or as extra context. */
  description?: string;
}

export interface GenerationProgress {
  stage: 'preparing' | 'requesting' | 'repairing' | 'splitting' | 'validating' | 'done';
  batch: number;
  batches: number;
  message: string;
}

export interface GenerationWarning {
  code: string;
  message: string;
}
