/**
 * Wire contract for the hosted MengYin AI question service.
 *
 * This package is types and constants only. The authoring prompt, provider
 * keys and generation pipeline live on the server (`apps/api`), so the
 * browser bundle never contains the skill or a provider secret.
 */
import type { CodeLanguage, Deck } from '@mengyin/core';

/** Base path of the API. Absolute in the desktop shell via VITE_AI_API_BASE. */
export const AI_API_BASE = '/api/ai';

export const AI_ROUTES = {
  config: '/config',
  health: '/health',
  test: '/test',
  questions: '/questions',
  images: '/images',
} as const;

/** Free Workers AI text-to-image model used for the first release. */
export const AI_DEFAULT_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

export interface AiLimits {
  maxQuestions: number;
  maxImagesPerDeck: number;
  maxMaterials: number;
  maxMaterialChars: number;
  maxMaterialCharsEach: number;
  maxRequestBytes: number;
  maxImagePromptChars: number;
}

export const AI_LIMITS: AiLimits = {
  /** 0 means no application-level count ceiling. */
  maxQuestions: 0,
  /** 0 means no application-level image ceiling; one picture per question. */
  maxImagesPerDeck: 0,
  maxMaterials: 8,
  maxMaterialChars: 400_000,
  maxMaterialCharsEach: 200_000,
  maxRequestBytes: 1_500_000,
  maxImagePromptChars: 600,
};

export type AiImageMode = 'off' | 'auto' | 'on';
export const AI_IMAGE_MODES: readonly AiImageMode[] = ['off', 'auto', 'on'];

export type AiDifficulty = 'mixed' | 'easy' | 'hard';
export type AiLanguage = 'auto' | 'en' | 'zh-Hant';
export type AiQuestionType = 'single' | 'multi' | 'boolean' | 'fill' | 'short' | 'code';

export const AI_QUESTION_TYPES: readonly AiQuestionType[] = [
  'single',
  'multi',
  'boolean',
  'fill',
  'short',
  'code',
];

export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiWarning {
  code: string;
  message: string;
}

/** One selectable model for a provider. */
export interface AiProviderInfo {
  id: string;
  label: string;
  models: string[];
  /** The server holds a key for this provider (or it is the demo provider). */
  configured: boolean;
  /** The demo provider answers without calling a real model. */
  demo: boolean;
  /** Local-only provider served by the API, e.g. Ollama on the same host. */
  local?: boolean;
  /** A vision model is configured, so generated photos can be checked. */
  vision?: boolean;
}

/** One text-to-image model the server can use. */
export interface AiImageModelInfo {
  id: string;
  label: string;
}

export interface AiImageCapability {
  available: boolean;
  /** Default model, or null when images are disabled. */
  model: string | null;
  /** Selectable models; the UI offers "auto" plus this list. */
  models: AiImageModelInfo[];
  /** Technical ceiling for one request; there is no deck-wide total. */
  maxPerRequest: number;
  /** Real-reference photo search, when the server has a provider. */
  search?: { available: boolean; provider: string | null };
}

export interface AiServiceConfig {
  providers: AiProviderInfo[];
  images: AiImageCapability;
  limits: AiLimits;
  /** True when the API rejects anonymous generation requests. */
  authRequired: boolean;
  /**
   * SPKI base64 of the ECDSA P-256 key that signs generated photos. The app
   * verifies an image against it before upload and before display, so a
   * modified object is rejected. Null when attestation is not configured.
   */
  imageVerifyKey: string | null;
}

export interface AiHealth {
  ok: true;
  service: 'mengyin-ai';
  version: string;
  providersConfigured: number;
  imagesAvailable: boolean;
  time: string;
}

export interface AiMaterialInput {
  name: string;
  text: string;
}

export interface AiQuestionRequest {
  topic: string;
  count: number;
  difficulty: AiDifficulty;
  language: AiLanguage;
  types: AiQuestionType[];
  codeLanguage?: CodeLanguage;
  focus?: string;
  description?: string;
  /** Extracted text. The client sends a bounded, topic-ranked selection. */
  materials?: AiMaterialInput[];
  /** Provider id. Deprecated: the server derives it from `model`. */
  provider?: string;
  /** Required model id from /config. There is no server-side fallback. */
  model: string;
  imageMode?: AiImageMode;
  /** Image model id from /config. Omit or use "auto" for the server default. */
  imageModel?: string;
  /** Upper bound on generated photos; diagrams are free and not counted. */
  imageMax?: number;
  /**
   * The learner's own provider key. When sent, the server uses it for this one
   * request instead of its own key and charges no points; the key is never
   * stored server-side. A free plan may use it to generate at its own cost.
   */
  apiKey?: string;
  /**
   * OpenAI-compatible base URL for the learner's own provider. With a key it
   * lets any compatible model id through, not just the ones this server sells.
   */
  apiBaseUrl?: string;
  /**
   * The learner's statement of that model's context window in tokens. The
   * server uses it to keep the completion budget inside the window.
   */
  apiContextTokens?: number;
}

export type AiProgressStage =
  | 'preparing'
  | 'requesting'
  | 'repairing'
  | 'splitting'
  | 'validating'
  | 'planning'
  | 'illustrating'
  | 'done';

export interface AiProgress {
  stage: AiProgressStage;
  batch: number;
  batches: number;
  message: string;
}

export interface AiEngineInfo {
  provider: string;
  providerLabel: string;
  model: string;
}

export interface AiImageStats {
  /** Photo briefs sent to the image model or web image search. */
  requested: number;
  generated: number;
  /** Of `generated`, how many came from web image search. */
  searched?: number;
  failed: number;
  /** Figures drawn by the app from a spec; these need no image model. */
  diagrams: number;
}

export interface AiQuestionResult {
  deck: Deck;
  warnings: AiWarning[];
  usage: AiUsage;
  engine: AiEngineInfo;
  images: AiImageStats;
}

export interface AiImageRequest {
  prompt: string;
  alt?: string;
  provider?: string;
  model?: string;
}

export interface AiImageResult {
  image: string;
  alt?: string;
  model: string;
  /** SHA-256 of the image bytes, when the server attests them. */
  digest?: string;
  /** Base64url ECDSA P-256 signature over `mengyin-image:v1:<digest>`. */
  signature?: string;
}

export interface AiTestRequest {
  provider?: string;
  model?: string;
  /** The learner's own provider key, used for this test only. */
  apiKey?: string;
  /** OpenAI-compatible base URL for the learner's own provider. */
  apiBaseUrl?: string;
}

export interface AiTestResult {
  ok: true;
  provider: string;
  providerLabel: string;
  model: string;
  latencyMs: number;
}

export type AiErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'ai_unconfigured'
  | 'provider_auth'
  | 'provider_rate'
  | 'provider_error'
  | 'provider_timeout'
  | 'images_unavailable'
  | 'image_failed'
  | 'payload_too_large'
  | 'server_error';

export interface AiErrorBody {
  error: {
    code: AiErrorCode;
    message: string;
    requestId?: string;
  };
}

export interface AiStreamProgressEvent {
  event: 'progress';
  data: AiProgress;
}

export interface AiStreamResultEvent {
  event: 'result';
  data: AiQuestionResult;
}

export interface AiStreamErrorEvent {
  event: 'error';
  data: AiErrorBody;
}

export type AiStreamEvent = AiStreamProgressEvent | AiStreamResultEvent | AiStreamErrorEvent;
