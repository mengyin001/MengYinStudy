/**
 * Second-pass visual planning.
 *
 * The author writes questions, and the visual it attaches to a question it is
 * still composing is often a description of the topic rather than of the
 * situation. This pass sees the finished question, its options, its answer and
 * its explanation, and does one of two jobs:
 *
 * - `photo`: rewrite the author's hint into a concrete image brief.
 * - `choose`: the question has no visual yet, so pick a diagram spec or a
 *   photo brief. This is how `auto` gets a real decision instead of depending
 *   on whether the author model volunteered a `visual` field.
 *
 * Diagrams written by the author are used as-is: they are exact data, and a
 * second rewrite would only risk turning a correct plot into a wrong one.
 *
 * The pass is best-effort. A failed call never fails the deck; the caller keeps
 * the author's hint (or no visual) and records a warning.
 */
import type { AiImageMode, AiLanguage, AiUsage } from '@mengyin/ai-contract';
import type { Question } from '@mengyin/core';
import { AiError, parseJsonLoose, type ChatMessage, type ChatModel } from '../providers/chat';
import { FIGURE_SKILL } from './figure-skill';
import { ZERO_USAGE } from './types';
import { briefSubject } from './illustration-brief';
import { readVisual, type VisualPlan } from './visual';

export const VISUAL_PLAN_VERSION = '2.0.0';
/** Questions per call. Specs are large, so fewer than the old brief pass. */
export const VISUALS_PER_CALL = 5;

export const VISUAL_PLAN_SKILL = String.raw`You plan one illustration per practice question. The question already exists; you receive its prompt, options, answer, explanation and a deterministic "intent" from the figure registry. Decide what picture the learner should see, and for a diagram write the exact spec the app will draw.

## Rules

1. Reply with ONE JSON object and nothing else. No prose, no markdown fences.
2. Judge each question on its own. A picture is worth adding only when it helps the learner picture the situation, a structure, a graph, a spatial relationship or a real scene. On a visual subject (mathematics, physics, chemistry, biology, geography, engineering, computer science), do not skip every question: roughly one in three is a sensible target. On verbal or definition-heavy material it is fine to skip all of them.
3. Never draw the correct answer, the option letters, the option values, a caption, a watermark or a logo. The "answer" field is given so you can avoid depicting it. One exception: when the learner must identify what is shown ("guess the country", "which organelle is this?", "what curve is this?"), the picture is the clue and may depict the subject; it still must not contain text that names the answer.
4. The question must stay answerable from its text alone. The picture supports it, except for a clue question where the picture is the thing to identify.
5. "alt" is one short sentence in the question's language describing the picture. For a clue question it must stay neutral: never name the answer in "alt".
6. Write a photo brief in one or two concrete English sentences: name the objects, how many there are, how they are placed, the direction of any arrows or motion, and any state (full/empty, hot/cold, before/after). The image model cannot render words, letters or numbers, so never ask it to; and never ask for a caption, a watermark, a logo, UI or a real person's face. Add an optional "search" query when a real reference photo would be better than generation: a short English phrase naming the place, object or scene. "search" is internal and may name the answer; "alt" is shown to the learner and must not.
7. Never request sexual content, non-consensual intimate imagery, or content that harasses or degrades anyone.
8. Skip a question whose subject is the symbol language itself: "which shape means process?", "what does a diamond represent?", "which symbol is used for input/output?". A picture would either be the answer or a decorative row of boxes. Also skip definitions, quotations and arithmetic. The question must need a picture, not merely mention a visual topic.

${FIGURE_SKILL}

## Follow the registered intent

Each question carries "intent": {id, family, tier, renderer, preferred, label}. It is a deterministic first guess, not a suggestion to ignore.

- "tier": "scene" means the learner needs a real place, person, organism, object or historical scene. Return kind "photo". Never return a diagram for a scene: a maths diagram of a country is not a picture of that country.
- "tier": "exact" or "structural" means the picture must be precise. Return kind "diagram". Never return a photo for a chart, geometry, circuit, free-body diagram, flow chart or table: a diffusion model cannot keep the labels and values correct.
- "preferred": "none" means the app has no renderer for that kind. Return "skip": true instead of faking it with unrelated boxes and lines.
- Use the compound element that matches the figure: "chart" for data, "graph" for nodes and edges (including UML, ER, architecture, pedigree, food web and mind map), "map" for a schematic map or cross-section, "circuit", "molecule", "music", "timeline", "apparatus", "surface3d", "code" or "formula". Do not write a UML class model or an ER diagram as a flowchart: use graph nodes with shape "class" or "entity". Mermaid remains the best form for a plain process or decision flow.
- If the intent is missing or clearly wrong, use the question. A chart, table, graph or process is a diagram; a real scene is a photo.

A diagram can carry exact values, labels and geometry; a photo prompt cannot. Use "diagram" for functions, graphs, coordinate planes, geometry, free-body diagrams, trees, flow charts, tables and bar charts. Use "photo" only for a realistic real-world scene. For a process or decision flow, write Mermaid and let the app lay it out; never hand-place flowchart nodes.

## Output shape

{"images":[
  {"id":"q1","kind":"diagram","spec":{...},"alt":"..."},
  {"id":"q2","kind":"diagram","mermaid":"flowchart TD\n  A([開始]) --> B[處理]\n  B --> C([結束])","alt":"..."},
  {"id":"q3","kind":"photo","prompt":"...","search":"Eiffel Tower Paris","alt":"..."},
  {"id":"q4","skip":true}
]}

Include every id you were given exactly once. Use "skip": true only when no picture would help, the registered kind has no faithful renderer, or every picture would mislead.`;

export interface VisualRequest {
  question: Question;
  /** `photo` rewrites a hint; `choose` has no visual yet. */
  want: 'photo' | 'choose';
  /** The author's photo hint, for `want: 'photo'`. */
  hint?: string;
  /** Deterministic first guess from the figure registry. */
  intent?: Record<string, string>;
}

export interface VisualContext {
  topic: string;
  language: AiLanguage;
  mode: AiImageMode;
  photosAvailable: boolean;
  webImagesAvailable: boolean;
}

function languageName(language: AiLanguage): string {
  if (language === 'en') return 'English';
  if (language === 'zh-Hant') return 'Traditional Chinese';
  return 'the language of the question';
}

function requestSubject(request: VisualRequest): Record<string, unknown> {
  return {
    ...briefSubject(request.question),
    want: request.want,
    ...(request.intent ? { intent: request.intent } : {}),
    ...(request.hint ? { authorHint: request.hint } : {}),
  };
}

export function buildPlanMessages(requests: readonly VisualRequest[], context: VisualContext): ChatMessage[] {
  const lines = [
    `Topic: ${context.topic}`,
    `Question language: ${languageName(context.language)}`,
    context.mode === 'on'
      ? 'The learner asked for a visual on every question. Give each id a visual; skip only when a picture would mislead.'
      : 'Auto mode: add a visual where it genuinely helps and skip the rest. On visual subjects, a rough target is one in three questions, not zero.',
    context.photosAvailable
      ? context.webImagesAvailable
        ? 'Photo generation AND web image search are available. Use "search" for a real place, object, organism or historical scene; use "prompt" alone for a scene the image model should draw.'
        : 'Photo generation is available, but a diagram is still the better choice for anything exact.'
      : context.webImagesAvailable
        ? 'Photo generation is NOT available, but web image search is: a scene visual must be kind "photo" with a short English "search" query; exact content must still be a diagram.'
        : 'Photo generation is NOT available on this server: every visual you return must be a diagram.',
    '"want":"photo" means rewrite the authorHint into a concrete English brief and return kind "photo". Add "search" when a real photo is better.',
    '"want":"choose" means this question has no visual yet: return kind "diagram" or kind "photo".',
    'The "intent" field is the deterministic first guess from the figure registry. If tier is "scene", return photo; if tier is "exact" or "structural", return diagram; if preferred is "none", skip.',
    'Each question below already exists. Return one entry per id.',
    '<questions>',
    JSON.stringify(requests.map(requestSubject)),
    '</questions>',
  ];
  return [
    { role: 'system', content: VISUAL_PLAN_SKILL },
    { role: 'user', content: lines.filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n') },
  ];
}

function entriesOf(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return [];
  const object = parsed as Record<string, unknown>;
  const images = object.images ?? object.visuals;
  if (Array.isArray(images)) return images;
  if (images && typeof images === 'object') {
    return Object.entries(images as Record<string, unknown>).map(([id, value]) => ({
      ...(value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}),
      id,
    }));
  }
  return [];
}

/**
 * Read a planner reply into `id -> plan`, where `null` is an explicit skip.
 * Unknown ids are ignored, so a hallucinated id cannot attach a picture to a
 * question that never asked for one.
 */
export function parseVisualPlanReply(
  text: string,
  ids: ReadonlySet<string>,
): Map<string, VisualPlan | null> {
  const plans = new Map<string, VisualPlan | null>();
  for (const entry of entriesOf(parseJsonLoose(text))) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id.trim().slice(0, 64) : '';
    if (!id || !ids.has(id) || plans.has(id)) continue;
    if (item.skip === true) {
      plans.set(id, null);
      continue;
    }
    const plan = readVisual({ visual: item });
    if (plan) plans.set(id, plan);
  }
  return plans;
}

export interface VisualPlanResult {
  /** `null` means the model explicitly skipped this question. */
  plans: Map<string, VisualPlan | null>;
  usage: AiUsage;
  /** One short message per failed call; the caller turns these into warnings. */
  failures: string[];
}

export interface VisualPlanOptions {
  signal?: AbortSignal;
  maxTokens?: number;
}

function addUsage(total: AiUsage, next: AiUsage | undefined): AiUsage {
  if (!next) return total;
  return {
    promptTokens: total.promptTokens + next.promptTokens,
    completionTokens: total.completionTokens + next.completionTokens,
    totalTokens: total.totalTokens + next.totalTokens,
  };
}

function cancelled(error: unknown): boolean {
  return error instanceof AiError && error.code === 'cancelled';
}

/**
 * Ask the text model for one visual per question. Never throws except on
 * cancellation: a provider failure is reported in `failures` so the caller can
 * keep the deck and fall back to the author's hint.
 */
export async function planVisuals(
  model: ChatModel,
  requests: readonly VisualRequest[],
  context: VisualContext,
  options: VisualPlanOptions = {},
): Promise<VisualPlanResult> {
  const plans = new Map<string, VisualPlan | null>();
  const failures: string[] = [];
  let usage = ZERO_USAGE;
  if (requests.length === 0) return { plans, usage, failures };

  for (let start = 0; start < requests.length; start += VISUALS_PER_CALL) {
    if (options.signal?.aborted) throw new AiError('cancelled', 'Generation was cancelled');
    const group = requests.slice(start, start + VISUALS_PER_CALL);
    const ids = new Set(group.map((request) => request.question.id));
    try {
      const reply = await model.complete(buildPlanMessages(group, context), {
        jsonMode: true,
        temperature: 0.25,
        maxTokens: options.maxTokens ?? 2400,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      usage = addUsage(usage, reply.usage);
      for (const [id, plan] of parseVisualPlanReply(reply.text, ids)) plans.set(id, plan);
    } catch (error) {
      if (cancelled(error)) throw error;
      failures.push(
        `Illustration planning failed for ${group.length} question${group.length === 1 ? '' : 's'}: ${
          error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160)
        }`,
      );
    }
  }
  return { plans, usage, failures };
}
