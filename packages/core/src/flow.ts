/**
 * Mermaid-style flowcharts, laid out by the app.
 *
 * Hand-placed `shape` nodes are the reason the first flowchart renderer looked
 * like a stack of unrelated boxes: a language model is good at naming the steps
 * of a process and bad at turning them into pixel coordinates. This module takes
 * the description a model is actually good at — Mermaid's node/edge syntax (or
 * the same graph as JSON) — and computes the layout deterministically.
 *
 * Only a deliberately small Mermaid subset is accepted: `flowchart TD|LR`,
 * `[]` process, `()` / `([])` start or end, `{}` decision, `[//]` input or
 * output, `(())` connector, and the `-->`, `---`, `-.->`, `==>` edges with an
 * optional `|label|` or `-- label -->`. `subgraph`, styling, HTML labels and
 * icons are rejected rather than half-rendered, and a graph with no edges is
 * rejected because it is a symbol chart, not a flow.
 *
 * The result is still a `v: 1` figure spec made of the existing `shape`, `line`
 * and `label` primitives, so stored decks, the renderer and the app's themes do
 * not need a new format.
 */
import type {
  FigureElement,
  FigureSpec,
  FlowShapeKind,
  LabelElement,
  LineElement,
  ShapeElement,
} from './figure';

export type FlowDirection = 'TD' | 'LR';

export interface FlowGraphNode {
  id: string;
  text: string;
  shape: FlowShapeKind;
}

export interface FlowGraphEdge {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
  /** Defaults to `true`; `false` draws a plain connector. */
  arrow?: boolean;
}

export interface FlowGraph {
  direction: FlowDirection;
  nodes: FlowGraphNode[];
  edges: FlowGraphEdge[];
}

export const MAX_FLOW_NODES = 12;
export const MAX_FLOW_EDGES = 16;
export const MAX_FLOW_SOURCE_CHARS = 6000;
const MAX_FLOW_ELEMENTS = 60;
const MAX_FLOW_TEXT = 80;
const MAX_LABEL_WIDTH = 168;
const NODE_FONT_SIZE = 12;
const NODE_LINE_HEIGHT = 16;
const NODE_PADDING_X = 24;
const NODE_PADDING_Y = 18;
const MIN_NODE_WIDTH = 88;
const MAX_NODE_WIDTH = 220;
const MIN_NODE_HEIGHT = 40;
const NODE_GAP = 26;
const LAYER_GAP = 38;
const CANVAS_PAD = 24;
const MIN_CANVAS_WIDTH = 320;
const MAX_CANVAS_WIDTH = 960;
const MIN_CANVAS_HEIGHT = 240;
const MAX_CANVAS_HEIGHT = 640;

interface NodeDraft {
  id: string;
  text: string;
  shape: FlowShapeKind;
  textSet: boolean;
  shapeSet: boolean;
}

interface ParsedNode {
  id: string;
  shape?: FlowShapeKind;
  text?: string;
  end: number;
}

interface ParsedEdge {
  label?: string;
  dashed: boolean;
  arrow: boolean;
  end: number;
}

interface LaidNode extends FlowGraphNode {
  lines: string[];
  width: number;
  height: number;
  layer: number;
  order: number;
  x: number;
  y: number;
}

interface IndexedEdge {
  edge: FlowGraphEdge;
  from: number;
  to: number;
}

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

type LaneSide = 'left' | 'right' | 'top' | 'bottom';

interface RoutedEdge {
  segments: Segment[];
  dashed: boolean;
  arrow: boolean;
  label?: string;
  labelX: number;
  labelY: number;
  labelAnchor?: 'start' | 'middle' | 'end';
}

export interface FlowLayoutOptions {
  width?: number;
  height?: number;
  title?: string;
}

export interface FlowFigureOptions {
  width?: unknown;
  height?: unknown;
  title?: unknown;
}

const SHAPE_TOKENS: Array<{ open: string; close: string; shape: FlowShapeKind }> = [
  { open: '([', close: '])', shape: 'rounded' },
  { open: '[[', close: ']]', shape: 'rect' },
  { open: '[(', close: ')]', shape: 'rounded' },
  { open: '((', close: '))', shape: 'ellipse' },
  { open: '{{', close: '}}', shape: 'rect' },
  { open: '[/', close: '/]', shape: 'parallelogram' },
  { open: '[\\', close: '\\]', shape: 'parallelogram' },
  { open: '[', close: ']', shape: 'rect' },
  { open: '(', close: ')', shape: 'rounded' },
  { open: '{', close: '}', shape: 'diamond' },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cleanText(value: unknown, max = MAX_FLOW_TEXT): string {
  if (typeof value !== 'string') return '';
  const lines = value
    .replace(/\r/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\\n/g, '\n')
    .replace(/<[^>]*>/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return lines.join('\n').slice(0, max).trim();
}

function unquote(value: string): string {
  const text = value.trim();
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return text.slice(1, -1);
    }
  }
  return text;
}

function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  // CJK, full-width punctuation and emoji need roughly twice the room of a
  // Latin glyph at the figure's 12 px font size.
  return code >= 0x2e80 ? 12 : 7;
}

function measureText(text: string): number {
  let width = 0;
  for (const char of text) width += charWidth(char);
  return width;
}

function wrapText(value: string): string[] {
  const lines: string[] = [];
  for (const raw of value.split('\n')) {
    let current = '';
    let width = 0;
    for (const char of raw) {
      const next = width + charWidth(char);
      if (current && next > MAX_LABEL_WIDTH) {
        lines.push(current);
        current = char;
        width = charWidth(char);
      } else {
        current += char;
        width = next;
      }
    }
    if (current) lines.push(current);
  }
  const limited = lines.slice(0, 3);
  if (lines.length > 3 && limited[2]) limited[2] = `${limited[2].slice(0, 24)}…`;
  return limited.length > 0 ? limited : ['?'];
}

function measureNode(node: FlowGraphNode): { lines: string[]; width: number; height: number } {
  const lines = wrapText(node.text || node.id);
  const textWidth = Math.max(0, ...lines.map((line) => measureText(line)));
  const width = clamp(Math.ceil(textWidth + NODE_PADDING_X * 2), MIN_NODE_WIDTH, MAX_NODE_WIDTH);
  const height =
    Math.max(MIN_NODE_HEIGHT, lines.length * NODE_LINE_HEIGHT + NODE_PADDING_Y * 2 - 4) +
    (node.shape === 'diamond' ? 8 : 0);
  return { lines, width, height };
}

function readNode(line: string, start: number): ParsedNode | null {
  let index = start;
  while (index < line.length && /\s/.test(line[index]!)) index += 1;
  const idStart = index;
  // Unicode letters let a model write `開始[開始] --> 處理[處理]`. A hyphen is
  // deliberately not an id character: `A-->B` must read as node A, edge `-->`,
  // node B, not as a node called `A--`.
  while (index < line.length && /[\p{L}\p{N}_.]/u.test(line[index]!)) index += 1;
  if (index === idStart) return null;
  const id = line.slice(idStart, index);

  let position = index;
  while (position < line.length && /\s/.test(line[position]!)) position += 1;
  for (const token of SHAPE_TOKENS) {
    if (!line.startsWith(token.open, position)) continue;
    const close = line.indexOf(token.close, position + token.open.length);
    if (close < 0) return null;
    const text = cleanText(unquote(line.slice(position + token.open.length, close)));
    return {
      id,
      ...(text ? { text } : {}),
      shape: token.shape,
      end: close + token.close.length,
    };
  }
  return { id, end: index };
}

function readEdge(line: string, start: number): ParsedEdge | null {
  let index = start;
  while (index < line.length && /\s/.test(line[index]!)) index += 1;
  const rest = line.slice(index);

  // `A -- label --> B`, `A == label ==> B`, `A -. label .-> B` and the
  // arrow-less `A -- label --- B`. The non-greedy label stops at the operator.
  const labelled =
    /^(?:--\s+(.+?)\s+-->|--\s+(.+?)\s+---|==\s+(.+?)\s+==>|-\.\s+(.+?)\s+\.->)/.exec(rest);
  if (labelled) {
    const token = labelled[0];
    const label = cleanText(labelled[1] ?? labelled[2] ?? labelled[3] ?? labelled[4] ?? '');
    return {
      ...(label ? { label } : {}),
      dashed: token.startsWith('-.'),
      arrow: !/---\s*$/.test(token),
      end: index + token.length,
    };
  }

  const simple = /^(-->|---|-.->|==>)/.exec(rest);
  if (!simple) return null;
  const token = simple[1]!;
  let end = index + token.length;
  let label = '';
  let position = end;
  while (position < line.length && /\s/.test(line[position]!)) position += 1;
  if (line[position] === '|') {
    const close = line.indexOf('|', position + 1);
    if (close < 0) return null;
    label = cleanText(line.slice(position + 1, close));
    end = close + 1;
  }
  return {
    ...(label ? { label } : {}),
    dashed: token === '-.->',
    arrow: token !== '---',
    end,
  };
}

function declareNode(nodes: Map<string, NodeDraft>, parsed: ParsedNode): void {
  const existing = nodes.get(parsed.id);
  if (!existing) {
    nodes.set(parsed.id, {
      id: parsed.id,
      text: parsed.text ?? parsed.id,
      shape: parsed.shape ?? 'rect',
      textSet: Boolean(parsed.text),
      shapeSet: Boolean(parsed.shape),
    });
    return;
  }
  if (parsed.text && (!existing.textSet || existing.text === existing.id)) {
    existing.text = parsed.text;
    existing.textSet = true;
  }
  if (parsed.shape && !existing.shapeSet) {
    existing.shape = parsed.shape;
    existing.shapeSet = true;
  }
}

function parseStatement(
  line: string,
  nodes: Map<string, NodeDraft>,
  edges: FlowGraphEdge[],
): boolean {
  const statement = line.trim();
  if (!statement) return true;
  let current = readNode(statement, 0);
  if (!current) return false;
  declareNode(nodes, current);
  let position = current.end;

  for (;;) {
    const edge = readEdge(statement, position);
    if (!edge) break;
    const next = readNode(statement, edge.end);
    if (!next) return false;
    declareNode(nodes, next);
    edges.push({
      from: current.id,
      to: next.id,
      ...(edge.label ? { label: edge.label } : {}),
      ...(edge.dashed ? { dashed: true } : {}),
      ...(edge.arrow ? {} : { arrow: false }),
    });
    if (edges.length > MAX_FLOW_EDGES) return false;
    current = next;
    position = next.end;
  }
  // Anything after the last parsed node is syntax this subset cannot draw
  // (`A --> B & C`, `:::class`, a `click` suffix). Rejecting the statement is
  // safer than publishing a diagram that silently lost a branch.
  return statement.slice(position).trim().length === 0;
}

function normalizeDirection(value: unknown): FlowDirection | null {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!text || text === 'TD' || text === 'TB') return 'TD';
  if (text === 'LR') return 'LR';
  // RL and BT would need the whole layout mirrored; drawing them as TD/LR
  // would silently reverse the arrows, so the subset rejects them instead.
  return null;
}

/**
 * A model that writes a JSON string often turns a label's line break into a
 * real newline. Mermaid wants `<br/>`, and a real newline would otherwise split
 * the statement into two invalid lines. Fold newlines while a node bracket is
 * open, leaving statement-level newlines alone.
 */
function foldMultilineLabels(source: string): string {
  const output: string[] = [];
  let buffer = '';
  let depth = 0;
  let quote: '"' | "'" | null = null;

  const scan = (line: string): void => {
    for (const char of line) {
      if (quote) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '[' || char === '(' || char === '{') {
        depth += 1;
      } else if (char === ']' || char === ')' || char === '}') {
        depth = Math.max(0, depth - 1);
      }
    }
  };

  for (const line of source.split('\n')) {
    if (depth > 0) {
      buffer += `<br/>${line.trim()}`;
    } else {
      if (buffer) output.push(buffer);
      buffer = line;
    }
    scan(line);
  }
  if (buffer) output.push(buffer);
  return output.join('\n');
}

/**
 * Parse the supported Mermaid subset. Returns `null` for syntax outside the
 * subset so the caller can fall back to a photo or to no illustration instead
 * of publishing a half-drawn diagram.
 */
export function parseMermaidFlow(source: string): FlowGraph | null {
  if (typeof source !== 'string') return null;
  const text = foldMultilineLabels(source.replace(/\r/g, '')).trim();
  if (!text || text.length > MAX_FLOW_SOURCE_CHARS) return null;

  const nodes = new Map<string, NodeDraft>();
  const edges: FlowGraphEdge[] = [];
  let direction: FlowDirection = 'TD';

  for (const rawLine of text.split('\n')) {
    let line = rawLine.trim();
    if (!line || line.startsWith('%%')) continue;

    const header = /^(?:flowchart|graph)\b\s*(TD|TB|BT|RL|LR)?/i.exec(line);
    if (header) {
      const parsedDirection = normalizeDirection(header[1]);
      if (!parsedDirection) return null;
      direction = parsedDirection;
      line = line.slice(header[0].length).trim();
      if (!line) continue;
    }
    // `subgraph` changes the meaning of the drawing (clusters and boundaries),
    // not just its styling. Flattening it silently would misrepresent the
    // source, so the whole diagram is rejected instead.
    if (/^subgraph\b/i.test(line)) return null;
    if (
      /^(?:classDef|class|style|linkStyle|click|end|direction|accTitle|accDescr|title)\b/i.test(
        line,
      )
    ) {
      continue;
    }
    // Mermaid accepts several statements per line separated by semicolons.
    for (const part of line.split(';')) {
      if (!parseStatement(part, nodes, edges)) return null;
    }
  }

  if (nodes.size === 0 || edges.length === 0) return null;
  if (nodes.size > MAX_FLOW_NODES || edges.length > MAX_FLOW_EDGES) return null;
  return {
    direction,
    nodes: [...nodes.values()].map(({ id, text, shape }) => ({ id, text, shape })),
    edges,
  };
}

function shapeOf(value: unknown): FlowShapeKind {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  switch (text) {
    case 'rounded':
    case 'stadium':
    case 'start':
    case 'end':
    case 'terminator':
      return 'rounded';
    case 'diamond':
    case 'decision':
    case 'condition':
      return 'diamond';
    case 'ellipse':
    case 'circle':
    case 'connector':
      return 'ellipse';
    case 'parallelogram':
    case 'input':
    case 'output':
    case 'data':
    case 'io':
      return 'parallelogram';
    default:
      return 'rect';
  }
}

/**
 * Read the JSON form of the same graph, which is easier for a model than
 * Mermaid when it wants to attach semantic shape names:
 *
 * {"direction":"TD","nodes":[{"id":"a","shape":"rounded","text":"開始"}],
 *  "edges":[{"from":"a","to":"b","label":"是"}]}
 */
export function parseFlowGraph(value: unknown): FlowGraph | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  const rawNodes = Array.isArray(object.nodes) ? object.nodes : [];
  const rawEdges = Array.isArray(object.edges) ? object.edges : [];
  if (rawNodes.length === 0 || rawEdges.length === 0) return null;
  if (rawNodes.length > MAX_FLOW_NODES || rawEdges.length > MAX_FLOW_EDGES) return null;

  const nodes: FlowGraphNode[] = [];
  const seen = new Set<string>();
  rawNodes.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const item = raw as Record<string, unknown>;
    const id =
      typeof item.id === 'string' && item.id.trim() ? item.id.trim().slice(0, 32) : `n${index + 1}`;
    if (seen.has(id)) return;
    seen.add(id);
    const source =
      typeof item.text === 'string'
        ? item.text
        : typeof item.label === 'string'
          ? item.label
          : typeof item.name === 'string'
            ? item.name
            : id;
    nodes.push({ id, text: cleanText(source) || id, shape: shapeOf(item.shape) });
  });

  const edges: FlowGraphEdge[] = [];
  for (const raw of rawEdges) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const from =
      typeof item.from === 'string'
        ? item.from
        : typeof item.source === 'string'
          ? item.source
          : typeof item.sourceId === 'string'
            ? item.sourceId
            : '';
    const to =
      typeof item.to === 'string'
        ? item.to
        : typeof item.target === 'string'
          ? item.target
          : typeof item.targetId === 'string'
            ? item.targetId
            : '';
    if (!from || !to || from === to || !seen.has(from) || !seen.has(to)) continue;
    const label = cleanText(
      typeof item.label === 'string' ? item.label : typeof item.text === 'string' ? item.text : '',
    );
    edges.push({
      from,
      to,
      ...(label ? { label } : {}),
      ...(item.dashed === true ? { dashed: true } : {}),
      ...(item.arrow === false ? { arrow: false } : {}),
    });
  }

  if (nodes.length === 0 || edges.length === 0) return null;
  const direction = normalizeDirection(object.direction ?? object.dir ?? object.orientation);
  if (!direction) return null;
  return { direction, nodes, edges };
}

function assignLayers(nodes: LaidNode[], indexed: IndexedEdge[]): number[][] {
  const count = nodes.length;
  const outgoing: number[][] = Array.from({ length: count }, () => []);
  indexed.forEach((item, index) => {
    outgoing[item.from]!.push(index);
  });

  // Depth-first search: an edge back to a node still on the stack closes a
  // cycle. Those edges are routed outside the layers instead of forcing an
  // impossible upward layout.
  const state = new Array<number>(count).fill(0);
  const back = new Set<number>();
  const visit = (start: number): void => {
    state[start] = 1;
    for (const edgeIndex of outgoing[start]!) {
      const target = indexed[edgeIndex]!.to;
      if (state[target] === 1) {
        back.add(edgeIndex);
      } else if (state[target] === 0) {
        visit(target);
      }
    }
    state[start] = 2;
  };
  for (let index = 0; index < count; index += 1) {
    if (state[index] === 0) visit(index);
  }

  const indegree = new Array<number>(count).fill(0);
  indexed.forEach((item, index) => {
    if (!back.has(index)) indegree[item.to]! += 1;
  });
  const queue: number[] = [];
  for (let index = 0; index < count; index += 1) {
    if (indegree[index] === 0) queue.push(index);
  }
  const layerOf = new Array<number>(count).fill(0);
  while (queue.length > 0) {
    const source = queue.shift()!;
    for (const edgeIndex of outgoing[source]!) {
      if (back.has(edgeIndex)) continue;
      const target = indexed[edgeIndex]!.to;
      layerOf[target] = Math.max(layerOf[target]!, layerOf[source]! + 1);
      indegree[target]! -= 1;
      if (indegree[target] === 0) queue.push(target);
    }
  }

  const layerCount = Math.max(1, ...layerOf.map((layer) => layer + 1));
  const groups: number[][] = Array.from({ length: layerCount }, () => []);
  nodes.forEach((node, index) => {
    node.layer = layerOf[index]!;
    groups[node.layer]!.push(index);
    node.order = groups[node.layer]!.length - 1;
  });
  return groups;
}

function orderLayers(
  nodes: LaidNode[],
  groups: number[][],
  indexed: IndexedEdge[],
): void {
  const predecessors: number[][] = Array.from({ length: nodes.length }, () => []);
  const successors: number[][] = Array.from({ length: nodes.length }, () => []);
  for (const item of indexed) {
    if (nodes[item.to]!.layer <= nodes[item.from]!.layer) continue;
    predecessors[item.to]!.push(item.from);
    successors[item.from]!.push(item.to);
  }

  const sortWith = (group: number[], neighbours: number[][], adjacentLayer: number): void => {
    const current = new Map(group.map((index, position) => [index, position]));
    const scored = group.map((index) => {
      const positions = neighbours[index]!
        .filter((other) => nodes[other]!.layer === adjacentLayer)
        .map((other) => nodes[other]!.order);
      const score =
        positions.length > 0
          ? positions.reduce((total, value) => total + value, 0) / positions.length
          : nodes[index]!.order;
      return { index, score, previous: current.get(index) ?? 0 };
    });
    scored.sort((a, b) => a.score - b.score || a.previous - b.previous);
    scored.forEach((item, position) => {
      nodes[item.index]!.order = position;
      group[position] = item.index;
    });
  };

  for (let pass = 0; pass < 4; pass += 1) {
    if (pass % 2 === 0) {
      for (let layer = 1; layer < groups.length; layer += 1) {
        sortWith(groups[layer]!, predecessors, layer - 1);
      }
    } else {
      for (let layer = groups.length - 2; layer >= 0; layer -= 1) {
        sortWith(groups[layer]!, successors, layer + 1);
      }
    }
  }
}

function labelOffset(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): { x: number; y: number } {
  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.hypot(dx, dy) || 1;
  // A normal that points right of a downward edge and above a rightward edge,
  // which is where Mermaid puts a short edge label.
  return {
    x: (startX + endX) / 2 + (dy / length) * 11,
    y: (startY + endY) / 2 - (dx / length) * 11,
  };
}

function routeEdges(
  nodes: LaidNode[],
  indexed: IndexedEdge[],
  laneSides: Array<LaneSide | null>,
  direction: FlowDirection,
  canvasWidth: number,
  canvasHeight: number,
): RoutedEdge[] {
  const lanes: Record<LaneSide, number> = { left: 0, right: 0, top: 0, bottom: 0 };
  return indexed.map((item, index) => {
    const from = nodes[item.from]!;
    const to = nodes[item.to]!;
    // Only an edge to the very next layer can be a straight line. Same-layer,
    // back and skip-layer edges go around the outside: a straight C -> E edge
    // through D is exactly what made the old hand-placed flow look broken.
    const direct = to.layer === from.layer + 1;
    const edge = item.edge;
    const label = edge.label;
    const dashed = edge.dashed === true;
    const arrow = edge.arrow !== false;

    if (direct) {
      if (direction === 'TD') {
        const startX = from.x + from.width / 2;
        const startY = from.y + from.height;
        const endX = to.x + to.width / 2;
        const endY = to.y;
        const labelAt = labelOffset(startX, startY, endX, endY);
        return {
          segments: [{ x1: startX, y1: startY, x2: endX, y2: endY }],
          dashed,
          arrow,
          ...(label ? { label } : {}),
          labelX: labelAt.x,
          labelY: labelAt.y,
        };
      }
      const startX = from.x + from.width;
      const startY = from.y + from.height / 2;
      const endX = to.x;
      const endY = to.y + to.height / 2;
      const labelAt = labelOffset(startX, startY, endX, endY);
      return {
        segments: [{ x1: startX, y1: startY, x2: endX, y2: endY }],
        dashed,
        arrow,
        ...(label ? { label } : {}),
        labelX: labelAt.x,
        labelY: labelAt.y,
      };
    }

    const side = laneSides[index] ?? (direction === 'TD' ? 'right' : 'bottom');
    const laneIndex = lanes[side]++;
    const anchor: 'start' | 'middle' | 'end' =
      side === 'left' ? 'end' : side === 'right' ? 'start' : 'middle';

    if (direction === 'TD') {
      const laneX = side === 'left' ? 40 + laneIndex * 28 : canvasWidth - 32 - laneIndex * 28;
      const startX = side === 'left' ? from.x : from.x + from.width;
      const startY = from.y + from.height / 2;
      const endX = side === 'left' ? to.x : to.x + to.width;
      const endY = to.y + to.height / 2;
      return {
        segments: [
          { x1: startX, y1: startY, x2: laneX, y2: startY },
          { x1: laneX, y1: startY, x2: laneX, y2: endY },
          { x1: laneX, y1: endY, x2: endX, y2: endY },
        ],
        dashed,
        arrow,
        ...(label ? { label } : {}),
        labelX: side === 'left' ? laneX - 8 : laneX + 8,
        labelY: (startY + endY) / 2,
        labelAnchor: anchor,
      };
    }

    const laneY = side === 'top' ? 32 + laneIndex * 28 : canvasHeight - 32 - laneIndex * 28;
    const startX = from.x + from.width / 2;
    const startY = side === 'top' ? from.y : from.y + from.height;
    const endX = to.x + to.width / 2;
    const endY = side === 'top' ? to.y : to.y + to.height;
    return {
      segments: [
        { x1: startX, y1: startY, x2: startX, y2: laneY },
        { x1: startX, y1: laneY, x2: endX, y2: laneY },
        { x1: endX, y1: laneY, x2: endX, y2: endY },
      ],
      dashed,
      arrow,
      ...(label ? { label } : {}),
      labelX: (startX + endX) / 2,
      labelY: side === 'top' ? laneY - 8 : laneY + 10,
      labelAnchor: 'middle',
    };
  });
}

function percent(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round(clamp((value / total) * 100, 0, 100) * 100) / 100;
}

/**
 * Lay a flow graph out as a `v: 1` plain-coordinate figure. The graph is capped
 * at 12 nodes and 16 edges, and the figure at the renderer's 60 elements, so a
 * runaway model reply cannot produce an unreadable wall of boxes.
 */
export function layoutFlow(graph: FlowGraph, options: FlowLayoutOptions = {}): FigureSpec | null {
  if (!graph || graph.nodes.length === 0 || graph.edges.length === 0) return null;
  if (graph.nodes.length > MAX_FLOW_NODES || graph.edges.length > MAX_FLOW_EDGES) return null;

  const nodes: LaidNode[] = graph.nodes.map((node) => ({
    ...node,
    ...measureNode(node),
    layer: 0,
    order: 0,
    x: 0,
    y: 0,
  }));
  const nodeIndex = new Map(nodes.map((node, index) => [node.id, index]));
  const indexed: IndexedEdge[] = [];
  for (const edge of graph.edges) {
    const from = nodeIndex.get(edge.from);
    const to = nodeIndex.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    indexed.push({ edge, from, to });
  }
  if (indexed.length === 0) return null;

  const groups = assignLayers(nodes, indexed);
  orderLayers(nodes, groups, indexed);
  const layerCount = groups.length;
  const direction = graph.direction;

  // Pick the outside lane for every non-direct edge before the canvas is sized.
  // A node at the edge of its row exits outward; that is what keeps a loop from
  // cutting horizontally through a sibling node (the bug in the first fix).
  const laneSides: Array<LaneSide | null> = indexed.map((item) => {
    const from = nodes[item.from]!;
    const to = nodes[item.to]!;
    if (to.layer === from.layer + 1) return null;
    const group = groups[from.layer]!;
    const position = group.indexOf(item.from);
    const before = position;
    const after = group.length - position - 1;
    if (direction === 'TD') {
      if (before === 0) return 'left';
      if (after === 0) return 'right';
      return before <= after ? 'left' : 'right';
    }
    if (before === 0) return 'top';
    if (after === 0) return 'bottom';
    return before <= after ? 'top' : 'bottom';
  });
  const countSide = (side: LaneSide): number =>
    laneSides.reduce((total, value) => total + (value === side ? 1 : 0), 0);
  const leftLanes = countSide('left');
  const rightLanes = countSide('right');
  const topLanes = countSide('top');
  const bottomLanes = countSide('bottom');
  const leftSpace = leftLanes > 0 ? leftLanes * 28 + 40 : 0;
  const rightSpace = rightLanes > 0 ? rightLanes * 28 + 32 : 0;
  const topSpace = topLanes > 0 ? topLanes * 28 + 32 : 0;
  const bottomSpace = bottomLanes > 0 ? bottomLanes * 28 + 32 : 0;

  let canvasWidth: number;
  let canvasHeight: number;

  if (direction === 'TD') {
    const rowHeights = groups.map((group) =>
      Math.max(MIN_NODE_HEIGHT, ...group.map((index) => nodes[index]!.height)),
    );
    const rowWidths = groups.map(
      (group) =>
        group.reduce((total, index) => total + nodes[index]!.width, 0) +
        Math.max(0, group.length - 1) * NODE_GAP,
    );
    const contentWidth = Math.max(...rowWidths) + leftSpace + rightSpace;
    const contentHeight =
      rowHeights.reduce((total, height) => total + height, 0) +
      Math.max(0, layerCount - 1) * LAYER_GAP;
    if (
      contentWidth + CANVAS_PAD * 2 > MAX_CANVAS_WIDTH ||
      contentHeight + CANVAS_PAD * 2 > MAX_CANVAS_HEIGHT
    ) {
      return null;
    }
    canvasWidth = clamp(
      Math.ceil(Math.max(options.width ?? 480, contentWidth + CANVAS_PAD * 2)),
      MIN_CANVAS_WIDTH,
      MAX_CANVAS_WIDTH,
    );
    canvasHeight = clamp(
      Math.ceil(Math.max(options.height ?? 320, contentHeight + CANVAS_PAD * 2)),
      MIN_CANVAS_HEIGHT,
      MAX_CANVAS_HEIGHT,
    );
    const areaLeft = leftSpace;
    const areaWidth = canvasWidth - leftSpace - rightSpace;
    let y = (canvasHeight - contentHeight) / 2;
    for (let layer = 0; layer < layerCount; layer += 1) {
      const group = groups[layer]!;
      const rowHeight = rowHeights[layer]!;
      let x = areaLeft + (areaWidth - rowWidths[layer]!) / 2;
      for (const index of group) {
        const node = nodes[index]!;
        node.x = x;
        node.y = y + (rowHeight - node.height) / 2;
        x += node.width + NODE_GAP;
      }
      y += rowHeight + LAYER_GAP;
    }
  } else {
    const columnWidths = groups.map((group) =>
      Math.max(MIN_NODE_WIDTH, ...group.map((index) => nodes[index]!.width)),
    );
    const columnHeights = groups.map(
      (group) =>
        group.reduce((total, index) => total + nodes[index]!.height, 0) +
        Math.max(0, group.length - 1) * NODE_GAP,
    );
    const contentWidth =
      columnWidths.reduce((total, width) => total + width, 0) +
      Math.max(0, layerCount - 1) * LAYER_GAP;
    const contentHeight = Math.max(...columnHeights) + topSpace + bottomSpace;
    if (
      contentWidth + CANVAS_PAD * 2 > MAX_CANVAS_WIDTH ||
      contentHeight + CANVAS_PAD * 2 > MAX_CANVAS_HEIGHT
    ) {
      return null;
    }
    canvasWidth = clamp(
      Math.ceil(Math.max(options.width ?? 480, contentWidth + CANVAS_PAD * 2)),
      MIN_CANVAS_WIDTH,
      MAX_CANVAS_WIDTH,
    );
    canvasHeight = clamp(
      Math.ceil(Math.max(options.height ?? 320, contentHeight + CANVAS_PAD * 2)),
      MIN_CANVAS_HEIGHT,
      MAX_CANVAS_HEIGHT,
    );
    const areaTop = topSpace;
    const areaHeight = canvasHeight - topSpace - bottomSpace;
    let x = (canvasWidth - contentWidth) / 2;
    for (let layer = 0; layer < layerCount; layer += 1) {
      const group = groups[layer]!;
      const columnWidth = columnWidths[layer]!;
      let y = areaTop + (areaHeight - columnHeights[layer]!) / 2;
      for (const index of group) {
        const node = nodes[index]!;
        node.x = x + (columnWidth - node.width) / 2;
        node.y = y;
        y += node.height + NODE_GAP;
      }
      x += columnWidth + LAYER_GAP;
    }
  }

  const routed = routeEdges(nodes, indexed, laneSides, direction, canvasWidth, canvasHeight);
  const edgeElements: LineElement[] = [];
  const edgeLabels: LabelElement[] = [];
  for (const item of routed) {
    item.segments.forEach((segment, index) => {
      edgeElements.push({
        kind: 'line',
        x1: percent(segment.x1, canvasWidth),
        y1: percent(segment.y1, canvasHeight),
        x2: percent(segment.x2, canvasWidth),
        y2: percent(segment.y2, canvasHeight),
        color: 'ink',
        width: 1.5,
        ...(item.dashed ? { dashed: true } : {}),
        ...(item.arrow && index === item.segments.length - 1 ? { arrow: true } : {}),
      });
    });
    if (item.label) {
      edgeLabels.push({
        kind: 'label',
        x: percent(item.labelX, canvasWidth),
        y: percent(item.labelY, canvasHeight),
        text: item.label,
        size: 10,
        anchor: item.labelAnchor ?? 'middle',
      });
    }
  }

  const nodeElements: FigureElement[] = [];
  for (const node of nodes) {
    const shape: ShapeElement = {
      kind: 'shape',
      shape: node.shape,
      x: percent(node.x, canvasWidth),
      y: percent(node.y, canvasHeight),
      w: percent(node.width, canvasWidth),
      h: percent(node.height, canvasHeight),
      ...(node.lines.length === 1 && node.lines[0] ? { text: node.lines[0] } : {}),
    };
    nodeElements.push(shape);
    if (node.lines.length > 1) {
      const centreX = percent(node.x + node.width / 2, canvasWidth);
      const centreY = percent(node.y + node.height / 2, canvasHeight);
      const lineHeight = (NODE_LINE_HEIGHT / canvasHeight) * 100;
      const startY = centreY - ((node.lines.length - 1) * lineHeight) / 2 + 4;
      node.lines.forEach((line, index) => {
        nodeElements.push({
          kind: 'label',
          x: centreX,
          y: Math.round((startY + index * lineHeight) * 100) / 100,
          text: line,
          size: NODE_FONT_SIZE,
          anchor: 'middle',
        });
      });
    }
  }

  const elements: FigureElement[] = [...edgeElements, ...nodeElements];
  if (elements.length + edgeLabels.length <= MAX_FLOW_ELEMENTS) {
    elements.push(...edgeLabels);
  }
  if (elements.length > MAX_FLOW_ELEMENTS) return null;

  return {
    v: 1,
    ...(options.title ? { title: options.title } : {}),
    width: canvasWidth,
    height: canvasHeight,
    coords: 'plain',
    x: { min: 0, max: 100 },
    y: { min: 0, max: 100 },
    grid: false,
    elements,
  };
}

function finiteOption(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/**
 * Compile either form accepted from a model: a Mermaid string, or the JSON
 * graph object. This is the one entry point `parseFigureSpec` uses.
 */
export function compileFigureFlow(value: unknown, options: FlowFigureOptions = {}): FigureSpec | null {
  const graph = typeof value === 'string' ? parseMermaidFlow(value) : parseFlowGraph(value);
  if (!graph) return null;
  const width = finiteOption(options.width);
  const height = finiteOption(options.height);
  const title = cleanText(options.title).replace(/\n+/g, ' ');
  return layoutFlow(graph, {
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(title ? { title } : {}),
  });
}
