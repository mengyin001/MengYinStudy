/**
 * Compound renderer dispatch.
 *
 * Keep this list short. Every entry is one renderer reused by many registry
 * kinds; a new figure family should extend an existing renderer before adding a
 * new one.
 */
import type {
  ApparatusElement,
  ChartElement,
  CircuitElement,
  CodeElement,
  FigureElement,
  FigureShape,
  FormulaElement,
  GraphElement,
  MapElement,
  MoleculeElement,
  MusicElement,
  Surface3DElement,
  TimelineElement,
} from '../figure';
import { renderApparatus } from './apparatus';
import { renderChart } from './chart';
import { renderCircuit } from './circuit';
import { renderCode, renderFormula } from './code';
import { renderGraph } from './graph';
import { renderMap } from './map';
import { renderMolecule } from './molecule';
import { renderMusic } from './music';
import { renderSurface3D } from './surface3d';
import { renderTimeline } from './timeline';
import type { RenderContext } from './types';

const COMPOUND_KINDS = new Set<FigureElement['kind']>([
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

export function isCompoundElement(element: FigureElement): boolean {
  return COMPOUND_KINDS.has(element.kind);
}

/** Draw one compound element. Unknown kinds return an empty shape list. */
export function renderCompound(element: FigureElement, ctx: RenderContext): FigureShape[] {
  switch (element.kind) {
    case 'chart':
      return renderChart(element as ChartElement, ctx);
    case 'graph':
      return renderGraph(element as GraphElement, ctx);
    case 'map':
      return renderMap(element as MapElement, ctx);
    case 'circuit':
      return renderCircuit(element as CircuitElement, ctx);
    case 'molecule':
      return renderMolecule(element as MoleculeElement, ctx);
    case 'music':
      return renderMusic(element as MusicElement, ctx);
    case 'timeline':
      return renderTimeline(element as TimelineElement, ctx);
    case 'apparatus':
      return renderApparatus(element as ApparatusElement, ctx);
    case 'surface3d':
      return renderSurface3D(element as Surface3DElement, ctx);
    case 'code':
      return renderCode(element as CodeElement, ctx);
    case 'formula':
      return renderFormula(element as FormulaElement, ctx);
    default:
      return [];
  }
}
