/**
 * Request validation. The API is public to signed-in accounts, so every field
 * is bounded before it reaches a provider or a prompt.
 */
import {
  AI_LIMITS,
  AI_QUESTION_TYPES,
  type AiDifficulty,
  type AiImageMode,
  type AiLanguage,
  type AiQuestionType,
} from '@mengyin/ai-contract';
import { CODE_LANGUAGES, type CodeLanguage } from '@mengyin/core';
import type { AiMaterial } from '../generation/types';
import { badRequest } from '../errors';

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL_CHARS, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

function optionalText(value: unknown, max: number): string | undefined {
  const cleaned = text(value, max);
  return cleaned ? cleaned : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export interface NormalizedQuestionRequest {
  topic: string;
  count: number;
  difficulty: AiDifficulty;
  language: AiLanguage;
  types: AiQuestionType[];
  codeLanguage: CodeLanguage;
  focus?: string;
  description?: string;
  materials: AiMaterial[];
  /** Deprecated: the client sends the model only; the server infers provider. */
  provider?: string;
  /** Required. There is no server-side or provider-side fallback. */
  model: string;
  imageMode: AiImageMode;
  imageModel?: string;
  imageMax?: number;
}

export function parseQuestionRequest(value: unknown): NormalizedQuestionRequest {
  const body = record(value);
  if (!body) throw badRequest('The request body must be a JSON object.');
  const description = optionalText(body.description, 20_000);
  const topic =
    text(body.topic, 200) ||
    (description ?? '')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean)
      ?.slice(0, 80) ||
    '';
  if (!topic) throw badRequest('Add a topic or a description.');

  const rawCount = body.count === undefined ? 10 : Number(body.count);
  // No product-level count cap. The storage budget and the model's time are the
  // real constraints; only a non-positive/non-integer value is invalid.
  if (!Number.isSafeInteger(rawCount) || rawCount < 1) {
    throw badRequest('count must be a positive whole number.');
  }

  if (body.types !== undefined && !Array.isArray(body.types)) {
    throw badRequest('types must be an array.');
  }
  const requestedTypes = Array.isArray(body.types)
    ? body.types.filter((item): item is string => typeof item === 'string')
    : [...AI_QUESTION_TYPES];
  const types = AI_QUESTION_TYPES.filter((type) => requestedTypes.includes(type));
  if (types.length === 0) throw badRequest('Choose at least one question type.');

  const codeLanguage = oneOf(body.codeLanguage, CODE_LANGUAGES, 'javascript');
  const imageMode = oneOf<AiImageMode>(body.imageMode, ['off', 'auto', 'on'], 'auto');

  // Every generation names its model. Falling back to a server default made
  // the actual model unpredictable and let a stale client spend more points
  // than the UI showed.
  const model = optionalText(body.model, 100);
  if (!model || model === 'auto') {
    throw badRequest('Choose a model for this generation.');
  }
  // The deck has no separate image quota; one picture per question is the
  // natural ceiling. Storage (30 MB per account, including text) is the budget.
  const rawImageMax = body.imageMax === undefined ? undefined : Number(body.imageMax);
  if (rawImageMax !== undefined && (!Number.isInteger(rawImageMax) || rawImageMax < 0)) {
    throw badRequest('imageMax must be a non-negative whole number.');
  }

  if (body.materials !== undefined && !Array.isArray(body.materials)) {
    throw badRequest('materials must be an array.');
  }
  const rawMaterials = Array.isArray(body.materials) ? body.materials : [];
  if (rawMaterials.length > AI_LIMITS.maxMaterials) {
    throw badRequest(`At most ${AI_LIMITS.maxMaterials} materials can be sent in one request.`);
  }
  const materials: AiMaterial[] = [];
  let totalChars = 0;
  rawMaterials.forEach((item, index) => {
    const material = record(item);
    if (!material) throw badRequest(`materials[${index}] must be an object.`);
    const name = text(material.name, 200) || `Material ${index + 1}`;
    const bodyText = text(material.text, AI_LIMITS.maxMaterialCharsEach);
    if (!bodyText) return;
    if (typeof material.text === 'string' && material.text.length > AI_LIMITS.maxMaterialCharsEach) {
      throw badRequest(
        `${name} is longer than the ${AI_LIMITS.maxMaterialCharsEach.toLocaleString()} character limit per material.`,
      );
    }
    totalChars += bodyText.length;
    if (totalChars > AI_LIMITS.maxMaterialChars) {
      throw badRequest(
        `The material text is too large. Send at most ${AI_LIMITS.maxMaterialChars.toLocaleString()} characters in one request.`,
      );
    }
    materials.push({ id: `m${index + 1}`, name, chars: bodyText.length, text: bodyText });
  });

  return {
    topic,
    count: rawCount,
    difficulty: oneOf<AiDifficulty>(body.difficulty, ['mixed', 'easy', 'hard'], 'mixed'),
    language: oneOf<AiLanguage>(body.language, ['auto', 'en', 'zh-Hant'], 'auto'),
    types,
    codeLanguage,
    ...(optionalText(body.focus, 500) ? { focus: optionalText(body.focus, 500) } : {}),
    ...(description ? { description } : {}),
    materials,
    ...(optionalText(body.provider, 100) && optionalText(body.provider, 100) !== 'auto'
      ? { provider: optionalText(body.provider, 100) }
      : {}),
    model,
    imageMode,
    ...(optionalText(body.imageModel, 200) && optionalText(body.imageModel, 200) !== 'auto'
      ? { imageModel: optionalText(body.imageModel, 200) }
      : {}),
    ...(rawImageMax === undefined ? {} : { imageMax: rawImageMax }),
  };
}

export interface NormalizedImageRequest {
  prompt: string;
  alt?: string;
  model?: string;
}

export function parseImageRequest(value: unknown): NormalizedImageRequest {
  const body = record(value);
  if (!body) throw badRequest('The request body must be a JSON object.');
  const prompt = text(body.prompt, AI_LIMITS.maxImagePromptChars);
  if (!prompt) throw badRequest('prompt is required.');
  if (typeof body.prompt === 'string' && body.prompt.length > AI_LIMITS.maxImagePromptChars) {
    throw badRequest(`prompt must be at most ${AI_LIMITS.maxImagePromptChars} characters.`);
  }
  const alt = optionalText(body.alt, 160);
  const model = optionalText(body.model, 200);
  return {
    prompt,
    ...(alt ? { alt } : {}),
    ...(model && model !== 'auto' ? { model } : {}),
  };
}
