import type {
  AiDifficulty,
  AiImageMode,
  AiLanguage,
  AiProgress,
  AiQuestionType,
} from '@mengyin/ai-contract';
import { AI_QUESTION_TYPES } from '@mengyin/ai-contract';

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

/**
 * What the learner can choose. Provider keys and server defaults live on the
 * server; this object only records an explicit model choice and is safe in
 * IndexedDB.
 */
export interface AiSettings {
  /**
   * What to generate with: a catalogue model id, `'own'` for the learner's own
   * provider, or `''` when nothing has been chosen yet.
   */
  model: string;
  /** `off`, `auto` (only where a picture helps) or `on` (ask for one wherever it helps). */
  imageMode: AiImageMode;
  /** `auto` or an image model id advertised by /api/ai/config. */
  imageModel: string;
  /**
   * The learner's own provider key, when they chose to bring one.
   *
   * Stored in this browser only and sent with each generation request; using it
   * skips points and works on the free plan. It is never logged server-side.
   */
  apiKey?: string;
  /** OpenAI-compatible base URL for that provider, e.g. https://api.openai.com/v1. */
  apiBaseUrl?: string;
  /** Model id on that provider. Free text: it need not be in our catalogue. */
  apiModel?: string;
  /** Context window of that model, in tokens, as the learner reports it. */
  apiContextTokens?: number;
}

/** The picker value that means "use my own provider". */
export const AI_OWN_MODEL = 'own';

export type GeneratedDifficulty = AiDifficulty;
export type GeneratedLanguage = AiLanguage;
export type GeneratedQuestionType = AiQuestionType;

/** Canonical display and request order. */
export const ALL_GENERATED_TYPES: readonly GeneratedQuestionType[] = AI_QUESTION_TYPES;

export type GenerationProgress = AiProgress;

export interface GenerationRequest {
  topic: string;
  count: number;
  difficulty: GeneratedDifficulty;
  language: GeneratedLanguage;
  /** One or more types. If exactly one is selected, every question uses it. */
  types: GeneratedQuestionType[];
  /** Language used by generated code questions. Defaults to JavaScript. */
  codeLanguage?: import('@mengyin/core').CodeLanguage;
  /** Extra steer from the learner, e.g. "focus on chapter 4". */
  focus?: string;
  /** Free-form brief used when there is no material file, or as extra context. */
  description?: string;
}
