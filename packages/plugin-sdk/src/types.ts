import type { GradeResult, Question } from '@mengyin/core';
import type { PluginManifest, RendererKind } from './schema';

/**
 * A question type contributed by a plugin. The host renders the answer input
 * (`rendererKind`) and calls `check` to grade it, so plugins stay free of React.
 */
export interface QuestionTypeRuntime {
  id: string;
  label: string;
  rendererKind: RendererKind;
  description?: string;
  /** Initial answer value for the renderer. */
  defaultAnswer?(): unknown;
  /** Human readable correct answer, shown in the feedback panel. */
  describeAnswer?(question: Question): string;
  check(question: Question, value: unknown): GradeResult | null;
}

/** Turns an external file (CSV, Anki export, …) into deck JSON. */
export interface ImporterRuntime {
  id: string;
  label: string;
  description?: string;
  accept: string[];
  /** Return one or more deck objects; the host validates them. */
  parse(text: string, fileName?: string): unknown;
}

export interface PluginKV {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface PluginContext {
  manifest: PluginManifest;
  registerQuestionType(definition: QuestionTypeRuntime): void;
  registerImporter(definition: ImporterRuntime): void;
  log(...args: unknown[]): void;
  kv: PluginKV;
}

export interface PluginModule {
  activate?(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void;
}

/** Identity helper so plugin authors get completion + type checking. */
export function definePlugin(module: PluginModule): PluginModule {
  return module;
}
