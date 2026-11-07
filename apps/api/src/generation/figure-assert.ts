/**
 * Deterministic assertions for figure plans.
 *
 * The renderer is exact, so the checks are structural rather than visual: a
 * chart must contain data marks, a flow must contain arrows, a table must have
 * cells, and no figure may repeat the answer as text. A scene photo is checked
 * for a usable brief and, later, for attribution when it came from web search.
 */
import type { FigureSpec, Question } from '@mengyin/core';
import type { FigureKind } from './figure-registry';
import {
  figureIsInformative,
  figureRevealsAnswerShape,
  questionReferencesVisual,
  sanitizeFigure,
  type VisualPlan,
} from './visual';

export interface AssertionResult {
  ok: boolean;
  reason?: string;
  /** The cleaned figure, when the plan is a diagram. */
  figure?: FigureSpec;
}

function hasDataMark(figure: FigureSpec): boolean {
  return figure.elements.some(
    (element) =>
      element.kind === 'bar' ||
      element.kind === 'plot' ||
      element.kind === 'line' ||
      element.kind === 'point' ||
      element.kind === 'table' ||
      element.kind === 'pie' ||
      element.kind === 'polygon' ||
      element.kind === 'chart' ||
      element.kind === 'timeline',
  );
}

function hasConnection(figure: FigureSpec): boolean {
  return figure.elements.some(
    (element) =>
      element.kind === 'line' ||
      element.kind === 'graph' ||
      element.kind === 'circuit' ||
      (element.kind === 'map' && ((element.routes?.length ?? 0) > 0 || (element.arrows?.length ?? 0) > 0)) ||
      (element.kind === 'apparatus' && (element.connections?.length ?? 0) > 0),
  );
}

function hasStructure(figure: FigureSpec): boolean {
  return figure.elements.some((element) => element.kind !== 'label');
}

/**
 * Validate one diagram against its registered assertions. `kind` is null when
 * the classifier did not recognise the figure; the universal checks still run.
 */
export function assertDiagram(figure: FigureSpec, question: Question, kind: FigureKind | null): AssertionResult {
  const cleaned = sanitizeFigure(figure, question);
  if (!cleaned) return { ok: false, reason: 'the figure was only answer text' };
  if (cleaned.elements.length === 0) return { ok: false, reason: 'the figure is empty' };

  const assertions = kind?.assertions ?? ['figure-nonempty'];
  if (assertions.includes('figure-nonempty') && cleaned.elements.length === 0) {
    return { ok: false, reason: 'the figure is empty' };
  }
  if (assertions.includes('figure-has-structure') && !hasStructure(cleaned)) {
    return { ok: false, reason: 'the figure has no structure, only labels' };
  }
  if (assertions.includes('figure-has-data') && !hasDataMark(cleaned)) {
    return { ok: false, reason: 'the chart has no data marks' };
  }
  if (assertions.includes('flow-connected') && !hasConnection(cleaned)) {
    return { ok: false, reason: 'the flow has no connections between nodes' };
  }
  if (assertions.includes('not-answer-shape') && figureRevealsAnswerShape(cleaned, question)) {
    return { ok: false, reason: 'the figure draws the shape named by the answer' };
  }

  // A plain canvas of unconnected symbols is decoration, unless the question is
  // explicitly about the figure. This is the same rule as the old gate, now
  // applied per figure kind.
  if (!questionReferencesVisual(question) && !figureIsInformative(cleaned, question)) {
    return { ok: false, reason: 'the figure is decoration, not an explanation' };
  }
  return { ok: true, figure: cleaned };
}

/** Validate a scene or photo plan before it becomes an image request. */
export function assertPhoto(plan: Extract<VisualPlan, { kind: 'photo' }>, kind: FigureKind | null): AssertionResult {
  if (!plan.prompt.trim()) return { ok: false, reason: 'the photo brief is empty' };
  if (kind?.assertions.includes('scene-has-prompt') && plan.prompt.trim().length < 8) {
    return { ok: false, reason: 'the photo brief is too short to be useful' };
  }
  return { ok: true };
}
