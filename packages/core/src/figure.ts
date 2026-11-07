/**
 * Declarative visual specs ("figures") for practice questions.
 *
 * A figure is data, not code: the model writes a small JSON document and the
 * app draws it with a fixed renderer. That is deliberate. During development
 * the obvious alternative was to let the model emit JavaScript that draws on a
 * canvas, but running generated code would need a full browser sandbox on every
 * question card, and the result would still be a bitmap that cannot be stored
 * or searched. A spec is deterministic, theme-aware, printable, tiny, and can
 * be validated without executing anything.
 *
 * The one place a model *does* supply something executable is a plotted
 * function (`sin(x)`, `x^2 / 4`). Those expressions are parsed into an AST and
 * evaluated by the interpreter below — never with `eval` or `Function`. The
 * interpreter has no globals, no object access, no assignment, no loops and a
 * fixed node budget, so a malicious expression can only produce numbers (or
 * `NaN`). See `compileExpression`.
 *
 * Coordinates:
 * - `cartesian`: x/y are mathematical coordinates, y grows upwards. Defaults
 *   are 0..10 on both axes. Used for function plots, geometry and charts.
 * - `plain`: x/y are percentages of the box, 0..100, y grows downwards. Used
 *   for flow charts and diagrams that do not need axes.
 */

import { compileFigureFlow } from './flow';
import { isCompoundElement, renderCompound } from './renderers';

export type FigureCoords = 'cartesian' | 'plain';

export interface FigureAxis {
  min: number;
  max: number;
  step?: number;
  label?: string;
}

export interface PlotElement {
  kind: 'plot';
  expr: string;
  from?: number;
  to?: number;
  color?: string;
  width?: number;
  dashed?: boolean;
}

export interface LineElement {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color?: string;
  width?: number;
  dashed?: boolean;
  arrow?: boolean;
}

export interface PointElement {
  kind: 'point';
  x: number;
  y: number;
  r?: number;
  label?: string;
  color?: string;
}

export interface CircleElement {
  kind: 'circle';
  x: number;
  y: number;
  r: number;
  color?: string;
  fill?: boolean;
}

export interface PolygonElement {
  kind: 'polygon';
  points: Array<[number, number]>;
  color?: string;
  fill?: boolean;
}

export interface ArcElement {
  kind: 'arc';
  x: number;
  y: number;
  r: number;
  /** Degrees, 0 = east, counter-clockwise in cartesian space. */
  from: number;
  to: number;
  color?: string;
  width?: number;
}

export interface LabelElement {
  kind: 'label';
  x: number;
  y: number;
  text: string;
  color?: string;
  size?: number;
  anchor?: 'start' | 'middle' | 'end';
}

export interface BarElement {
  kind: 'bar';
  /** Lower-left corner in cartesian space; top-left in plain space. */
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
}

/**
 * A small table: truth tables, comparison tables and matrices. Plain
 * coordinates only. The model supplies the cells; the renderer owns the grid,
 * so row and column alignment cannot drift.
 */
export interface TableElement {
  kind: 'table';
  x: number;
  y: number;
  w: number;
  h: number;
  columns: string[];
  rows: string[][];
  /** Draw the first row as a header (default true). */
  header?: boolean;
}

export interface PieSlice {
  value: number;
  label?: string;
  color?: string;
}

/**
 * A pie chart on the plain canvas. The model supplies the values and labels;
 * the renderer computes the angles, so the slices always sum to a full circle.
 */
export interface PieElement {
  kind: 'pie';
  x: number;
  y: number;
  /** Radius as a percentage of the shorter canvas edge. */
  r: number;
  slices: PieSlice[];
}

// ---------------------------------------------------------------------------
// Compound renderers
//
// A chart, graph, map, circuit, molecule, staff or timeline is too structured
// to describe as loose primitives. Each one is a single semantic element with
// its own data, and one dedicated renderer turns it into SVG shapes. The point
// is reuse: one graph renderer covers flowcharts, trees, UML, ER, pedigrees and
// networks; one chart renderer covers the whole plot family. The model writes
// the data it knows (categories, values, nodes, edges) and the renderer owns the
// geometry, so a model cannot hand-place a broken chart.
// ---------------------------------------------------------------------------

export type ChartVariant =
  | 'bar'
  | 'line'
  | 'scatter'
  | 'bubble'
  | 'area'
  | 'errorbar'
  | 'box'
  | 'violin'
  | 'radar'
  | 'gauge'
  | 'funnel'
  | 'heatmap'
  | 'polar'
  | 'vector'
  | 'waterfall'
  | 'population'
  | 'wordcloud'
  | 'treemap'
  | 'sunburst'
  | 'sankey'
  | 'chord'
  | 'gantt'
  | 'scatter-matrix'
  | 'phase'
  | 'contour'
  | 'dual';

export interface ChartPoint {
  x: number;
  y: number;
  r?: number;
  label?: string;
}

export interface ChartSeries {
  name?: string;
  values?: number[];
  points?: ChartPoint[];
  color?: string;
  /** Five-number summary: min, Q1, median, Q3, max. */
  summary?: [number, number, number, number, number];
  /** Low/high error for each value, in the same order as `values`. */
  errors?: Array<[number, number]>;
  /** Explicit polylines for a contour or phase plot. */
  lines?: Array<Array<[number, number]>>;
  /** Arrow field: a start point and a displacement. */
  vectors?: Array<{ x: number; y: number; dx: number; dy: number }>;
}

/**
 * One chart element. The renderer chooses axes, scales and marks from `variant`
 * and `series`; the model never supplies pixel coordinates for the data.
 */
export interface ChartElement {
  kind: 'chart';
  variant: ChartVariant;
  x: number;
  y: number;
  w: number;
  h: number;
  categories?: string[];
  series?: ChartSeries[];
  /** Word cloud entries. */
  words?: Array<{ text: string; weight: number }>;
  /** Gantt tasks, in data units (for example years or days). */
  tasks?: Array<{ label: string; start: number; end: number; color?: string }>;
  /** Sankey/chord nodes. */
  nodes?: Array<{ id: string; label?: string; value?: number }>;
  /** Sankey/chord links. */
  links?: Array<{ from: string; to: string; value: number }>;
  min?: number;
  max?: number;
  xLabel?: string;
  yLabel?: string;
  unit?: string;
}

export type GraphLayout = 'layered' | 'tree' | 'radial' | 'network';
export type GraphNodeShape = FlowShapeKind | 'class' | 'entity' | 'person';

export interface GraphNode {
  id: string;
  text: string;
  shape?: GraphNodeShape;
  group?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
  arrow?: boolean;
  kind?: 'association' | 'inheritance' | 'composition' | 'aggregation';
}

/** One node-and-edge diagram: a process, a class model, a pedigree, a network. */
export interface GraphElement {
  kind: 'graph';
  layout?: GraphLayout;
  direction?: 'TD' | 'LR';
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface MapPoint {
  x: number;
  y: number;
  label?: string;
  kind?: 'city' | 'capital' | 'site' | 'battle';
}

export interface MapLine {
  points: Array<[number, number]>;
  label?: string;
  dashed?: boolean;
  arrow?: boolean;
  color?: string;
}

export interface MapRegion {
  points: Array<[number, number]>;
  label?: string;
  value?: number;
  color?: string;
}

export type MapMode = 'map' | 'contour' | 'cross-section' | 'route' | 'urban' | 'historical' | 'tactics';

/** A schematic map, cross-section or route: regions, contours and arrows. */
export interface MapElement {
  kind: 'map';
  mode?: MapMode;
  x: number;
  y: number;
  w: number;
  h: number;
  regions?: MapRegion[];
  routes?: MapLine[];
  points?: MapPoint[];
  contours?: MapLine[];
  /** Cross-section strata, drawn as filled polygons. */
  layers?: MapRegion[];
  arrows?: Array<{ x1: number; y1: number; x2: number; y2: number; label?: string; color?: string }>;
  scale?: string;
}

export type CircuitPartType =
  | 'battery'
  | 'cell'
  | 'resistor'
  | 'capacitor'
  | 'lamp'
  | 'switch'
  | 'ammeter'
  | 'voltmeter'
  | 'inductor'
  | 'diode'
  | 'motor'
  | 'ground'
  | 'junction';

export interface CircuitPart {
  type: CircuitPartType;
  x: number;
  y: number;
  rotation?: 0 | 90 | 180 | 270;
  label?: string;
  value?: string;
}

export interface CircuitWire {
  points: Array<[number, number]>;
}

/** A circuit schematic with standard component symbols and wires. */
export interface CircuitElement {
  kind: 'circuit';
  x: number;
  y: number;
  w: number;
  h: number;
  parts: CircuitPart[];
  wires: CircuitWire[];
}

export interface MoleculeAtom {
  element: string;
  x: number;
  y: number;
  label?: string;
  charge?: string;
}

export interface MoleculeBond {
  from: number;
  to: number;
  order?: 1 | 2 | 3;
}

export interface MoleculeGroup {
  atoms: MoleculeAtom[];
  bonds: MoleculeBond[];
  label?: string;
}

export type MoleculeMode = 'structure' | 'reaction' | 'crystal' | 'orbital';

/** A skeletal formula, reaction scheme, crystal lattice or orbital diagram. */
export interface MoleculeElement {
  kind: 'molecule';
  mode?: MoleculeMode;
  x: number;
  y: number;
  w: number;
  h: number;
  groups?: MoleculeGroup[];
  arrowLabel?: string;
  /** Orbital/energy levels, lowest at the bottom. */
  levels?: Array<{ energy: number; label?: string; electrons?: number }>;
}

export interface MusicNote {
  pitch: string;
  duration?: number;
  rest?: boolean;
  accidental?: '#' | 'b' | 'n';
}

/** A staff with notes, rests and a clef. */
export interface MusicElement {
  kind: 'music';
  x: number;
  y: number;
  w: number;
  h: number;
  clef?: 'treble' | 'bass';
  key?: string;
  time?: string;
  notes: MusicNote[];
}

export interface TimelineEvent {
  at: number;
  label: string;
  description?: string;
}

export interface TimelineTask {
  label: string;
  start: number;
  end: number;
  lane?: number;
  color?: string;
}

/** A timeline or a Gantt chart: one axis, markers or bars. */
export interface TimelineElement {
  kind: 'timeline';
  mode?: 'timeline' | 'gantt' | 'plot';
  x: number;
  y: number;
  w: number;
  h: number;
  min?: number;
  max?: number;
  unit?: string;
  events?: TimelineEvent[];
  tasks?: TimelineTask[];
}

export type ApparatusPartType =
  | 'beaker'
  | 'flask'
  | 'test-tube'
  | 'burner'
  | 'lens'
  | 'prism'
  | 'mirror'
  | 'spring'
  | 'pulley'
  | 'incline'
  | 'block'
  | 'battery'
  | 'meter'
  | 'lamp'
  | 'screen'
  | 'box'
  | 'arrow'
  | 'label';

export interface ApparatusPart {
  type: ApparatusPartType;
  x: number;
  y: number;
  w?: number;
  h?: number;
  label?: string;
  rotation?: number;
}

/** A labelled apparatus or engineering sketch made from stylised parts. */
export interface ApparatusElement {
  kind: 'apparatus';
  x: number;
  y: number;
  w: number;
  h: number;
  parts: ApparatusPart[];
  connections?: Array<{ from: number; to: number; dashed?: boolean; arrow?: boolean }>;
}

export interface SurfacePoint {
  x: number;
  y: number;
  z: number;
  label?: string;
}

/** A small 3-D surface or point cloud, drawn in isometric projection. */
export interface Surface3DElement {
  kind: 'surface3d';
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number[][];
  points?: SurfacePoint[];
  xLabel?: string;
  yLabel?: string;
  zLabel?: string;
}

/** A monospace pseudocode block. */
export interface CodeElement {
  kind: 'code';
  x: number;
  y: number;
  w: number;
  h: number;
  language?: string;
  code: string;
}

/** A single displayed formula, typed as Unicode text. */
export interface FormulaElement {
  kind: 'formula';
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

export type FlowShapeKind = 'rect' | 'rounded' | 'diamond' | 'ellipse' | 'parallelogram';

/**
 * A flowchart node. First-class because hand-placing four corners and a
 * separate label is exactly how flowcharts end up with overlapping text, a
 * missing side or four identical "different" symbols.
 *
 * `x`/`y` is the top-left corner and `w`/`h` the size, all in plain (0–100)
 * coordinates. Text is centred inside the shape.
 */
export interface ShapeElement {
  kind: 'shape';
  shape: FlowShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  color?: string;
  fill?: boolean;
}

export type FigureElement =
  | PlotElement
  | LineElement
  | PointElement
  | CircleElement
  | PolygonElement
  | ArcElement
  | LabelElement
  | BarElement
  | TableElement
  | PieElement
  | ShapeElement
  | ChartElement
  | GraphElement
  | MapElement
  | CircuitElement
  | MoleculeElement
  | MusicElement
  | TimelineElement
  | ApparatusElement
  | Surface3DElement
  | CodeElement
  | FormulaElement;

/** Elements that draw their own axes/geometry on the plain percentage canvas. */
const COMPOUND_ELEMENTS = new Set<FigureElement['kind']>([
  'table',
  'pie',
  'shape',
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

export interface FigureSpec {
  v: 1;
  title?: string;
  width: number;
  height: number;
  coords: FigureCoords;
  x: FigureAxis;
  y: FigureAxis;
  grid: boolean;
  elements: FigureElement[];
}

export const FIGURE_VERSION = 1;
export const MAX_FIGURE_ELEMENTS = 60;
export const MAX_FIGURE_TEXT = 80;
export const MAX_FIGURE_EXPRESSION = 160;
export const MAX_FIGURE_BYTES = 24_000;
export const MAX_FIGURE_POINTS = 400;
export const MIN_FIGURE_WIDTH = 160;
export const MAX_FIGURE_WIDTH = 960;
export const MIN_FIGURE_HEIGHT = 100;
export const MAX_FIGURE_HEIGHT = 640;
const MAX_ABS_VALUE = 1_000_000;
const DEFAULT_PLOT_SAMPLES = 240;

/** Colour names are resolved against the app's theme tokens when rendered. */
const NAMED_COLORS: Record<string, string> = {
  // CSS variables keep the figure themed in the app; the literal fallback keeps
  // it visible in an exported/standalone SVG with no theme stylesheet.
  accent: 'var(--accent, #2f5d4e)',
  ink: 'var(--ink, #1b1a16)',
  muted: 'var(--ink-3, #7d7667)',
  ok: 'var(--ok, #2b6749)',
  warn: 'var(--warn, #86621a)',
  bad: 'var(--bad, #9a3b2c)',
};

/** Only the colours a spec is allowed to name; hex is accepted verbatim. */
export function resolveFigureColor(value: unknown, fallback = 'accent'): string {
  if (typeof value !== 'string') return NAMED_COLORS[fallback] ?? fallback;
  const key = value.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, key)) return NAMED_COLORS[key]!;
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/.test(key)) return key;
  return NAMED_COLORS[fallback] ?? fallback;
}

function finite(value: unknown, fallback: number, min = -MAX_ABS_VALUE, max = MAX_ABS_VALUE): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function optionalFinite(value: unknown, min = -MAX_ABS_VALUE, max = MAX_ABS_VALUE): number | undefined {
  if (value === undefined || value === null) return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.min(max, Math.max(min, number));
}

function cleanText(value: unknown, max = MAX_FIGURE_TEXT): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function axisOf(value: unknown, fallbackMin: number, fallbackMax: number): FigureAxis {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  let min = finite(raw.min, fallbackMin);
  let max = finite(raw.max, fallbackMax);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  if (min > max) [min, max] = [max, min];
  const step = optionalFinite(raw.step, 1e-6, Math.abs(max - min));
  const label = cleanText(raw.label, 40);
  return { min, max, ...(step && step > 0 ? { step } : {}), ...(label ? { label } : {}) };
}

function pointsOf(value: unknown): Array<[number, number]> {
  if (!Array.isArray(value)) return [];
  const points: Array<[number, number]> = [];
  for (const item of value.slice(0, 60)) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const x = optionalFinite(item[0]);
    const y = optionalFinite(item[1]);
    if (x === undefined || y === undefined) continue;
    points.push([x, y]);
  }
  return points;
}

/**
 * Bounds for the structured data inside a compound element. They are separate
 * from MAX_FIGURE_ELEMENTS because one chart can contain many marks without
 * turning into hundreds of individually placed elements.
 */
const MAX_CHART_SERIES = 8;
const MAX_CHART_VALUES = 40;
const MAX_CHART_WORDS = 40;
const MAX_CHART_TASKS = 20;
const MAX_GRAPH_NODES = 24;
const MAX_GRAPH_EDGES = 40;
const MAX_MAP_REGIONS = 20;
const MAX_MAP_LINES = 16;
const MAX_MAP_POINTS = 30;
const MAX_CIRCUIT_PARTS = 24;
const MAX_CIRCUIT_WIRES = 24;
const MAX_MOLECULE_GROUPS = 4;
const MAX_MOLECULE_ATOMS = 40;
const MAX_MOLECULE_BONDS = 60;
const MAX_MUSIC_NOTES = 64;
const MAX_TIMELINE_ITEMS = 24;
const MAX_APPARATUS_PARTS = 24;
const MAX_SURFACE_CELLS = 21;

const CHART_VARIANTS: readonly ChartVariant[] = [
  'bar',
  'line',
  'scatter',
  'bubble',
  'area',
  'errorbar',
  'box',
  'violin',
  'radar',
  'gauge',
  'funnel',
  'heatmap',
  'polar',
  'vector',
  'waterfall',
  'population',
  'wordcloud',
  'treemap',
  'sunburst',
  'sankey',
  'chord',
  'gantt',
  'scatter-matrix',
  'phase',
  'contour',
  'dual',
];

const GRAPH_SHAPES: readonly GraphNodeShape[] = [
  'rect',
  'rounded',
  'diamond',
  'ellipse',
  'parallelogram',
  'class',
  'entity',
  'person',
];

const CIRCUIT_PART_TYPES: readonly CircuitPartType[] = [
  'battery',
  'cell',
  'resistor',
  'capacitor',
  'lamp',
  'switch',
  'ammeter',
  'voltmeter',
  'inductor',
  'diode',
  'motor',
  'ground',
  'junction',
];

const APPARATUS_PART_TYPES: readonly ApparatusPartType[] = [
  'beaker',
  'flask',
  'test-tube',
  'burner',
  'lens',
  'prism',
  'mirror',
  'spring',
  'pulley',
  'incline',
  'block',
  'battery',
  'meter',
  'lamp',
  'screen',
  'box',
  'arrow',
  'label',
];

function listOf(value: unknown, max: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function numberList(value: unknown, max = MAX_CHART_VALUES): number[] {
  const output: number[] = [];
  for (const item of listOf(value, max)) {
    const number = optionalFinite(item);
    if (number !== undefined) output.push(number);
  }
  return output;
}

function pairOf(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = optionalFinite(value[0]);
  const y = optionalFinite(value[1]);
  return x !== undefined && y !== undefined ? [x, y] : null;
}

function polylineOf(value: unknown, max = 40): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (const item of listOf(value, max)) {
    const pair = pairOf(item);
    if (pair) points.push(pair);
  }
  return points;
}

function readChartSeries(raw: unknown): ChartSeries | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const name = cleanText(item.name, 40) || undefined;
  const color = typeof item.color === 'string' ? item.color : undefined;
  const values = Array.isArray(item.values) ? numberList(item.values) : undefined;
  const points: ChartPoint[] = [];
  for (const candidate of listOf(item.points, MAX_CHART_VALUES)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const point = candidate as Record<string, unknown>;
    const x = optionalFinite(point.x);
    const y = optionalFinite(point.y);
    if (x === undefined || y === undefined) continue;
    const r = optionalFinite(point.r, 0.01, 1000);
    const label = cleanText(point.label, 30);
    points.push({ x, y, ...(r !== undefined ? { r } : {}), ...(label ? { label } : {}) });
  }
  const summary: [number, number, number, number, number] | undefined = (() => {
    const rawSummary = listOf(item.summary, 5).map((entry) => optionalFinite(entry));
    if (rawSummary.length !== 5 || rawSummary.some((entry) => entry === undefined)) return undefined;
    const five = rawSummary as number[];
    return [five[0]!, five[1]!, five[2]!, five[3]!, five[4]!];
  })();
  const errors: Array<[number, number]> = [];
  for (const entry of listOf(item.errors, MAX_CHART_VALUES)) {
    const pair = pairOf(entry);
    if (pair) errors.push(pair);
  }
  const lines: Array<Array<[number, number]>> = [];
  for (const entry of listOf(item.lines, 12)) {
    const line = polylineOf(entry);
    if (line.length >= 2) lines.push(line);
  }
  const vectors: Array<{ x: number; y: number; dx: number; dy: number }> = [];
  for (const candidate of listOf(item.vectors, MAX_CHART_VALUES)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const vector = candidate as Record<string, unknown>;
    const x = optionalFinite(vector.x);
    const y = optionalFinite(vector.y);
    const dx = optionalFinite(vector.dx);
    const dy = optionalFinite(vector.dy);
    if (x === undefined || y === undefined || dx === undefined || dy === undefined) continue;
    vectors.push({ x, y, dx, dy });
  }
  if (!values && points.length === 0 && !summary && lines.length === 0 && vectors.length === 0) {
    return null;
  }
  return {
    ...(name ? { name } : {}),
    ...(values ? { values } : {}),
    ...(points.length > 0 ? { points } : {}),
    ...(color ? { color } : {}),
    ...(summary ? { summary } : {}),
    ...(errors.length > 0 ? { errors } : {}),
    ...(lines.length > 0 ? { lines } : {}),
    ...(vectors.length > 0 ? { vectors } : {}),
  };
}

function parseChartElement(item: Record<string, unknown>): ChartElement | null {
  const variant =
    typeof item.variant === 'string' && CHART_VARIANTS.includes(item.variant as ChartVariant)
      ? (item.variant as ChartVariant)
      : null;
  if (!variant) return null;
  const x = optionalFinite(item.x, 0, 100);
  const y = optionalFinite(item.y, 0, 100);
  const w = optionalFinite(item.w, 1, 100);
  const h = optionalFinite(item.h, 1, 100);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return null;

  const categories = listOf(item.categories, 16)
    .map((entry) => cleanText(entry, 40))
    .filter(Boolean);
  const series: ChartSeries[] = [];
  for (const entry of listOf(item.series, MAX_CHART_SERIES)) {
    const parsed = readChartSeries(entry);
    if (parsed) series.push(parsed);
  }
  const words: Array<{ text: string; weight: number }> = [];
  for (const entry of listOf(item.words, MAX_CHART_WORDS)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const word = entry as Record<string, unknown>;
    const text = cleanText(word.text ?? word.word, 40);
    const weight = optionalFinite(word.weight ?? word.value, 0.01, 1000);
    if (text && weight !== undefined) words.push({ text, weight });
  }
  const tasks: Array<{ label: string; start: number; end: number; color?: string }> = [];
  for (const entry of listOf(item.tasks, MAX_CHART_TASKS)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const task = entry as Record<string, unknown>;
    const label = cleanText(task.label ?? task.name, 40);
    const start = optionalFinite(task.start);
    const end = optionalFinite(task.end);
    if (!label || start === undefined || end === undefined) continue;
    const color = typeof task.color === 'string' ? task.color : undefined;
    tasks.push({ label, start, end: Math.max(start, end), ...(color ? { color } : {}) });
  }
  const nodes: Array<{ id: string; label?: string; value?: number }> = [];
  const seenNodes = new Set<string>();
  for (const entry of listOf(item.nodes, 20)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const node = entry as Record<string, unknown>;
    const id = cleanText(node.id, 24);
    if (!id || seenNodes.has(id)) continue;
    seenNodes.add(id);
    const label = cleanText(node.label ?? node.text, 40);
    const value = optionalFinite(node.value);
    nodes.push({ id, ...(label ? { label } : {}), ...(value !== undefined ? { value } : {}) });
  }
  const links: Array<{ from: string; to: string; value: number }> = [];
  for (const entry of listOf(item.links, 30)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const link = entry as Record<string, unknown>;
    const from = cleanText(link.from ?? link.source, 24);
    const to = cleanText(link.to ?? link.target, 24);
    const value = optionalFinite(link.value, 0.0001, MAX_ABS_VALUE);
    if (!from || !to || value === undefined || !seenNodes.has(from) || !seenNodes.has(to)) continue;
    links.push({ from, to, value });
  }

  if (
    series.length === 0 &&
    words.length === 0 &&
    tasks.length === 0 &&
    nodes.length === 0 &&
    links.length === 0
  ) {
    return null;
  }

  const min = optionalFinite(item.min);
  const max = optionalFinite(item.max);
  const xLabel = cleanText(item.xLabel, 40);
  const yLabel = cleanText(item.yLabel, 40);
  const unit = cleanText(item.unit, 20);
  return {
    kind: 'chart',
    variant,
    x,
    y,
    w,
    h,
    ...(categories.length > 0 ? { categories } : {}),
    ...(series.length > 0 ? { series } : {}),
    ...(words.length > 0 ? { words } : {}),
    ...(tasks.length > 0 ? { tasks } : {}),
    ...(nodes.length > 0 ? { nodes } : {}),
    ...(links.length > 0 ? { links } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(xLabel ? { xLabel } : {}),
    ...(yLabel ? { yLabel } : {}),
    ...(unit ? { unit } : {}),
  };
}

function parseGraphElement(item: Record<string, unknown>): GraphElement | null {
  const nodes: GraphNode[] = [];
  const seen = new Set<string>();
  for (const entry of listOf(item.nodes, MAX_GRAPH_NODES)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const node = entry as Record<string, unknown>;
    const id = cleanText(node.id ?? node.name, 24);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const text = cleanText(node.text ?? node.label ?? node.name, 60) || id;
    const shapeName = typeof node.shape === 'string' ? node.shape : '';
    const shape = GRAPH_SHAPES.includes(shapeName as GraphNodeShape)
      ? (shapeName as GraphNodeShape)
      : undefined;
    const group = cleanText(node.group, 30);
    nodes.push({ id, text, ...(shape ? { shape } : {}), ...(group ? { group } : {}) });
  }
  if (nodes.length === 0) return null;

  const edges: GraphEdge[] = [];
  for (const entry of listOf(item.edges, MAX_GRAPH_EDGES)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const edge = entry as Record<string, unknown>;
    const from = cleanText(edge.from ?? edge.source, 24);
    const to = cleanText(edge.to ?? edge.target, 24);
    if (!from || !to || from === to || !seen.has(from) || !seen.has(to)) continue;
    const label = cleanText(edge.label, 40);
    const kindName = typeof edge.kind === 'string' ? edge.kind : '';
    const kind = ['association', 'inheritance', 'composition', 'aggregation'].includes(kindName)
      ? (kindName as GraphEdge['kind'])
      : undefined;
    edges.push({
      from,
      to,
      ...(label ? { label } : {}),
      ...(edge.dashed === true ? { dashed: true } : {}),
      ...(edge.arrow === false ? { arrow: false } : {}),
      ...(kind ? { kind } : {}),
    });
  }
  // A pile of unconnected boxes is a symbol chart, not a graph. Requiring one
  // edge also stops the decoration gate from being bypassed by a new element.
  if (edges.length === 0) return null;

  const layoutName = typeof item.layout === 'string' ? item.layout : '';
  const layout = ['layered', 'tree', 'radial', 'network'].includes(layoutName)
    ? (layoutName as GraphLayout)
    : undefined;
  const direction = item.direction === 'LR' ? 'LR' : item.direction === 'TD' ? 'TD' : undefined;
  const x = optionalFinite(item.x, 0, 100) ?? 0;
  const y = optionalFinite(item.y, 0, 100) ?? 0;
  const w = optionalFinite(item.w, 1, 100) ?? 100;
  const h = optionalFinite(item.h, 1, 100) ?? 100;
  return {
    kind: 'graph',
    x,
    y,
    w,
    h,
    ...(layout ? { layout } : {}),
    ...(direction ? { direction } : {}),
    nodes,
    edges,
  };
}

function parseMapElement(item: Record<string, unknown>): MapElement | null {
  const x = optionalFinite(item.x, 0, 100);
  const y = optionalFinite(item.y, 0, 100);
  const w = optionalFinite(item.w, 1, 100);
  const h = optionalFinite(item.h, 1, 100);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return null;

  const regions: MapRegion[] = [];
  for (const entry of listOf(item.regions, MAX_MAP_REGIONS)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const region = entry as Record<string, unknown>;
    const points = polylineOf(region.points, 80);
    if (points.length < 3) continue;
    const label = cleanText(region.label, 40);
    const value = optionalFinite(region.value);
    const color = typeof region.color === 'string' ? region.color : undefined;
    regions.push({
      points,
      ...(label ? { label } : {}),
      ...(value !== undefined ? { value } : {}),
      ...(color ? { color } : {}),
    });
  }

  const readLines = (value: unknown): MapLine[] => {
    const lines: MapLine[] = [];
    for (const entry of listOf(value, MAX_MAP_LINES)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const line = entry as Record<string, unknown>;
      const points = polylineOf(line.points, 80);
      if (points.length < 2) continue;
      const label = cleanText(line.label, 40);
      const color = typeof line.color === 'string' ? line.color : undefined;
      lines.push({
        points,
        ...(label ? { label } : {}),
        ...(line.dashed === true ? { dashed: true } : {}),
        ...(line.arrow === true ? { arrow: true } : {}),
        ...(color ? { color } : {}),
      });
    }
    return lines;
  };

  const points: MapPoint[] = [];
  for (const entry of listOf(item.points, MAX_MAP_POINTS)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const point = entry as Record<string, unknown>;
    const px = optionalFinite(point.x, 0, 100);
    const py = optionalFinite(point.y, 0, 100);
    if (px === undefined || py === undefined) continue;
    const label = cleanText(point.label, 40);
    const kindName = typeof point.kind === 'string' ? point.kind : '';
    const kind = ['city', 'capital', 'site', 'battle'].includes(kindName)
      ? (kindName as MapPoint['kind'])
      : undefined;
    points.push({ x: px, y: py, ...(label ? { label } : {}), ...(kind ? { kind } : {}) });
  }

  const layers: MapRegion[] = [];
  for (const entry of listOf(item.layers, MAX_MAP_REGIONS)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const layer = entry as Record<string, unknown>;
    const points = polylineOf(layer.points, 80);
    if (points.length < 3) continue;
    const label = cleanText(layer.label, 40);
    const color = typeof layer.color === 'string' ? layer.color : undefined;
    layers.push({ points, ...(label ? { label } : {}), ...(color ? { color } : {}) });
  }

  const arrows: Array<{ x1: number; y1: number; x2: number; y2: number; label?: string; color?: string }> = [];
  for (const entry of listOf(item.arrows, MAX_MAP_LINES)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const arrow = entry as Record<string, unknown>;
    const x1 = optionalFinite(arrow.x1, 0, 100);
    const y1 = optionalFinite(arrow.y1, 0, 100);
    const x2 = optionalFinite(arrow.x2, 0, 100);
    const y2 = optionalFinite(arrow.y2, 0, 100);
    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) continue;
    const label = cleanText(arrow.label, 40);
    const color = typeof arrow.color === 'string' ? arrow.color : undefined;
    arrows.push({ x1, y1, x2, y2, ...(label ? { label } : {}), ...(color ? { color } : {}) });
  }

  const modeName = typeof item.mode === 'string' ? item.mode : '';
  const mode = ['map', 'contour', 'cross-section', 'route', 'urban', 'historical', 'tactics'].includes(
    modeName,
  )
    ? (modeName as MapMode)
    : undefined;

  if (
    regions.length === 0 &&
    points.length === 0 &&
    layers.length === 0 &&
    arrows.length === 0 &&
    readLines(item.routes).length === 0 &&
    readLines(item.contours).length === 0
  ) {
    return null;
  }

  const routes = readLines(item.routes);
  const contours = readLines(item.contours);
  const scale = cleanText(item.scale, 30);
  return {
    kind: 'map',
    x,
    y,
    w,
    h,
    ...(mode ? { mode } : {}),
    ...(regions.length > 0 ? { regions } : {}),
    ...(routes.length > 0 ? { routes } : {}),
    ...(points.length > 0 ? { points } : {}),
    ...(contours.length > 0 ? { contours } : {}),
    ...(layers.length > 0 ? { layers } : {}),
    ...(arrows.length > 0 ? { arrows } : {}),
    ...(scale ? { scale } : {}),
  };
}

function parseCircuitElement(item: Record<string, unknown>): CircuitElement | null {
  const x = optionalFinite(item.x, 0, 100);
  const y = optionalFinite(item.y, 0, 100);
  const w = optionalFinite(item.w, 1, 100);
  const h = optionalFinite(item.h, 1, 100);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return null;
  const parts: CircuitPart[] = [];
  for (const entry of listOf(item.parts, MAX_CIRCUIT_PARTS)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const part = entry as Record<string, unknown>;
    const typeName = typeof part.type === 'string' ? part.type : '';
    if (!CIRCUIT_PART_TYPES.includes(typeName as CircuitPartType)) continue;
    const px = optionalFinite(part.x, 0, 100);
    const py = optionalFinite(part.y, 0, 100);
    if (px === undefined || py === undefined) continue;
    const rotation = part.rotation === 90 || part.rotation === 180 || part.rotation === 270 ? part.rotation : 0;
    const label = cleanText(part.label, 30);
    const value = cleanText(part.value, 30);
    parts.push({
      type: typeName as CircuitPartType,
      x: px,
      y: py,
      ...(rotation ? { rotation } : {}),
      ...(label ? { label } : {}),
      ...(value ? { value } : {}),
    });
  }
  if (parts.length === 0) return null;
  const wires: CircuitWire[] = [];
  for (const entry of listOf(item.wires, MAX_CIRCUIT_WIRES)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const wire = entry as Record<string, unknown>;
    const points = polylineOf(wire.points, 40);
    if (points.length >= 2) wires.push({ points });
  }
  return { kind: 'circuit', x, y, w, h, parts, wires };
}

function parseMoleculeGroup(raw: unknown): MoleculeGroup | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const atoms: MoleculeAtom[] = [];
  for (const entry of listOf(item.atoms, MAX_MOLECULE_ATOMS)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const atom = entry as Record<string, unknown>;
    const element = cleanText(atom.element ?? atom.symbol ?? atom.label, 6);
    const x = optionalFinite(atom.x, 0, 100);
    const y = optionalFinite(atom.y, 0, 100);
    if (!element || x === undefined || y === undefined) continue;
    const label = cleanText(atom.label, 10);
    const charge = cleanText(atom.charge, 6);
    atoms.push({ element, x, y, ...(label ? { label } : {}), ...(charge ? { charge } : {}) });
  }
  if (atoms.length === 0) return null;
  const bonds: MoleculeBond[] = [];
  for (const entry of listOf(item.bonds, MAX_MOLECULE_BONDS)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const bond = entry as Record<string, unknown>;
    const from = optionalFinite(bond.from, 0, atoms.length - 1);
    const to = optionalFinite(bond.to, 0, atoms.length - 1);
    if (from === undefined || to === undefined || from === to) continue;
    const order = bond.order === 2 || bond.order === 3 ? bond.order : 1;
    bonds.push({ from: Math.round(from), to: Math.round(to), ...(order !== 1 ? { order } : {}) });
  }
  const label = cleanText(item.label, 40);
  return { atoms, bonds, ...(label ? { label } : {}) };
}

function parseMoleculeElement(item: Record<string, unknown>): MoleculeElement | null {
  const x = optionalFinite(item.x, 0, 100);
  const y = optionalFinite(item.y, 0, 100);
  const w = optionalFinite(item.w, 1, 100);
  const h = optionalFinite(item.h, 1, 100);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return null;
  const groups: MoleculeGroup[] = [];
  for (const entry of listOf(item.groups, MAX_MOLECULE_GROUPS)) {
    const group = parseMoleculeGroup(entry);
    if (group) groups.push(group);
  }
  const levels: Array<{ energy: number; label?: string; electrons?: number }> = [];
  for (const entry of listOf(item.levels, 12)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const level = entry as Record<string, unknown>;
    const energy = optionalFinite(level.energy, -MAX_ABS_VALUE, MAX_ABS_VALUE);
    if (energy === undefined) continue;
    const label = cleanText(level.label, 30);
    const electrons = optionalFinite(level.electrons, 0, 20);
    levels.push({
      energy,
      ...(label ? { label } : {}),
      ...(electrons !== undefined ? { electrons: Math.round(electrons) } : {}),
    });
  }
  const modeName = typeof item.mode === 'string' ? item.mode : '';
  const mode = ['structure', 'reaction', 'crystal', 'orbital'].includes(modeName)
    ? (modeName as MoleculeMode)
    : undefined;
  if (groups.length === 0 && levels.length === 0) return null;
  const arrowLabel = cleanText(item.arrowLabel, 40);
  return {
    kind: 'molecule',
    x,
    y,
    w,
    h,
    ...(mode ? { mode } : {}),
    ...(groups.length > 0 ? { groups } : {}),
    ...(levels.length > 0 ? { levels } : {}),
    ...(arrowLabel ? { arrowLabel } : {}),
  };
}

function parseMusicElement(item: Record<string, unknown>): MusicElement | null {
  const x = optionalFinite(item.x, 0, 100);
  const y = optionalFinite(item.y, 0, 100);
  const w = optionalFinite(item.w, 1, 100);
  const h = optionalFinite(item.h, 1, 100);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return null;
  const notes: MusicNote[] = [];
  for (const entry of listOf(item.notes, MAX_MUSIC_NOTES)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const note = entry as Record<string, unknown>;
    if (note.rest === true) {
      const duration = optionalFinite(note.duration, 0.25, 8);
      notes.push({ pitch: 'R', rest: true, ...(duration !== undefined ? { duration } : {}) });
      continue;
    }
    const pitch = cleanText(note.pitch ?? note.name, 8);
    if (!pitch) continue;
    const duration = optionalFinite(note.duration, 0.25, 8);
    const accidental =
      note.accidental === '#' || note.accidental === 'b' || note.accidental === 'n'
        ? note.accidental
        : undefined;
    notes.push({ pitch, ...(duration !== undefined ? { duration } : {}), ...(accidental ? { accidental } : {}) });
  }
  if (notes.length === 0) return null;
  const clef = item.clef === 'bass' ? 'bass' : 'treble';
  const key = cleanText(item.key, 10);
  const time = cleanText(item.time, 10);
  return { kind: 'music', x, y, w, h, clef, ...(key ? { key } : {}), ...(time ? { time } : {}), notes };
}

function parseTimelineElement(item: Record<string, unknown>): TimelineElement | null {
  const x = optionalFinite(item.x, 0, 100);
  const y = optionalFinite(item.y, 0, 100);
  const w = optionalFinite(item.w, 1, 100);
  const h = optionalFinite(item.h, 1, 100);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return null;
  const events: TimelineEvent[] = [];
  for (const entry of listOf(item.events, MAX_TIMELINE_ITEMS)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const event = entry as Record<string, unknown>;
    const at = optionalFinite(event.at ?? event.year ?? event.time);
    const label = cleanText(event.label ?? event.text, 40);
    if (at === undefined || !label) continue;
    const description = cleanText(event.description, 60);
    events.push({ at, label, ...(description ? { description } : {}) });
  }
  const tasks: TimelineTask[] = [];
  for (const entry of listOf(item.tasks, MAX_TIMELINE_ITEMS)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const task = entry as Record<string, unknown>;
    const label = cleanText(task.label ?? task.name, 40);
    const start = optionalFinite(task.start);
    const end = optionalFinite(task.end);
    if (!label || start === undefined || end === undefined) continue;
    const lane = optionalFinite(task.lane, 0, 20);
    const color = typeof task.color === 'string' ? task.color : undefined;
    tasks.push({
      label,
      start,
      end: Math.max(start, end),
      ...(lane !== undefined ? { lane: Math.round(lane) } : {}),
      ...(color ? { color } : {}),
    });
  }
  if (events.length === 0 && tasks.length === 0) return null;
  const modeName = typeof item.mode === 'string' ? item.mode : '';
  const mode = ['timeline', 'gantt', 'plot'].includes(modeName)
    ? (modeName as TimelineElement['mode'])
    : undefined;
  const min = optionalFinite(item.min);
  const max = optionalFinite(item.max);
  const unit = cleanText(item.unit, 20);
  return {
    kind: 'timeline',
    x,
    y,
    w,
    h,
    ...(mode ? { mode } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(unit ? { unit } : {}),
    ...(events.length > 0 ? { events } : {}),
    ...(tasks.length > 0 ? { tasks } : {}),
  };
}

function parseApparatusElement(item: Record<string, unknown>): ApparatusElement | null {
  const x = optionalFinite(item.x, 0, 100);
  const y = optionalFinite(item.y, 0, 100);
  const w = optionalFinite(item.w, 1, 100);
  const h = optionalFinite(item.h, 1, 100);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return null;
  const parts: ApparatusPart[] = [];
  for (const entry of listOf(item.parts, MAX_APPARATUS_PARTS)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const part = entry as Record<string, unknown>;
    const typeName = typeof part.type === 'string' ? part.type : '';
    if (!APPARATUS_PART_TYPES.includes(typeName as ApparatusPartType)) continue;
    const px = optionalFinite(part.x, 0, 100);
    const py = optionalFinite(part.y, 0, 100);
    if (px === undefined || py === undefined) continue;
    const pw = optionalFinite(part.w, 0.5, 100);
    const ph = optionalFinite(part.h, 0.5, 100);
    const label = cleanText(part.label, 40);
    const rotation = optionalFinite(part.rotation, -360, 360);
    parts.push({
      type: typeName as ApparatusPartType,
      x: px,
      y: py,
      ...(pw !== undefined ? { w: pw } : {}),
      ...(ph !== undefined ? { h: ph } : {}),
      ...(label ? { label } : {}),
      ...(rotation !== undefined ? { rotation } : {}),
    });
  }
  if (parts.length === 0) return null;
  const connections: Array<{ from: number; to: number; dashed?: boolean; arrow?: boolean }> = [];
  for (const entry of listOf(item.connections, 40)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const connection = entry as Record<string, unknown>;
    const from = optionalFinite(connection.from, 0, parts.length - 1);
    const to = optionalFinite(connection.to, 0, parts.length - 1);
    if (from === undefined || to === undefined || from === to) continue;
    connections.push({
      from: Math.round(from),
      to: Math.round(to),
      ...(connection.dashed === true ? { dashed: true } : {}),
      ...(connection.arrow === true ? { arrow: true } : {}),
    });
  }
  return { kind: 'apparatus', x, y, w, h, parts, ...(connections.length > 0 ? { connections } : {}) };
}

function parseSurface3DElement(item: Record<string, unknown>): Surface3DElement | null {
  const x = optionalFinite(item.x, 0, 100);
  const y = optionalFinite(item.y, 0, 100);
  const w = optionalFinite(item.w, 1, 100);
  const h = optionalFinite(item.h, 1, 100);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return null;
  let z: number[][] | undefined;
  if (Array.isArray(item.z)) {
    const rows: number[][] = [];
    for (const row of listOf(item.z, MAX_SURFACE_CELLS)) {
      if (!Array.isArray(row)) continue;
      const values = numberList(row, MAX_SURFACE_CELLS);
      if (values.length >= 2) rows.push(values);
    }
    if (rows.length >= 2) z = rows;
  }
  const points: SurfacePoint[] = [];
  for (const entry of listOf(item.points, 40)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const point = entry as Record<string, unknown>;
    const px = optionalFinite(point.x);
    const py = optionalFinite(point.y);
    const pz = optionalFinite(point.z);
    if (px === undefined || py === undefined || pz === undefined) continue;
    const label = cleanText(point.label, 30);
    points.push({ x: px, y: py, z: pz, ...(label ? { label } : {}) });
  }
  if (!z && points.length === 0) return null;
  const xLabel = cleanText(item.xLabel, 20);
  const yLabel = cleanText(item.yLabel, 20);
  const zLabel = cleanText(item.zLabel, 20);
  return {
    kind: 'surface3d',
    x,
    y,
    w,
    h,
    ...(z ? { z } : {}),
    ...(points.length > 0 ? { points } : {}),
    ...(xLabel ? { xLabel } : {}),
    ...(yLabel ? { yLabel } : {}),
    ...(zLabel ? { zLabel } : {}),
  };
}

function parseCodeElement(item: Record<string, unknown>): CodeElement | null {
  const x = optionalFinite(item.x, 0, 100);
  const y = optionalFinite(item.y, 0, 100);
  const w = optionalFinite(item.w, 1, 100);
  const h = optionalFinite(item.h, 1, 100);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return null;
  if (typeof item.code !== 'string') return null;
  const code = item.code.replace(/\r/g, '').split('\n').slice(0, 40).join('\n').slice(0, 2400).trim();
  if (!code) return null;
  const language = cleanText(item.language, 20);
  return { kind: 'code', x, y, w, h, ...(language ? { language } : {}), code };
}

function parseFormulaElement(item: Record<string, unknown>): FormulaElement | null {
  const x = optionalFinite(item.x, 0, 100);
  const y = optionalFinite(item.y, 0, 100);
  const w = optionalFinite(item.w, 1, 100);
  const h = optionalFinite(item.h, 1, 100);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return null;
  const text = cleanText(item.text ?? item.latex ?? item.formula, 200);
  if (!text) return null;
  return { kind: 'formula', x, y, w, h, text };
}

function parseElement(raw: unknown): FigureElement | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  // Models occasionally write "type" instead of "kind"; accept both.
  const kind = typeof item.kind === 'string' ? item.kind : typeof item.type === 'string' ? item.type : '';
  const color = typeof item.color === 'string' ? item.color : undefined;
  const width = optionalFinite(item.width, 0.5, 8);

  switch (kind) {
    case 'plot': {
      if (typeof item.expr !== 'string') return null;
      const expr = item.expr.trim().slice(0, MAX_FIGURE_EXPRESSION);
      if (!expr || !compileExpression(expr)) return null;
      const from = optionalFinite(item.from);
      const to = optionalFinite(item.to);
      return {
        kind: 'plot',
        expr,
        ...(from !== undefined ? { from } : {}),
        ...(to !== undefined ? { to } : {}),
        ...(color ? { color } : {}),
        ...(width !== undefined ? { width } : {}),
        ...(item.dashed === true ? { dashed: true } : {}),
      };
    }
    case 'line': {
      const from = pointsOf([item.from])[0];
      const to = pointsOf([item.to])[0];
      const x1 = optionalFinite(item.x1) ?? from?.[0];
      const y1 = optionalFinite(item.y1) ?? from?.[1];
      const x2 = optionalFinite(item.x2) ?? to?.[0];
      const y2 = optionalFinite(item.y2) ?? to?.[1];
      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return null;
      return {
        kind: 'line',
        x1,
        y1,
        x2,
        y2,
        ...(color ? { color } : {}),
        ...(width !== undefined ? { width } : {}),
        ...(item.dashed === true ? { dashed: true } : {}),
        ...(item.arrow === true ? { arrow: true } : {}),
      };
    }
    case 'point': {
      const x = optionalFinite(item.x);
      const y = optionalFinite(item.y);
      if (x === undefined || y === undefined) return null;
      const r = optionalFinite(item.r, 0.5, 20);
      const label = cleanText(item.label, 40);
      return {
        kind: 'point',
        x,
        y,
        ...(r !== undefined ? { r } : {}),
        ...(label ? { label } : {}),
        ...(color ? { color } : {}),
      };
    }
    case 'circle': {
      const x = optionalFinite(item.x);
      const y = optionalFinite(item.y);
      const r = optionalFinite(item.r, 0.01, MAX_ABS_VALUE);
      if (x === undefined || y === undefined || r === undefined) return null;
      return {
        kind: 'circle',
        x,
        y,
        r,
        ...(color ? { color } : {}),
        ...(item.fill === true ? { fill: true } : {}),
      };
    }
    case 'polygon': {
      const points = pointsOf(item.points);
      if (points.length < 3) return null;
      return {
        kind: 'polygon',
        points,
        ...(color ? { color } : {}),
        ...(item.fill === true ? { fill: true } : {}),
      };
    }
    case 'arc': {
      const x = optionalFinite(item.x);
      const y = optionalFinite(item.y);
      const r = optionalFinite(item.r, 0.01, MAX_ABS_VALUE);
      if (x === undefined || y === undefined || r === undefined) return null;
      return {
        kind: 'arc',
        x,
        y,
        r,
        from: finite(item.from, 0, -3600, 3600),
        to: finite(item.to, 90, -3600, 3600),
        ...(color ? { color } : {}),
        ...(width !== undefined ? { width } : {}),
      };
    }
    case 'label': {
      const x = optionalFinite(item.x);
      const y = optionalFinite(item.y);
      const text = cleanText(item.text ?? item.label);
      if (x === undefined || y === undefined || !text) return null;
      const size = optionalFinite(item.size, 7, 28);
      const anchor =
        item.anchor === 'start' || item.anchor === 'middle' || item.anchor === 'end' ? item.anchor : undefined;
      return {
        kind: 'label',
        x,
        y,
        text,
        ...(color ? { color } : {}),
        ...(size !== undefined ? { size } : {}),
        ...(anchor ? { anchor } : {}),
      };
    }
    case 'bar': {
      const x = optionalFinite(item.x);
      const y = optionalFinite(item.y);
      const w = optionalFinite(item.w, -MAX_ABS_VALUE, MAX_ABS_VALUE);
      const h = optionalFinite(item.h, -MAX_ABS_VALUE, MAX_ABS_VALUE);
      if (x === undefined || y === undefined || w === undefined || h === undefined) return null;
      return { kind: 'bar', x, y, w, h, ...(color ? { color } : {}) };
    }
    case 'table': {
      const x = optionalFinite(item.x);
      const y = optionalFinite(item.y);
      if (x === undefined || y === undefined) return null;
      const columns = Array.isArray(item.columns)
        ? item.columns.map((value) => cleanText(value, 40)).filter(Boolean).slice(0, 8)
        : [];
      if (columns.length === 0) return null;
      const rawRows = Array.isArray(item.rows) ? item.rows.slice(0, 12) : [];
      const rows: string[][] = [];
      for (const row of rawRows) {
        if (!Array.isArray(row)) continue;
        const cells = columns.map((_, index) => cleanText(row[index], 60));
        if (cells.some(Boolean)) rows.push(cells);
      }
      if (rows.length === 0) return null;
      const w = optionalFinite(item.w, 1, 100) ?? 80;
      const header = item.header !== false;
      const h = optionalFinite(item.h, 1, 100) ?? Math.min(80, (rows.length + (header ? 1 : 0)) * 7);
      if (w <= 0 || h <= 0) return null;
      return {
        kind: 'table',
        x,
        y,
        w,
        h,
        columns,
        rows,
        ...(header ? {} : { header: false }),
      };
    }
    case 'pie': {
      const x = optionalFinite(item.x);
      const y = optionalFinite(item.y);
      const r = optionalFinite(item.r, 1, 50);
      if (x === undefined || y === undefined || r === undefined) return null;
      const rawSlices = Array.isArray(item.slices) ? item.slices.slice(0, 12) : [];
      const slices: PieSlice[] = [];
      for (const raw of rawSlices) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const slice = raw as Record<string, unknown>;
        const value = optionalFinite(slice.value, 0.0001, MAX_ABS_VALUE);
        if (value === undefined || value <= 0) continue;
        const label = cleanText(slice.label, 40);
        const color = typeof slice.color === 'string' ? slice.color : undefined;
        slices.push({
          value,
          ...(label ? { label } : {}),
          ...(color ? { color } : {}),
        });
      }
      if (slices.length < 2) return null;
      return { kind: 'pie', x, y, r, slices };
    }
    case 'shape': {
      const shapeName =
        typeof item.shape === 'string' ? item.shape : typeof item.variant === 'string' ? item.variant : 'rect';
      const flowShapes: FlowShapeKind[] = ['rect', 'rounded', 'diamond', 'ellipse', 'parallelogram'];
      const shape = flowShapes.includes(shapeName as FlowShapeKind)
        ? (shapeName as FlowShapeKind)
        : null;
      if (!shape) return null;
      const w = optionalFinite(item.w, 0.1, MAX_ABS_VALUE);
      const h = optionalFinite(item.h, 0.1, MAX_ABS_VALUE);
      if (w === undefined || h === undefined || w <= 0 || h <= 0) return null;
      const cx = optionalFinite(item.cx);
      const cy = optionalFinite(item.cy);
      const x = optionalFinite(item.x) ?? (cx !== undefined ? cx - w / 2 : undefined);
      const y = optionalFinite(item.y) ?? (cy !== undefined ? cy - h / 2 : undefined);
      if (x === undefined || y === undefined) return null;
      const text = cleanText(item.text ?? item.label, 60);
      return {
        kind: 'shape',
        shape,
        x,
        y,
        w,
        h,
        ...(text ? { text } : {}),
        ...(color ? { color } : {}),
        ...(item.fill === true ? { fill: true } : {}),
      };
    }
    case 'chart':
      return parseChartElement(item);
    case 'graph':
      return parseGraphElement(item);
    case 'map':
      return parseMapElement(item);
    case 'circuit':
      return parseCircuitElement(item);
    case 'molecule':
      return parseMoleculeElement(item);
    case 'music':
      return parseMusicElement(item);
    case 'timeline':
      return parseTimelineElement(item);
    case 'apparatus':
      return parseApparatusElement(item);
    case 'surface3d':
      return parseSurface3DElement(item);
    case 'code':
      return parseCodeElement(item);
    case 'formula':
      return parseFormulaElement(item);
    default:
      return null;
  }
}

/**
 * Validate and normalise a model-written figure. Returns `null` when nothing
 * usable is left, so the caller can fall back to a photo or no illustration.
 * Unknown keys are dropped, which keeps stored decks forward-compatible.
 */
export function parseFigureSpec(value: unknown): FigureSpec | null {
  let raw = value;
  if (typeof raw === 'string') {
    if (raw.length > MAX_FIGURE_BYTES) return null;
    const text = raw.trim();
    // A bare Mermaid document is accepted as a convenience for plugin authors
    // and for a model that returns the diagram as text instead of an object.
    if (/^(?:flowchart|graph)\b/i.test(text)) {
      return compileFigureFlow(text);
    }
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const object = raw as Record<string, unknown>;
  if (object.v !== undefined && object.v !== FIGURE_VERSION) return null;

  // Flowcharts are described as a graph and laid out here: the author names the
  // steps and arrows, the app decides where the boxes go. `mermaid` is the
  // canonical form; `flow` is the same graph as JSON for models that prefer it.
  if (typeof object.mermaid === 'string') {
    return compileFigureFlow(object.mermaid, {
      width: object.width,
      height: object.height,
      title: object.title,
    });
  }
  if (typeof object.flow === 'string' || (object.flow && typeof object.flow === 'object')) {
    return compileFigureFlow(object.flow, {
      width: object.width,
      height: object.height,
      title: object.title,
    });
  }

  const coords: FigureCoords = object.coords === 'plain' ? 'plain' : 'cartesian';
  const width = Math.round(finite(object.width, coords === 'plain' ? 480 : 420, MIN_FIGURE_WIDTH, MAX_FIGURE_WIDTH));
  const height = Math.round(finite(object.height, coords === 'plain' ? 320 : 280, MIN_FIGURE_HEIGHT, MAX_FIGURE_HEIGHT));
  const x = coords === 'plain' ? axisOf(object.x, 0, 100) : axisOf(object.x, 0, 10);
  const y = coords === 'plain' ? axisOf(object.y, 0, 100) : axisOf(object.y, 0, 10);
  const title = cleanText(object.title);
  const grid = object.grid === true;

  const elements: FigureElement[] = [];
  if (Array.isArray(object.elements)) {
    for (const candidate of object.elements.slice(0, MAX_FIGURE_ELEMENTS)) {
      const element = parseElement(candidate);
      if (!element) continue;
      if (coords === 'plain' && element.kind === 'plot') continue;
      // Every compound renderer owns its own axes and geometry, so it lives on
      // the plain percentage canvas. A cartesian spec may still contain a
      // function plot, a polygon or a bar.
      if (coords === 'cartesian' && COMPOUND_ELEMENTS.has(element.kind)) continue;
      elements.push(element);
    }
  }
  if (elements.length === 0) return null;

  return {
    v: FIGURE_VERSION,
    ...(title ? { title } : {}),
    width,
    height,
    coords,
    x,
    y,
    grid,
    elements: coords === 'plain' ? normalizePlainElements(elements, width, height) : elements,
  };
}

function plainExtents(elements: readonly FigureElement[]): { maxX: number; maxY: number } {
  let maxX = 0;
  let maxY = 0;
  const visit = (x: number, y: number): void => {
    maxX = Math.max(maxX, Math.abs(x));
    maxY = Math.max(maxY, Math.abs(y));
  };
  for (const element of elements) {
    switch (element.kind) {
      case 'line':
        visit(element.x1, element.y1);
        visit(element.x2, element.y2);
        break;
      case 'point':
      case 'circle':
      case 'arc':
      case 'label':
        visit(element.x, element.y);
        break;
      case 'polygon':
        for (const [x, y] of element.points) visit(x, y);
        break;
      case 'bar':
        visit(element.x, element.y);
        visit(element.x + element.w, element.y + element.h);
        break;
      case 'pie':
        visit(element.x - element.r, element.y - element.r);
        visit(element.x + element.r, element.y + element.r);
        break;
      case 'shape':
      case 'table':
      case 'chart':
      case 'map':
      case 'circuit':
      case 'molecule':
      case 'music':
      case 'timeline':
      case 'apparatus':
      case 'surface3d':
      case 'code':
      case 'formula':
        visit(element.x, element.y);
        visit(element.x + element.w, element.y + element.h);
        break;
      case 'graph':
        visit(element.x ?? 0, element.y ?? 0);
        visit((element.x ?? 0) + (element.w ?? 100), (element.y ?? 0) + (element.h ?? 100));
        break;
      default:
        break;
    }
  }
  return { maxX, maxY };
}

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

/**
 * Accept pixel coordinates in a `plain` spec.
 *
 * The documented plain canvas is 0–100 on both axes, but models regularly
 * write 0–width / 0–height instead (a 420×300 canvas gets points like 80,240).
 * Treating those as percentages put most of the drawing outside the viewBox and
 * silently clipped it — a triangle lost a whole leg. If any coordinate exceeds
 * 100, the spec is in pixels; convert it to percentages so the layout is stable
 * and the stored deck is canonical.
 */
function normalizePlainElements(
  elements: readonly FigureElement[],
  width: number,
  height: number,
): FigureElement[] {
  const { maxX, maxY } = plainExtents(elements);
  const pixelX = maxX > 100.5;
  const pixelY = maxY > 100.5;
  if (!pixelX && !pixelY) return [...elements];
  const unit = Math.min(width, height) || 1;
  const nx = (value: number): number => round4(pixelX ? (value / width) * 100 : value);
  const ny = (value: number): number => round4(pixelY ? (value / height) * 100 : value);
  const nr = (value: number): number => round4((value / unit) * 100);

  return elements.map((element): FigureElement => {
    switch (element.kind) {
      case 'line':
        return { ...element, x1: nx(element.x1), y1: ny(element.y1), x2: nx(element.x2), y2: ny(element.y2) };
      case 'point':
        return { ...element, x: nx(element.x), y: ny(element.y) };
      case 'circle':
      case 'arc':
        return { ...element, x: nx(element.x), y: ny(element.y), r: nr(element.r) };
      case 'polygon':
        return {
          ...element,
          points: element.points.map(([x, y]) => [nx(x), ny(y)] as [number, number]),
        };
      case 'label':
        return { ...element, x: nx(element.x), y: ny(element.y) };
      case 'bar':
        return { ...element, x: nx(element.x), y: ny(element.y), w: nx(element.w), h: ny(element.h) };
      case 'pie':
        return { ...element, x: nx(element.x), y: ny(element.y), r: nr(element.r) };
      case 'shape':
      case 'table':
      case 'chart':
      case 'circuit':
      case 'molecule':
      case 'music':
      case 'timeline':
      case 'apparatus':
      case 'surface3d':
      case 'code':
      case 'formula':
        return { ...element, x: nx(element.x), y: ny(element.y), w: nx(element.w), h: ny(element.h) };
      case 'map':
        return {
          ...element,
          x: nx(element.x),
          y: ny(element.y),
          w: nx(element.w),
          h: nx(element.h),
          ...(element.regions
            ? { regions: element.regions.map((region) => ({ ...region, points: region.points.map(([x, y]) => [nx(x), ny(y)] as [number, number]) })) }
            : {}),
          ...(element.layers
            ? { layers: element.layers.map((layer) => ({ ...layer, points: layer.points.map(([x, y]) => [nx(x), ny(y)] as [number, number]) })) }
            : {}),
          ...(element.routes
            ? { routes: element.routes.map((line) => ({ ...line, points: line.points.map(([x, y]) => [nx(x), ny(y)] as [number, number]) })) }
            : {}),
          ...(element.contours
            ? { contours: element.contours.map((line) => ({ ...line, points: line.points.map(([x, y]) => [nx(x), ny(y)] as [number, number]) })) }
            : {}),
          ...(element.points ? { points: element.points.map((point) => ({ ...point, x: nx(point.x), y: ny(point.y) })) } : {}),
          ...(element.arrows
            ? { arrows: element.arrows.map((arrow) => ({ ...arrow, x1: nx(arrow.x1), y1: ny(arrow.y1), x2: nx(arrow.x2), y2: ny(arrow.y2) })) }
            : {}),
        };
      case 'graph':
        return {
          ...element,
          x: nx(element.x ?? 0),
          y: ny(element.y ?? 0),
          w: nx(element.w ?? 100),
          h: ny(element.h ?? 100),
        };
      default:
        return element;
    }
  });
}

/** True when a stored media item is a rendered figure rather than a bitmap. */
export function isFigure(value: unknown): value is { type: 'figure'; figure: FigureSpec; alt?: string } {
  if (!value || typeof value !== 'object') return false;
  const media = value as { type?: unknown; figure?: unknown };
  return media.type === 'figure' && Boolean(parseFigureSpec(media.figure));
}

// ---------------------------------------------------------------------------
// Expression sandbox
// ---------------------------------------------------------------------------

type Token =
  | { type: 'number'; value: number }
  | { type: 'name'; value: string }
  | { type: 'op'; value: string };

type Ast =
  | { type: 'number'; value: number }
  | { type: 'name'; value: string }
  | { type: 'unary'; op: '+' | '-'; operand: Ast }
  | { type: 'binary'; op: string; left: Ast; right: Ast }
  | { type: 'call'; name: string; args: Ast[] };

export interface CompiledExpression {
  /** Evaluate at x. Returns NaN for undefined values instead of throwing. */
  evaluate(x: number): number;
  /** AST size, exposed for tests and diagnostics. */
  nodes: number;
}

function countNodes(ast: Ast): number {
  switch (ast.type) {
    case 'number':
    case 'name':
      return 1;
    case 'unary':
      return 1 + countNodes(ast.operand);
    case 'binary':
      return 1 + countNodes(ast.left) + countNodes(ast.right);
    case 'call':
      return 1 + ast.args.reduce((total, arg) => total + countNodes(arg), 0);
    default:
      return 1;
  }
}

const MAX_AST_NODES = 200;
const MAX_AST_DEPTH = 24;
const MAX_SAMPLES = MAX_FIGURE_POINTS;
const MAX_TICK_COUNT = 40;

const FUNCTIONS: Record<string, { arity: number; apply: (...args: number[]) => number }> = {
  sin: { arity: 1, apply: Math.sin },
  cos: { arity: 1, apply: Math.cos },
  tan: { arity: 1, apply: Math.tan },
  asin: { arity: 1, apply: Math.asin },
  acos: { arity: 1, apply: Math.acos },
  atan: { arity: 1, apply: Math.atan },
  sqrt: { arity: 1, apply: Math.sqrt },
  abs: { arity: 1, apply: Math.abs },
  exp: { arity: 1, apply: Math.exp },
  ln: { arity: 1, apply: Math.log },
  log: { arity: 1, apply: Math.log10 },
  floor: { arity: 1, apply: Math.floor },
  ceil: { arity: 1, apply: Math.ceil },
  round: { arity: 1, apply: Math.round },
  sign: { arity: 1, apply: Math.sign },
  min: { arity: 2, apply: Math.min },
  max: { arity: 2, apply: Math.max },
  pow: { arity: 2, apply: Math.pow },
  atan2: { arity: 2, apply: Math.atan2 },
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
};

class ExpressionError extends Error {}

function normalizeExpression(source: string): string {
  return source
    .replace(/π/g, 'pi')
    .replace(/√/g, 'sqrt')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-');
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char >= '0' && char <= '9') {
      let end = index + 1;
      while (end < source.length && /[0-9.]/.test(source[end]!)) end += 1;
      // Scientific notation: 1e-3, but not the constant e after a number.
      if (source[end] === 'e' || source[end] === 'E') {
        let probe = end + 1;
        if (source[probe] === '+' || source[probe] === '-') probe += 1;
        if (source[probe] && /[0-9]/.test(source[probe]!)) {
          end = probe + 1;
          while (end < source.length && /[0-9]/.test(source[end]!)) end += 1;
        }
      }
      const value = Number(source.slice(index, end));
      if (!Number.isFinite(value)) throw new ExpressionError('bad number');
      tokens.push({ type: 'number', value });
      index = end;
      continue;
    }
    if (char === '.') {
      let end = index + 1;
      while (end < source.length && /[0-9]/.test(source[end]!)) end += 1;
      const value = Number(source.slice(index, end));
      if (!Number.isFinite(value)) throw new ExpressionError('bad number');
      tokens.push({ type: 'number', value });
      index = end;
      continue;
    }
    if (/[a-zA-Z_]/.test(char)) {
      let end = index + 1;
      while (end < source.length && /[a-zA-Z0-9_]/.test(source[end]!)) end += 1;
      tokens.push({ type: 'name', value: source.slice(index, end).toLowerCase() });
      index = end;
      continue;
    }
    if ('+-*/^%(),'.includes(char)) {
      tokens.push({ type: 'op', value: char });
      index += 1;
      continue;
    }
    throw new ExpressionError(`unexpected character "${char}"`);
  }
  return tokens;
}

function compile(source: string): Ast {
  const tokens = tokenize(source);
  let position = 0;
  let nodes = 0;

  const peek = (): Token | undefined => tokens[position];
  const next = (): Token | undefined => tokens[position++];
  const isOp = (value: string): boolean => {
    const token = peek();
    return token?.type === 'op' && token.value === value;
  };
  const count = (): void => {
    nodes += 1;
    if (nodes > MAX_AST_NODES) throw new ExpressionError('expression is too complex');
  };

  const parseExpression = (depth: number): Ast => {
    if (depth > MAX_AST_DEPTH) throw new ExpressionError('expression is nested too deeply');
    let left = parseTerm(depth);
    for (;;) {
      if (isOp('+') || isOp('-')) {
        const op = (next() as { type: 'op'; value: string }).value;
        const right = parseTerm(depth);
        count();
        left = { type: 'binary', op, left, right };
      } else break;
    }
    return left;
  };

  const startsPrimary = (token: Token | undefined): boolean =>
    token !== undefined && (token.type === 'number' || token.type === 'name' || (token.type === 'op' && token.value === '('));

  const parseTerm = (depth: number): Ast => {
    let left = parseUnary(depth);
    for (;;) {
      if (isOp('*') || isOp('/') || isOp('%')) {
        const op = (next() as { type: 'op'; value: string }).value;
        const right = parseUnary(depth);
        count();
        left = { type: 'binary', op, left, right };
      } else if (startsPrimary(peek())) {
        // Implicit multiplication: "2x", "3 sin(x)", "(x+1)(x-1)".
        const right = parseUnary(depth);
        count();
        left = { type: 'binary', op: '*', left, right };
      } else break;
    }
    return left;
  };

  const parseUnary = (depth: number): Ast => {
    if (isOp('+') || isOp('-')) {
      const op = (next() as { type: 'op'; value: '+' | '-' }).value;
      const operand = parseUnary(depth + 1);
      count();
      return { type: 'unary', op, operand };
    }
    return parsePower(depth);
  };

  const parsePower = (depth: number): Ast => {
    const base = parsePrimary(depth);
    if (isOp('^')) {
      next();
      // Right associative, and -x^2 means -(x^2).
      const exponent = parseUnary(depth + 1);
      count();
      return { type: 'binary', op: '^', left: base, right: exponent };
    }
    return base;
  };

  const parsePrimary = (depth: number): Ast => {
    if (depth > MAX_AST_DEPTH) throw new ExpressionError('expression is nested too deeply');
    const token = next();
    if (!token) throw new ExpressionError('unexpected end of expression');
    if (token.type === 'number') {
      count();
      return { type: 'number', value: token.value };
    }
    if (token.type === 'name') {
      const fn = Object.prototype.hasOwnProperty.call(FUNCTIONS, token.value)
        ? FUNCTIONS[token.value]
        : undefined;
      if (isOp('(') && fn) {
        next();
        const args: Ast[] = [];
        if (!isOp(')')) {
          for (;;) {
            args.push(parseExpression(depth + 1));
            if (isOp(',')) {
              next();
              continue;
            }
            break;
          }
        }
        if (!isOp(')')) throw new ExpressionError('missing ")"');
        next();
        if (args.length !== fn.arity) throw new ExpressionError(`"${token.value}" needs ${fn.arity} argument(s)`);
        count();
        return { type: 'call', name: token.value, args };
      }
      if (token.value === 'x' || token.value === 't') {
        count();
        return { type: 'name', value: 'x' };
      }
      const constant = Object.prototype.hasOwnProperty.call(CONSTANTS, token.value)
        ? CONSTANTS[token.value]
        : undefined;
      if (constant === undefined) throw new ExpressionError(`unknown name "${token.value}"`);
      count();
      return { type: 'number', value: constant };
    }
    if (token.value === '(') {
      const inner = parseExpression(depth + 1);
      if (!isOp(')')) throw new ExpressionError('missing ")"');
      next();
      return inner;
    }
    throw new ExpressionError(`unexpected token "${token.value}"`);
  };

  const ast = parseExpression(0);
  if (position !== tokens.length) throw new ExpressionError('unexpected trailing input');
  return ast;
}

function evaluateAst(ast: Ast, x: number): number {
  switch (ast.type) {
    case 'number':
      return ast.value;
    case 'name':
      return x;
    case 'unary':
      return ast.op === '-' ? -evaluateAst(ast.operand, x) : evaluateAst(ast.operand, x);
    case 'binary': {
      const left = evaluateAst(ast.left, x);
      const right = evaluateAst(ast.right, x);
      switch (ast.op) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return right === 0 ? NaN : left / right;
        case '%':
          return right === 0 ? NaN : left % right;
        case '^':
          return left ** right;
        default:
          return NaN;
      }
    }
    case 'call': {
      const fn = FUNCTIONS[ast.name];
      if (!fn) return NaN;
      const args = ast.args.map((arg) => evaluateAst(arg, x));
      const value = fn.apply(...args);
      return Number.isFinite(value) ? value : NaN;
    }
    default:
      return NaN;
  }
}

const expressionCache = new Map<string, CompiledExpression | null>();
const EXPRESSION_CACHE_LIMIT = 256;

/**
 * Compile a model-written formula into a pure function. Returns `null` for
 * anything that is not a small arithmetic expression over `x`.
 */
export function compileExpression(source: string): CompiledExpression | null {
  const normalized = normalizeExpression(source).trim();
  if (!normalized || normalized.length > MAX_FIGURE_EXPRESSION) return null;
  if (expressionCache.has(normalized)) return expressionCache.get(normalized) ?? null;
  let compiled: CompiledExpression | null = null;
  try {
    const ast = compile(normalized);
    // Fail fast if evaluation throws for ordinary inputs; the interpreter
    // itself only returns numbers, but Math.pow can overflow to Infinity.
    evaluateAst(ast, 1);
    compiled = {
      nodes: countNodes(ast),
      evaluate: (x: number) => {
        const value = evaluateAst(ast, x);
        return Number.isFinite(value) ? value : NaN;
      },
    };
  } catch {
    compiled = null;
  }
  if (expressionCache.size >= EXPRESSION_CACHE_LIMIT) expressionCache.clear();
  expressionCache.set(normalized, compiled);
  return compiled;
}

/** Evaluate one formula at one value; `NaN` when the formula is invalid. */
export function evaluateExpression(source: string, x: number): number {
  return compileExpression(source)?.evaluate(x) ?? NaN;
}

export interface PlotSample {
  /** Runs of consecutive finite points; discontinuities start a new run. */
  segments: Array<Array<{ x: number; y: number }>>;
}

/**
 * Sample a formula for drawing. Non-finite results (division by zero, tan at
 * π/2) split the line instead of connecting across the asymptote.
 */
export function samplePlot(
  source: string,
  from: number,
  to: number,
  count = DEFAULT_PLOT_SAMPLES,
): PlotSample | null {
  const expression = compileExpression(source);
  if (!expression) return null;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return null;
  const [min, max] = from < to ? [from, to] : [to, from];
  const samples = Math.max(2, Math.min(MAX_SAMPLES, Math.round(count)));
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < samples; index += 1) {
    const x = min + ((max - min) * index) / (samples - 1);
    const y = expression.evaluate(x);
    if (!Number.isFinite(y)) {
      if (current.length > 1) segments.push(current);
      current = [];
      continue;
    }
    current.push({ x, y });
  }
  if (current.length > 1) segments.push(current);
  return { segments };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface FigurePoint {
  x: number;
  y: number;
}

export type FigureShape =
  | {
      kind: 'line';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
      width: number;
      dash?: string;
    }
  | {
      kind: 'path';
      d: string;
      color: string;
      width: number;
      fill?: string;
      fillOpacity?: number;
      dash?: string;
    }
  | {
      kind: 'circle';
      cx: number;
      cy: number;
      r: number;
      color: string;
      width: number;
      fill?: string;
      fillOpacity?: number;
    }
  | {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      color: string;
      size: number;
      anchor: 'start' | 'middle' | 'end';
      weight?: number;
      mono?: boolean;
    }
  | {
      kind: 'rect';
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
      fill?: string;
      fillOpacity?: number;
      rx?: number;
    }
  | {
      kind: 'ellipse';
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      color: string;
      width: number;
      fill?: string;
      fillOpacity?: number;
    };

export interface FigureDrawing {
  width: number;
  height: number;
  shapes: FigureShape[];
}

const DASH = '5 4';
const PIE_COLORS = ['accent', 'ok', 'warn', 'bad', 'muted'] as const;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatTick(value: number): string {
  const rounded = Number(value.toFixed(6));
  if (Math.abs(rounded) >= 10_000) return rounded.toExponential(1).replace('e+', 'e');
  const text = String(rounded);
  return text === '-0' ? '0' : text;
}

function niceStep(span: number, target = 6): number {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const rough = span / target;
  const power = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / power;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * power;
}

function ticksFor(axis: FigureAxis): number[] {
  const span = axis.max - axis.min;
  const step = axis.step && axis.step > 0 ? axis.step : niceStep(span);
  const values: number[] = [];
  const start = Math.ceil(axis.min / step) * step;
  for (let value = start; value <= axis.max + step * 1e-6 && values.length < MAX_TICK_COUNT; value += step) {
    values.push(round(value, 10));
  }
  return values;
}

function arrowPath(x1: number, y1: number, x2: number, y2: number, color: string): FigureShape[] {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const length = 8;
  const spread = Math.PI / 7;
  const tipX = x2;
  const tipY = y2;
  const leftX = tipX - length * Math.cos(angle - spread);
  const leftY = tipY - length * Math.sin(angle - spread);
  const rightX = tipX - length * Math.cos(angle + spread);
  const rightY = tipY - length * Math.sin(angle + spread);
  return [
    {
      kind: 'path',
      d: `M ${round(leftX)} ${round(leftY)} L ${round(tipX)} ${round(tipY)} L ${round(rightX)} ${round(rightY)}`,
      color,
      width: 1.6,
      fill: 'none',
    },
  ];
}

/**
 * Turn a validated spec into pixel-space shapes. Pure and deterministic, so
 * the same figure looks identical in Generate, Practice, print and export.
 */
export function layoutFigure(spec: FigureSpec): FigureDrawing {
  const width = spec.width;
  const height = spec.height;
  const shapes: FigureShape[] = [];
  const cartesian = spec.coords === 'cartesian';
  const padLeft = cartesian ? 44 : 0;
  const padRight = cartesian ? 18 : 0;
  // The title is rendered as an HTML caption above the SVG, so it can never
  // collide with a node or a label that sits at the top of the canvas.
  const padTop = cartesian ? 20 : 0;
  const padBottom = cartesian ? 34 : 0;
  const plotWidth = Math.max(1, width - padLeft - padRight);
  const plotHeight = Math.max(1, height - padTop - padBottom);
  const xSpan = spec.x.max - spec.x.min || 1;
  const ySpan = spec.y.max - spec.y.min || 1;

  const mapX = (x: number): number =>
    cartesian ? padLeft + ((x - spec.x.min) / xSpan) * plotWidth : (x / 100) * width;
  const mapY = (y: number): number =>
    cartesian
      ? padTop + plotHeight - ((y - spec.y.min) / ySpan) * plotHeight
      : (y / 100) * height;

  const renderContext = {
    width,
    height,
    plain: !cartesian,
    mapX,
    mapY,
    color: resolveFigureColor,
  };

  if (cartesian) {
    const xTicks = ticksFor(spec.x);
    const yTicks = ticksFor(spec.y);
    if (spec.grid) {
      for (const tick of xTicks) {
        shapes.push({
          kind: 'line',
          x1: round(mapX(tick)),
          y1: padTop,
          x2: round(mapX(tick)),
          y2: padTop + plotHeight,
          color: 'var(--rule)',
          width: 1,
        });
      }
      for (const tick of yTicks) {
        shapes.push({
          kind: 'line',
          x1: padLeft,
          y1: round(mapY(tick)),
          x2: padLeft + plotWidth,
          y2: round(mapY(tick)),
          color: 'var(--rule)',
          width: 1,
        });
      }
    }

    const zeroY = mapY(0);
    const xAxisY = zeroY >= padTop && zeroY <= padTop + plotHeight ? zeroY : padTop + plotHeight;
    const zeroX = mapX(0);
    const yAxisX = zeroX >= padLeft && zeroX <= padLeft + plotWidth ? zeroX : padLeft;
    shapes.push({ kind: 'line', x1: padLeft, y1: round(xAxisY), x2: padLeft + plotWidth, y2: round(xAxisY), color: 'var(--ink-3)', width: 1.2 });
    shapes.push({ kind: 'line', x1: round(yAxisX), y1: padTop, x2: round(yAxisX), y2: padTop + plotHeight, color: 'var(--ink-3)', width: 1.2 });

    for (const tick of xTicks) {
      const x = mapX(tick);
      shapes.push({ kind: 'line', x1: round(x), y1: round(xAxisY), x2: round(x), y2: round(xAxisY + 4), color: 'var(--ink-3)', width: 1 });
      shapes.push({
        kind: 'text',
        x: round(x),
        y: round(padTop + plotHeight + 16),
        text: formatTick(tick),
        color: 'var(--ink-3)',
        size: 10,
        anchor: 'middle',
      });
    }
    for (const tick of yTicks) {
      const y = mapY(tick);
      shapes.push({ kind: 'line', x1: round(yAxisX - 4), y1: round(y), x2: round(yAxisX), y2: round(y), color: 'var(--ink-3)', width: 1 });
      shapes.push({
        kind: 'text',
        x: round(padLeft - 7),
        y: round(y + 3),
        text: formatTick(tick),
        color: 'var(--ink-3)',
        size: 10,
        anchor: 'end',
      });
    }
    if (spec.x.label) {
      shapes.push({
        kind: 'text',
        x: round(padLeft + plotWidth),
        y: round(padTop + plotHeight + 30),
        text: spec.x.label,
        color: 'var(--ink-3)',
        size: 10,
        anchor: 'end',
      });
    }
    if (spec.y.label) {
      shapes.push({
        kind: 'text',
        x: padLeft - 8,
        y: round(padTop - 6),
        text: spec.y.label,
        color: 'var(--ink-3)',
        size: 10,
        anchor: 'end',
      });
    }
  }

  for (const element of spec.elements) {
    if (isCompoundElement(element)) {
      shapes.push(...renderCompound(element, renderContext));
      continue;
    }
    switch (element.kind) {
      case 'plot': {
        if (!cartesian) break;
        const from = element.from ?? spec.x.min;
        const to = element.to ?? spec.x.max;
        const sample = samplePlot(element.expr, from, to, DEFAULT_PLOT_SAMPLES);
        if (!sample) break;
        const color = resolveFigureColor(element.color);
        for (const segment of sample.segments) {
          const d = segment
            .map((point, index) => `${index === 0 ? 'M' : 'L'} ${round(mapX(point.x))} ${round(mapY(point.y))}`)
            .join(' ');
          shapes.push({
            kind: 'path',
            d,
            color,
            width: element.width ?? 2,
            fill: 'none',
            ...(element.dashed ? { dash: DASH } : {}),
          });
        }
        break;
      }
      case 'line': {
        const x1 = mapX(element.x1);
        const y1 = mapY(element.y1);
        const x2 = mapX(element.x2);
        const y2 = mapY(element.y2);
        const color = resolveFigureColor(element.color);
        if (!element.arrow) {
          shapes.push({
            kind: 'line',
            x1: round(x1),
            y1: round(y1),
            x2: round(x2),
            y2: round(y2),
            color,
            width: element.width ?? 2,
            ...(element.dashed ? { dash: DASH } : {}),
          });
          break;
        }
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const shortened = 7;
        shapes.push({
          kind: 'line',
          x1: round(x1),
          y1: round(y1),
          x2: round(x2 - shortened * Math.cos(angle)),
          y2: round(y2 - shortened * Math.sin(angle)),
          color,
          width: element.width ?? 2,
          ...(element.dashed ? { dash: DASH } : {}),
        });
        shapes.push(...arrowPath(x1, y1, x2, y2, color));
        break;
      }
      case 'point': {
        const cx = mapX(element.x);
        const cy = mapY(element.y);
        const color = resolveFigureColor(element.color);
        const r = element.r ?? (cartesian ? Math.max(2.5, plotWidth / 90) : 3);
        shapes.push({ kind: 'circle', cx: round(cx), cy: round(cy), r: round(r), color, width: 1.5, fill: color, fillOpacity: 1 });
        if (element.label) {
          shapes.push({
            kind: 'text',
            x: round(cx + r + 4),
            y: round(cy - r - 3),
            text: element.label,
            color: 'var(--ink-2)',
            size: 11,
            anchor: 'start',
          });
        }
        break;
      }
      case 'circle': {
        // A circle radius is given in data units; x and y use different
        // scales, so an ellipse is the honest rendering of a data-space circle.
        const rx = Math.abs(mapX(element.x + element.r) - mapX(element.x));
        const ry = Math.abs(mapY(element.y + element.r) - mapY(element.y));
        const color = resolveFigureColor(element.color);
        shapes.push({
          kind: 'circle',
          cx: round(mapX(element.x)),
          cy: round(mapY(element.y)),
          r: round(element.r === 0 ? 0 : Math.max(1, Math.min(rx || ry, ry || rx))),
          color,
          width: 1.8,
          ...(element.fill ? { fill: color, fillOpacity: 0.14 } : {}),
        });
        break;
      }
      case 'polygon': {
        const color = resolveFigureColor(element.color);
        const d = `${element.points
          .map((point, index) => `${index === 0 ? 'M' : 'L'} ${round(mapX(point[0]))} ${round(mapY(point[1]))}`)
          .join(' ')} Z`;
        shapes.push({
          kind: 'path',
          d,
          color,
          width: 1.8,
          ...(element.fill ? { fill: color, fillOpacity: 0.12 } : { fill: 'none' }),
        });
        break;
      }
      case 'arc': {
        const unitX = Math.abs(mapX(element.x + 1) - mapX(element.x));
        const unitY = Math.abs(mapY(element.y + 1) - mapY(element.y));
        const radius = Math.max(1, element.r * Math.min(unitX || unitY, unitY || unitX));
        const cx = mapX(element.x);
        const cy = mapY(element.y);
        const start = (element.from * Math.PI) / 180;
        const end = (element.to * Math.PI) / 180;
        const sweep = end - start;
        const large = Math.abs(sweep) > Math.PI ? 1 : 0;
        // SVG's y axis points down. A positive angle therefore runs clockwise
        // on screen for plain coordinates and counter-clockwise for cartesian.
        const flag = (sweep >= 0) !== cartesian ? 1 : 0;
        const direction = cartesian ? -1 : 1;
        const sx = cx + radius * Math.cos(start);
        const sy = cy + direction * radius * Math.sin(start);
        const ex = cx + radius * Math.cos(end);
        const ey = cy + direction * radius * Math.sin(end);
        shapes.push({
          kind: 'path',
          d: `M ${round(sx)} ${round(sy)} A ${round(radius)} ${round(radius)} 0 ${large} ${flag} ${round(ex)} ${round(ey)}`,
          color: resolveFigureColor(element.color),
          width: element.width ?? 1.8,
          fill: 'none',
        });
        break;
      }
      case 'label': {
        // Keep labels inside the drawing: a point just outside the axis range
        // would otherwise collide with the title or be clipped away.
        const labelY = cartesian ? Math.max(padTop - 4, mapY(element.y)) : mapY(element.y);
        shapes.push({
          kind: 'text',
          x: round(Math.min(width - 6, Math.max(6, mapX(element.x)))),
          y: round(Math.min(height - 6, Math.max(12, labelY))),
          text: element.text,
          color: resolveFigureColor(element.color, 'ink'),
          size: element.size ?? 12,
          anchor: element.anchor ?? 'middle',
        });
        break;
      }
      case 'bar': {
        const color = resolveFigureColor(element.color);
        if (cartesian) {
          const x = mapX(element.x);
          const y = mapY(element.y + element.h);
          const w = Math.abs(mapX(element.x + element.w) - mapX(element.x));
          const h = Math.abs(mapY(element.y + element.h) - mapY(element.y));
          shapes.push({ kind: 'rect', x: round(Math.min(x, x + w)), y: round(y), width: round(w), height: round(h), color, fill: color, fillOpacity: 0.28 });
        } else {
          shapes.push({
            kind: 'rect',
            x: round(mapX(element.x)),
            y: round(mapY(element.y)),
            width: round((Math.abs(element.w) / 100) * width),
            height: round((Math.abs(element.h) / 100) * height),
            color,
            fill: color,
            fillOpacity: 0.28,
          });
        }
        break;
      }
      case 'pie': {
        if (cartesian) break;
        const cx = mapX(element.x);
        const cy = mapY(element.y);
        const radius = (element.r / 100) * Math.min(width, height);
        if (radius <= 0) break;
        const total = element.slices.reduce((sum, slice) => sum + slice.value, 0);
        if (!(total > 0)) break;
        let angle = -Math.PI / 2;
        element.slices.forEach((slice, index) => {
          const sweep = (slice.value / total) * Math.PI * 2;
          const start = angle;
          const end = angle + sweep;
          const color = resolveFigureColor(
            slice.color,
            PIE_COLORS[index % PIE_COLORS.length] ?? 'accent',
          );
          const x1 = cx + radius * Math.cos(start);
          const y1 = cy + radius * Math.sin(start);
          const x2 = cx + radius * Math.cos(end);
          const y2 = cy + radius * Math.sin(end);
          const large = sweep > Math.PI ? 1 : 0;
          shapes.push({
            kind: 'path',
            d: `M ${round(cx)} ${round(cy)} L ${round(x1)} ${round(y1)} A ${round(radius)} ${round(radius)} 0 ${large} 1 ${round(x2)} ${round(y2)} Z`,
            color,
            width: 1.4,
            fill: color,
            fillOpacity: 0.32,
          });
          if (slice.label) {
            const mid = start + sweep / 2;
            const labelRadius = radius * 0.64;
            shapes.push({
              kind: 'text',
              x: round(cx + Math.cos(mid) * labelRadius),
              y: round(cy + Math.sin(mid) * labelRadius + 4),
              text: slice.label,
              color: 'var(--ink)',
              size: 10,
              anchor: 'middle',
            });
          }
          angle = end;
        });
        break;
      }
      case 'table': {
        if (cartesian) break;
        const left = mapX(element.x);
        const top = mapY(element.y);
        const gridWidth = (element.w / 100) * width;
        const gridHeight = (element.h / 100) * height;
        if (gridWidth <= 0 || gridHeight <= 0) break;
        const header = element.header !== false;
        const rowCount = element.rows.length + (header ? 1 : 0);
        const cellWidth = gridWidth / element.columns.length;
        const cellHeight = gridHeight / Math.max(1, rowCount);
        for (let row = 0; row < rowCount; row += 1) {
          const isHeader = header && row === 0;
          const values = isHeader ? element.columns : element.rows[row - (header ? 1 : 0)] ?? [];
          for (let col = 0; col < element.columns.length; col += 1) {
            const cellX = left + col * cellWidth;
            const cellY = top + row * cellHeight;
            shapes.push({
              kind: 'rect',
              x: round(cellX),
              y: round(cellY),
              width: round(cellWidth),
              height: round(cellHeight),
              color: isHeader ? 'var(--rule-2)' : 'var(--rule)',
              ...(isHeader ? { fill: 'var(--surface-2, var(--surface, #fffdf7))', fillOpacity: 1 } : {}),
            });
            const text = values[col] ?? '';
            if (text) {
              shapes.push({
                kind: 'text',
                x: round(cellX + cellWidth / 2),
                y: round(cellY + cellHeight / 2 + 4),
                text,
                color: 'var(--ink)',
                size: text.length > 16 ? 9 : 11,
                anchor: 'middle',
              });
            }
          }
        }
        break;
      }
      case 'shape': {
        if (cartesian) break;
        const left = mapX(element.x);
        const top = mapY(element.y);
        const boxWidth = (element.w / 100) * width;
        const boxHeight = (element.h / 100) * height;
        if (boxWidth <= 0 || boxHeight <= 0) break;
        const color = resolveFigureColor(element.color, 'ink');
        const fill = element.fill ? { fill: color, fillOpacity: 0.12 } : {};
        const centreX = left + boxWidth / 2;
        const centreY = top + boxHeight / 2;
        switch (element.shape) {
          case 'rect':
            shapes.push({
              kind: 'rect',
              x: round(left),
              y: round(top),
              width: round(boxWidth),
              height: round(boxHeight),
              color,
              ...fill,
            });
            break;
          case 'rounded':
            shapes.push({
              kind: 'rect',
              x: round(left),
              y: round(top),
              width: round(boxWidth),
              height: round(boxHeight),
              rx: round(Math.min(boxWidth, boxHeight) * 0.22),
              color,
              ...fill,
            });
            break;
          case 'ellipse':
            shapes.push({
              kind: 'ellipse',
              cx: round(centreX),
              cy: round(centreY),
              rx: round(boxWidth / 2),
              ry: round(boxHeight / 2),
              color,
              width: 1.8,
              ...fill,
            });
            break;
          case 'diamond':
            shapes.push({
              kind: 'path',
              d: `M ${round(centreX)} ${round(top)} L ${round(left + boxWidth)} ${round(centreY)} L ${round(centreX)} ${round(top + boxHeight)} L ${round(left)} ${round(centreY)} Z`,
              color,
              width: 1.8,
              ...fill,
            });
            break;
          case 'parallelogram': {
            const skew = Math.min(boxWidth * 0.18, boxHeight * 0.5);
            shapes.push({
              kind: 'path',
              d: `M ${round(left + skew)} ${round(top)} L ${round(left + boxWidth)} ${round(top)} L ${round(left + boxWidth - skew)} ${round(top + boxHeight)} L ${round(left)} ${round(top + boxHeight)} Z`,
              color,
              width: 1.8,
              ...fill,
            });
            break;
          }
          default:
            break;
        }
        if (element.text) {
          shapes.push({
            kind: 'text',
            x: round(centreX),
            y: round(centreY + 4),
            text: element.text,
            color: 'var(--ink)',
            size: 12,
            anchor: 'middle',
          });
        }
        break;
      }
      default:
        break;
    }
  }

  return { width, height, shapes };
}

/**
 * Every text string carried by an element. Used by the answer-leak filter: a
 * compound element is all-or-nothing, so if a node, cell or label repeats the
 * answer the whole element is dropped rather than partially hidden.
 */
export function figureElementTexts(element: FigureElement): string[] {
  switch (element.kind) {
    case 'label':
      return [element.text];
    case 'point':
      return element.label ? [element.label] : [];
    case 'shape':
      return element.text ? [element.text] : [];
    case 'table':
      return [...element.columns, ...element.rows.flat()];
    case 'pie':
      return element.slices.flatMap((slice) => (slice.label ? [slice.label] : []));
    case 'chart':
      return [
        ...(element.categories ?? []),
        ...(element.series ?? []).map((series) => series.name ?? ''),
        ...(element.words ?? []).map((word) => word.text),
        ...(element.tasks ?? []).map((task) => task.label),
        ...(element.nodes ?? []).map((node) => node.label ?? node.id),
      ].filter(Boolean);
    case 'graph':
      return [...element.nodes.map((node) => node.text), ...element.edges.map((edge) => edge.label ?? '')].filter(Boolean);
    case 'map':
      return [
        ...(element.regions ?? []).map((region) => region.label ?? ''),
        ...(element.points ?? []).map((point) => point.label ?? ''),
        ...(element.routes ?? []).map((line) => line.label ?? ''),
        ...(element.contours ?? []).map((line) => line.label ?? ''),
        ...(element.layers ?? []).map((layer) => layer.label ?? ''),
        ...(element.arrows ?? []).map((arrow) => arrow.label ?? ''),
        ...(element.scale ? [element.scale] : []),
      ].filter(Boolean);
    case 'circuit':
      return element.parts.flatMap((part) => [part.label ?? '', part.value ?? '']).filter(Boolean);
    case 'molecule':
      return [
        ...(element.groups ?? []).flatMap((group) => [
          group.label ?? '',
          ...group.atoms.map((atom) => atom.label ?? atom.element),
        ]),
        ...(element.levels ?? []).map((level) => level.label ?? ''),
        element.arrowLabel ?? '',
      ].filter(Boolean);
    case 'music':
      return element.notes.flatMap((note) => [note.pitch, note.accidental ?? '']).filter(Boolean);
    case 'timeline':
      return [
        ...(element.events ?? []).flatMap((event) => [event.label, event.description ?? '']),
        ...(element.tasks ?? []).map((task) => task.label),
        element.unit ?? '',
      ].filter(Boolean);
    case 'apparatus':
      return element.parts.map((part) => part.label ?? '').filter(Boolean);
    case 'surface3d':
      return [
        ...(element.points ?? []).map((point) => point.label ?? ''),
        element.xLabel ?? '',
        element.yLabel ?? '',
        element.zLabel ?? '',
      ].filter(Boolean);
    case 'code':
      return [element.code];
    case 'formula':
      return [element.text];
    default:
      return [];
  }
}

/** One-line description used for exports and accessibility fallbacks. */
export function describeFigure(spec: FigureSpec, alt?: string): string {
  if (alt?.trim()) return alt.trim();
  const parts: string[] = [];
  if (spec.title) parts.push(spec.title);
  const plots = spec.elements.filter((element): element is PlotElement => element.kind === 'plot');
  for (const plot of plots) parts.push(`y = ${plot.expr}`);
  const labels = spec.elements
    .filter((element): element is LabelElement => element.kind === 'label')
    .map((element) => element.text);
  const nodeText = spec.elements
    .filter((element): element is ShapeElement => element.kind === 'shape' && Boolean(element.text))
    .map((element) => element.text ?? '');
  const tableText = spec.elements
    .filter((element): element is TableElement => element.kind === 'table')
    .flatMap((element) => [element.columns.join(', '), ...element.rows.map((row) => row.join(', '))]);
  const pieText = spec.elements
    .filter((element): element is PieElement => element.kind === 'pie')
    .flatMap((element) => element.slices.map((slice) => slice.label ?? String(slice.value)));
  const compoundText = spec.elements.flatMap((element): string[] => {
    switch (element.kind) {
      case 'chart':
        return [
          ...(element.categories ?? []),
          ...(element.series ?? []).map((series) => series.name ?? ''),
          ...(element.words ?? []).map((word) => word.text),
          ...(element.tasks ?? []).map((task) => task.label),
          ...(element.nodes ?? []).map((node) => node.label ?? node.id),
        ].filter(Boolean);
      case 'graph':
        return [
          ...element.nodes.map((node) => node.text),
          ...element.edges.map((edge) => edge.label ?? ''),
        ].filter(Boolean);
      case 'map':
        return [
          ...(element.regions ?? []).map((region) => region.label ?? ''),
          ...(element.points ?? []).map((point) => point.label ?? ''),
          ...(element.routes ?? []).map((line) => line.label ?? ''),
          ...(element.contours ?? []).map((line) => line.label ?? ''),
          ...(element.layers ?? []).map((layer) => layer.label ?? ''),
          ...(element.arrows ?? []).map((arrow) => arrow.label ?? ''),
        ].filter(Boolean);
      case 'circuit':
        return element.parts.flatMap((part) => [part.label ?? '', part.value ?? '']).filter(Boolean);
      case 'molecule':
        return [
          ...(element.groups ?? []).flatMap((group) => [group.label ?? '', ...group.atoms.map((atom) => atom.label ?? atom.element)]),
          ...(element.levels ?? []).map((level) => level.label ?? ''),
          element.arrowLabel ?? '',
        ].filter(Boolean);
      case 'music':
        return element.notes.map((note) => (note.rest ? 'rest' : note.pitch));
      case 'timeline':
        return [
          ...(element.events ?? []).flatMap((event) => [event.label, event.description ?? '']),
          ...(element.tasks ?? []).map((task) => task.label),
        ].filter(Boolean);
      case 'apparatus':
        return element.parts.map((part) => part.label ?? '').filter(Boolean);
      case 'surface3d':
        return [
          ...(element.points ?? []).map((point) => point.label ?? ''),
          element.xLabel ?? '',
          element.yLabel ?? '',
          element.zLabel ?? '',
        ].filter(Boolean);
      case 'code':
        return [element.code];
      case 'formula':
        return [element.text];
      default:
        return [];
    }
  });
  if (labels.length > 0) parts.push(labels.join(', '));
  if (nodeText.length > 0) parts.push(nodeText.join(', '));
  if (tableText.length > 0) parts.push(tableText.join(' · '));
  if (pieText.length > 0) parts.push(pieText.join(', '));
  if (compoundText.length > 0) parts.push(compoundText.join(', '));
  return parts.length > 0 ? parts.join(' · ') : 'Diagram';
}
