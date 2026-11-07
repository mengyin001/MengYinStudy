/** Server-side request/response types for the generation pipeline. */
import type {
  AiDifficulty,
  AiImageMode,
  AiLanguage,
  AiQuestionType,
  AiUsage,
  AiWarning,
} from '@mengyin/ai-contract';
import type { CodeLanguage, Deck } from '@mengyin/core';

export interface AiMaterial {
  id: string;
  name: string;
  chars: number;
  text: string;
}

export interface GenerationRequest {
  topic: string;
  count: number;
  difficulty: AiDifficulty;
  language: AiLanguage;
  types: AiQuestionType[];
  codeLanguage?: CodeLanguage;
  focus?: string;
  description?: string;
  /** Whether the model should suggest illustrations for this request. */
  imageMode: AiImageMode;
}

export interface GenerateOptions {
  signal?: AbortSignal;
  /** False when the server has no image provider: skip the planning call. */
  imagesAvailable?: boolean;
  /** True when web image search can serve real-reference scene photos. */
  webImagesAvailable?: boolean;
  onProgress?: (progress: {
    stage:
      | 'preparing'
      | 'requesting'
      | 'repairing'
      | 'splitting'
      | 'validating'
      | 'planning'
      | 'done';
    batch: number;
    batches: number;
    message: string;
  }) => void;
}

export interface QuestionImageRequest {
  questionId: string;
  prompt: string;
  /** Internal query for a real reference photo; never shown to the learner. */
  search?: string;
  /** A real reference is mandatory; never replace a failed search with a guess. */
  searchOnly?: boolean;
  alt?: string;
}

export interface GenerateResult {
  deck: Deck;
  warnings: AiWarning[];
  usage: AiUsage;
  rawQuestions: number;
  /** Photo briefs that still need the image model. */
  imageRequests: QuestionImageRequest[];
  /** Figures already attached to the deck; they cost no image generation. */
  diagramCount: number;
}

export const ZERO_USAGE: AiUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
