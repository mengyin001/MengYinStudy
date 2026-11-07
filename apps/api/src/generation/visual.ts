/**
 * The visual router.
 *
 * The question author is asked for one optional `visual` object per question:
 *
 *   { "kind": "diagram", "spec": {...}, "alt": "..." }
 *   { "kind": "photo",   "prompt": "...", "alt": "..." }
 *   { "kind": "none" }
 *
 * A diagram is data for the app's own renderer: exact, labelled, free, and
 * stored without an upload. A photo goes to the image model, because a
 * diffusion model is good at scenes and hopeless at labelled geometry. The
 * router keeps those two worlds apart and treats every field as untrusted.
 */
import type { AiImageMode } from '@mengyin/ai-contract';
import {
  figureElementTexts,
  parseFigureSpec,
  type FigureElement,
  type FigureSpec,
  type FlowShapeKind,
  type Question,
} from '@mengyin/core';

export const MAX_PHOTO_PROMPT_CHARS = 600;
export const MAX_PHOTO_SEARCH_CHARS = 160;
export const MAX_VISUAL_ALT_CHARS = 160;

export type VisualPlan =
  | { kind: 'diagram'; figure: FigureSpec; alt?: string }
  | { kind: 'photo'; prompt: string; search?: string; alt?: string }
  | { kind: 'none' };

export function cleanLine(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readDiagram(item: Record<string, unknown>, alt: string): VisualPlan | null {
  const candidate = item.spec ?? item.figure ?? item.diagram ?? item;
  const figure = parseFigureSpec(candidate);
  if (!figure) return null;
  return { kind: 'diagram', figure, ...(alt ? { alt } : {}) };
}

function readPhoto(item: Record<string, unknown>, alt: string): VisualPlan | null {
  const prompt = cleanLine(item.prompt ?? item.brief ?? item.description, MAX_PHOTO_PROMPT_CHARS);
  if (!prompt) return null;
  // `search` is an internal query for a real reference photo (Wikimedia
  // Commons). It may name the answer for a "guess the country" clue, so it is
  // never shown to the learner; `alt` is, and must stay neutral.
  const search = cleanLine(item.search ?? item.query ?? item.webQuery, MAX_PHOTO_SEARCH_CHARS);
  return { kind: 'photo', prompt, ...(search ? { search } : {}), ...(alt ? { alt } : {}) };
}

/**
 * Read one model-written visual. Unknown shapes return `null` (nothing was
 * said) rather than `{kind:'none'}` so the caller can tell "the model declined"
 * from "the model ignored the field" when `imageMode` is `on`.
 */
export function readVisual(raw: unknown): VisualPlan | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const container = raw as Record<string, unknown>;
  const value = container.visual;
  if (value === null || value === undefined) {
    // Backwards compatibility with the 1.x prompt, which used `image`.
    const legacy = objectOf(container.image);
    if (!legacy) return null;
    return readPhoto(legacy, cleanLine(legacy.alt, MAX_VISUAL_ALT_CHARS));
  }
  if (typeof value === 'string') {
    const kind = value.trim().toLowerCase();
    if (kind === 'none' || kind === 'skip' || kind === 'no') return { kind: 'none' };
    return null;
  }
  const item = objectOf(value);
  if (!item) return null;

  const alt = cleanLine(item.alt, MAX_VISUAL_ALT_CHARS);
  const kind = typeof item.kind === 'string' ? item.kind.trim().toLowerCase() : '';
  if (kind === 'none' || kind === 'skip' || item.skip === true) return { kind: 'none' };

  if (kind === 'diagram' || kind === 'figure' || kind === 'spec') {
    const diagram = readDiagram(item, alt);
    if (diagram) return diagram;
    // A broken diagram is more useful as a photo than as nothing, when the
    // model also supplied a usable brief.
    return readPhoto(item, alt);
  }
  if (kind === 'photo' || kind === 'image' || kind === 'illustration' || kind === 'natural') {
    return readPhoto(item, alt);
  }
  // No kind: infer from the payload.
  if (item.spec !== undefined || item.figure !== undefined) return readDiagram(item, alt);
  if (typeof item.prompt === 'string') return readPhoto(item, alt);
  return null;
}

/** True when this question may carry a visual at all. */
export function visualEligible(question: Question): boolean {
  return question.type !== 'code';
}

function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s()[\]{}（）【】]/g, '')
    .replace(/[.,;:!?。，；：！？]/g, '');
}

/** The strings a diagram must never show, because they give the answer away. */
export function answerLabels(question: Question): Set<string> {
  const labels = new Set<string>();
  const answer = question.answer;
  const add = (value: string | undefined): void => {
    if (value && value.trim().length > 0 && value.length <= 60) labels.add(normalizeLabel(value));
  };
  if (answer.kind === 'single' || answer.kind === 'multi') {
    const ids = answer.kind === 'single' ? [answer.optionId] : answer.optionIds;
    for (const id of ids) add(question.options?.find((option) => option.id === id)?.text);
  } else if (answer.kind === 'fill') {
    for (const value of answer.accept) add(value);
  } else if (answer.kind === 'short') {
    add(answer.model);
  } else if (answer.kind === 'boolean') {
    add(answer.value ? 'true' : 'false');
  }
  return labels;
}

/**
 * Remove a label that repeats the correct answer, and drop the figure if that
 * was its only content. A diagram is allowed to carry text, which means a model
 * can accidentally print the answer on it; the prompt forbids this, but a
 * deterministic check is cheaper than trusting the model.
 */
const COMPOUND_TEXT_KINDS = new Set<FigureElement['kind']>([
  'chart',
  'graph',
  'map',
  'circuit',
  'molecule',
  'music',
  'timeline',
  'apparatus',
  'surface3d',
  'code',
  'formula',
]);

function textLeaks(text: string, forbidden: ReadonlySet<string>): boolean {
  const normalized = normalizeLabel(text);
  if (forbidden.has(normalized)) return true;
  // Text that embeds the answer ("France (Paris)") leaks just as much as an
  // exact match. Short labels would match everywhere, so only check 3+ chars.
  for (const label of forbidden) {
    if (label.length >= 3 && normalized.includes(label)) return true;
  }
  return false;
}

export function sanitizeFigure(figure: FigureSpec, question: Question): FigureSpec | null {
  const forbidden = answerLabels(question);
  if (forbidden.size === 0) return figure;
  const elements = figure.elements.filter((element) => {
    if (element.kind === 'label' && forbidden.has(normalizeLabel(element.text))) return false;
    // A compound element is all-or-nothing: dropping one node from a graph or
    // one cell from a chart leaves a misleading picture, so the whole element
    // is removed when any of its text leaks the answer.
    if (COMPOUND_TEXT_KINDS.has(element.kind)) {
      return !figureElementTexts(element).some((text) => textLeaks(text, forbidden));
    }
    // A table is all text. If any cell repeats the answer, the whole table is
    // the answer, so drop it instead of shipping a half-visible grid.
    if (element.kind === 'table') {
      const cells = [...element.columns, ...element.rows.flat()];
      return !cells.some((cell) => textLeaks(cell, forbidden));
    }
    if (element.kind === 'pie') {
      return !element.slices.some(
        (slice) => slice.label !== undefined && forbidden.has(normalizeLabel(slice.label)),
      );
    }
    return true;
  });
  const cleaned = elements.map((element) => {
    if (element.kind === 'point' && element.label && forbidden.has(normalizeLabel(element.label))) {
      const { label: _label, ...rest } = element;
      return rest;
    }
    if (element.kind === 'shape' && element.text && forbidden.has(normalizeLabel(element.text))) {
      const { text: _text, ...rest } = element;
      return rest;
    }
    return element;
  });
  if (cleaned.length === 0) return null;
  return { ...figure, elements: cleaned };
}

/**
 * Keep the answer out of a photo's alt text. A screen reader would otherwise
 * read out "the Eiffel Tower in France" while the learner is asked to guess the
 * country. The picture itself may be the clue; the words may not.
 */
export function sanitizeAlt(alt: string | undefined, question: Question): string | undefined {
  if (!alt) return alt;
  const forbidden = answerLabels(question);
  if (forbidden.size === 0) return alt;
  const compact = normalizeLabel(alt);
  for (const label of forbidden) {
    // One- and two-letter option ids occur everywhere in normal prose; a
    // three-letter Latin match or any CJK match is a real leak.
    const cjk = /[\u4e00-\u9fff]/.test(label);
    if (label.length < (cjk ? 1 : 3)) continue;
    if (compact.includes(label)) {
      return /[\u4e00-\u9fff]/.test(question.prompt)
        ? '與題目情境相關的圖片'
        : 'A picture related to the question';
    }
  }
  return alt;
}

/**
 * Questions that name a flowchart shape are a trap for an illustration pass: a
 * picture of a rectangle answers "which shape means process?" and a picture of
 * five symbols is decoration. The planner prompt asks the model to skip these,
 * but prompts are advisory, so the same rule is enforced here.
 */
const VISUAL_REFERENCE =
  /(?<!流程)圖中|如圖|下圖|上圖|附圖|示意圖|圖表|圖片|照片|圖示|圖例|此圖|如下圖|如上圖|下列圖|圖一|圖二|圖三|圖四|in (?:the|this) (?:figure|diagram|chart|graph|image|picture)|shown|illustrated|depicted|as illustrated|this (?:figure|diagram|chart|graph|image)|(?:figure|diagram|chart|graph|image) (?:below|above)|(?:below|above) (?:shows|illustrates)/i;

const SYMBOL_TOPIC =
  /形狀|符號|圖形|圖例|流程圖|shape|symbol|flow ?chart|legend|diagram symbol/i;

const REPRESENT =
  /代表|表示|用來表示|用以表示|象徵|對應|mean(?:s|ing)?\b|represent(?:s|ed|ing)?\b|stand(?:s)? for|used (?:to|for) (?:represent|show|mean|indicate)|refers? to|corresponds? to|indicate(?:s|d)?\b/i;

const SHAPE_NAMES: Array<{ kind: FlowShapeKind; pattern: RegExp }> = [
  { kind: 'rounded', pattern: /圓角矩形|圓角|rounded|stadium|terminator|start\s*\/\s*end/i },
  { kind: 'parallelogram', pattern: /平行四邊形|parallelogram/i },
  { kind: 'diamond', pattern: /菱形|鑽石形|diamond|rhombus/i },
  { kind: 'ellipse', pattern: /橢圓|椭圆|oval|ellipse|connector/i },
  { kind: 'rect', pattern: /矩形|長方形|方形|方框|方塊|rectangle|square|box|\brect\b/i },
];

function shapeKindForText(text: string): FlowShapeKind | null {
  for (const entry of SHAPE_NAMES) {
    if (entry.pattern.test(text)) return entry.kind;
  }
  return null;
}

function answerShapeKinds(question: Question): Set<FlowShapeKind> {
  const kinds = new Set<FlowShapeKind>();
  for (const label of answerLabels(question)) {
    const kind = shapeKindForText(label);
    if (kind) kinds.add(kind);
  }
  return kinds;
}

/**
 * Questions whose picture *is* the thing to identify: "guess the country",
 * "which organelle is shown", "what curve is this". For these, the picture is
 * allowed (and expected) to depict the answer; only text naming the answer is
 * forbidden. This is the exception to the usual no-answer-leak rule.
 */
const VISUAL_CLUE =
  /(?:根據(?:這|該)?(?:張|幅)?(?:圖|照片|圖片)|圖中(?:所示)?|照片中|圖片中|如下圖|如上圖|shown in (?:the|this) (?:figure|diagram|photo|picture|image)|in the (?:figure|photo|picture|image) (?:above|below)|what is shown|which (?:country|city|place|landmark|organ|cell|curve|shape|element|planet) is (?:this|shown)|identify (?:the|what)|guess (?:the|which)|這是哪|猜(?:一?下)?|辨認|認出)/i;

/** True when the question cannot be answered without the picture. */
export function questionReferencesVisual(question: Question): boolean {
  return VISUAL_REFERENCE.test(question.prompt);
}

/** True when the learner is meant to identify what the picture shows. */
export function questionIsVisualClue(question: Question): boolean {
  return questionReferencesVisual(question) || VISUAL_CLUE.test(question.prompt);
}

export interface VisualVerdict {
  worth: boolean;
  reason?: 'code' | 'symbol-definition';
}

/**
 * A cheap, deterministic decision that runs before the visual planner. It does
 * not try to judge every topic; it only removes the cases where a picture is
 * certainly useless or certainly gives the answer away. The planner still makes
 * the finer "does this scene help?" call for everything that survives.
 */
export function visualWorthiness(question: Question): VisualVerdict {
  if (!visualEligible(question)) return { worth: false, reason: 'code' };
  if (questionReferencesVisual(question)) return { worth: true };
  if (answerShapeKinds(question).size > 0) return { worth: false, reason: 'symbol-definition' };
  const promptShape = shapeKindForText(normalizeLabel(question.prompt));
  if (SYMBOL_TOPIC.test(question.prompt) && (REPRESENT.test(question.prompt) || promptShape !== null)) {
    return { worth: false, reason: 'symbol-definition' };
  }
  return { worth: true };
}

/**
 * A one-node "flowchart" is a symbol chart, not an explanation. The same is true
 * of a plain canvas with several unconnected shapes: it is almost always the
 * model restating the answer visually. A question that explicitly refers to its
 * figure is exempt, because the figure is then the question.
 */
export function figureIsInformative(figure: FigureSpec, question: Question): boolean {
  if (figure.coords !== 'plain') return true;
  if (questionReferencesVisual(question)) return true;
  // A table, chart, graph, map or other compound renderer is a complete
  // structure, not a row of decorative symbols.
  if (figure.elements.some((element) => element.kind === 'table' || COMPOUND_TEXT_KINDS.has(element.kind))) {
    return true;
  }
  const connectors = figure.elements.filter(
    (element) =>
      element.kind === 'line' ||
      element.kind === 'polygon' ||
      element.kind === 'plot' ||
      element.kind === 'bar' ||
      element.kind === 'pie' ||
      element.kind === 'circle' ||
      element.kind === 'arc',
  );
  // Either a single shape or a row of unconnected shapes is a symbol chart.
  return connectors.length > 0;
}

/** A backstop for a diagram that literally draws the shape named by the answer. */
export function figureRevealsAnswerShape(figure: FigureSpec, question: Question): boolean {
  if (questionReferencesVisual(question)) return false;
  const kinds = answerShapeKinds(question);
  if (kinds.size === 0) return false;
  return figure.elements.some((element) => element.kind === 'shape' && kinds.has(element.shape));
}

/** A deterministic, conservative photo brief for `imageMode: "on"` when the
 * model supplied nothing usable. It is a last resort, not the normal path. */
export function fallbackPhoto(question: Question): VisualPlan {
  // Do not include the explanation: it often names the correct answer, and a
  // generic illustration must not become a picture of the answer.
  const prompt =
    `A clean, simple educational illustration that helps explain: ${question.prompt}. ` +
    'Show only the objects and relationships stated in the prompt. Plain white background, flat vector style, ' +
    'clear outlines, no text, no labels, no numbers, no people, no watermark.';
  return {
    kind: 'photo',
    prompt: prompt.replace(/\s+/g, ' ').trim().slice(0, MAX_PHOTO_PROMPT_CHARS),
    alt: question.prompt.slice(0, MAX_VISUAL_ALT_CHARS),
  };
}

/** The answer as readable text (not the option id), used only server-side. */
export function answerText(question: Question): string {
  const answer = question.answer;
  switch (answer.kind) {
    case 'single':
      return question.options?.find((option) => option.id === answer.optionId)?.text ?? '';
    case 'multi':
      return answer.optionIds
        .map((id) => question.options?.find((option) => option.id === id)?.text ?? '')
        .filter(Boolean)
        .join(', ');
    case 'fill':
      return answer.accept[0] ?? '';
    case 'short':
      return answer.model;
    case 'boolean':
      return answer.value ? 'true' : 'false';
    default:
      return '';
  }
}

/**
 * A scene brief for a question whose picture is the clue. The search query may
 * name the answer, because it is internal; the alt text must not. This is the
 * path for "guess the country" when the planner skipped or drew a diagram.
 */
export function fallbackScene(question: Question, suffix = 'landmark landscape'): VisualPlan {
  const answer = answerText(question).trim();
  // A short noun phrase such as "France" or "大腸桿菌" searches well; a full
  // sentence does not, so fall back to the question scene instead.
  const subject = answer && answer.length <= 60 ? answer : '';
  const search = subject
    ? suffix === 'landmark landscape'
      ? subject
      : `${subject} ${suffix}`.trim()
    : '';
  const prompt = subject
    ? suffix === 'microscope'
      ? `A realistic microscope image of ${subject} with clear structures. No text, no labels, no numbers, no watermark.`
      : suffix === 'historical'
        ? `A realistic historical scene of ${subject}, accurate period detail. No text, no labels, no watermark, no identifiable people.`
        : `A realistic travel photograph of a recognizable landmark or landscape in ${subject}. ` +
          'Natural daylight, sharp focus, no text, no labels, no numbers, no watermark, no identifiable people.'
    : `A realistic, high-quality photograph showing the scene described by this educational question: ${question.prompt}. ` +
      'Natural daylight, sharp focus, no text, no labels, no numbers, no watermark, no identifiable people.';
  const zh = /[\u4e00-\u9fff]/.test(question.prompt);
  return {
    kind: 'photo',
    prompt: prompt.replace(/\s+/g, ' ').trim().slice(0, MAX_PHOTO_PROMPT_CHARS),
    ...(search ? { search: search.slice(0, MAX_PHOTO_SEARCH_CHARS) } : {}),
    alt: zh ? '與題目情境相關的照片' : 'A photo related to the question',
  };
}

/**
 * The prompt snippet that tells the author what a visual may contain. The
 * detailed spec grammar lives in the authoring skill; this only sets the mode.
 */
export function visualInstruction(mode: AiImageMode, photosAvailable: boolean, searchAvailable = false): string {
  if (mode === 'off') return 'Visuals: disabled. Omit "visual" from every question.';
  const availability = photosAvailable
    ? searchAvailable
      ? ' A real photo can come from web image search when you add a "search" query, or from the image model when you omit it.'
      : ''
    : searchAvailable
      ? ' Photo generation is unavailable, but web image search is available: use "photo" with a short English "search" query for a real place, person, organism or historical scene; use "diagram" for exact content.'
      : ' Photo generation is unavailable on this server, so use "diagram" for every visual you emit.';
  const families =
    'Choose the medium by what must be shown: data/charts and tables use a chart or table; processes, trees, ' +
    'graphs, UML, ER, pedigrees and state machines use a graph (Mermaid for a plain process); geometry, ' +
    'functions, forces and fields use a diagram spec; maps, circuits, molecular structures, music staves, ' +
    'timelines, apparatus and 3-D surfaces use their named compound renderer; a real place, person, organism ' +
    'or historical scene uses "photo" (add "search" for a real reference photo). Do not fake a structure ' +
    'with unrelated boxes and lines, and do not use a photo for exact content.';
  if (mode === 'on') {
    return (
      'Visuals: required where a picture helps. Add one "visual" object to every non-code question, but never ' +
      'to a question that asks which shape or symbol represents something: that picture is the answer. Prefer ' +
      '"diagram" for anything exact or structural; use "photo" only for a real-world scene. A diagram you can ' +
      `draw exactly is always better than a photo prompt that guesses. ${families}${availability}`
    );
  }
  return (
    'Visuals: optional, but not rare. Add a "visual" object when it helps the learner picture a structure, ' +
    'graph, spatial relationship, process or scene. On visual subjects (mathematics, physics, chemistry, ' +
    'biology, geography, engineering, computer science) aim for roughly one in three questions; on verbal ' +
    'or definition-heavy material it is fine to have none. Skip definitions, quotations, arithmetic, pure ' +
    'verbal logic, and questions that ask what a flowchart shape or symbol means. For a process or decision ' +
    'flow, write Mermaid and let the app lay it out; never hand-place flowchart nodes. ' +
    `${families}${availability}`
  );
}
