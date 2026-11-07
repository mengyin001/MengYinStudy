/**
 * The graph renderer.
 *
 * One renderer covers flowcharts, trees, mind maps, UML class boxes, ER
 * entities, pedigrees, food webs and network topology. The model names nodes and
 * edges; this module chooses a deterministic layout and draws it. Edges are
 * drawn before nodes, so a connector can never cut through a label.
 */
import type { FigureShape, GraphEdge, GraphElement, GraphNode } from '../figure';
import {
  arrowHead,
  circle,
  clamp,
  line,
  paletteColor,
  path,
  rect,
  round,
  text,
  type Frame,
  type RenderContext,
} from './shared';

interface SizedNode extends GraphNode {
  width: number;
  height: number;
  x: number;
  y: number;
  layer: number;
}

interface EdgeIndex {
  edge: GraphEdge;
  from: number;
  to: number;
}

const NODE_FONT = 11;
const NODE_PAD_X = 20;
const NODE_PAD_Y = 16;
const MIN_WIDTH = 66;
const MAX_WIDTH = 170;
const MIN_HEIGHT = 34;
const GAP_X = 18;
const GAP_Y = 30;

function charWidth(char: string): number {
  return (char.codePointAt(0) ?? 0) >= 0x2e80 ? 11 : 6.4;
}

function measure(value: string): number {
  let width = 0;
  for (const char of value) width += charWidth(char);
  return width;
}

function wrap(value: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = '';
  let width = 0;
  for (const char of value) {
    const next = width + charWidth(char);
    if (current && next > maxWidth) {
      lines.push(current);
      current = char;
      width = charWidth(char);
    } else {
      current += char;
      width = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function frameOf(element: GraphElement, ctx: RenderContext): Frame {
  const left = ctx.mapX(element.x ?? 0);
  const top = ctx.mapY(element.y ?? 0);
  return {
    left,
    top,
    width: Math.max(1, ctx.mapX((element.x ?? 0) + (element.w ?? 100)) - left),
    height: Math.max(1, ctx.mapY((element.y ?? 0) + (element.h ?? 100)) - top),
  };
}

function buildNodes(element: GraphElement): SizedNode[] {
  return element.nodes.map((node) => {
    const textWidth = Math.max(...node.text.split('\n').map((line) => measure(line)), 20);
    const width = clamp(Math.ceil(textWidth + NODE_PAD_X * 2), MIN_WIDTH, MAX_WIDTH);
    const lineCount = wrap(node.text, MAX_WIDTH - NODE_PAD_X * 2).length;
    const baseHeight = Math.max(MIN_HEIGHT, lineCount * 15 + NODE_PAD_Y * 2 - 6);
    const height = node.shape === 'person' ? baseHeight + 16 : baseHeight;
    return { ...node, width, height, x: 0, y: 0, layer: 0 };
  });
}

function indexEdges(nodes: SizedNode[], edges: GraphEdge[]): EdgeIndex[] {
  const index = new Map(nodes.map((node, position) => [node.id, position]));
  const output: EdgeIndex[] = [];
  for (const edge of edges) {
    const from = index.get(edge.from);
    const to = index.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    output.push({ edge, from, to });
  }
  return output;
}

function assignLayers(nodes: SizedNode[], edges: EdgeIndex[]): void {
  const count = nodes.length;
  const indegree = new Array<number>(count).fill(0);
  const outgoing: number[][] = Array.from({ length: count }, () => []);
  for (const edge of edges) {
    indegree[edge.to]! += 1;
    outgoing[edge.from]!.push(edge.to);
  }
  const queue: number[] = [];
  for (let index = 0; index < count; index += 1) if (indegree[index] === 0) queue.push(index);
  const seen = new Set<number>();
  while (queue.length > 0) {
    const source = queue.shift()!;
    if (seen.has(source)) continue;
    seen.add(source);
    for (const target of outgoing[source]!) {
      nodes[target]!.layer = Math.max(nodes[target]!.layer, nodes[source]!.layer + 1);
      indegree[target]! -= 1;
      if (indegree[target] === 0) queue.push(target);
    }
  }
  // A cycle has no zero-indegree start; put leftovers on the last layer rather
  // than hiding them outside the canvas.
  const maxLayer = Math.max(0, ...nodes.map((node) => node.layer));
  for (let index = 0; index < count; index += 1) {
    if (!seen.has(index)) nodes[index]!.layer = maxLayer;
  }
}

function layered(nodes: SizedNode[], edges: EdgeIndex[], area: Frame, direction: 'TD' | 'LR'): void {
  assignLayers(nodes, edges);
  const layers = Math.max(0, ...nodes.map((node) => node.layer)) + 1;
  const groups: SizedNode[][] = Array.from({ length: layers }, () => []);
  for (const node of nodes) groups[node.layer]!.push(node);

  if (direction === 'TD') {
    const rowHeights = groups.map((group) => Math.max(0, ...group.map((node) => node.height)));
    const totalHeight = rowHeights.reduce((sum, height) => sum + height, 0) + GAP_Y * Math.max(0, layers - 1);
    let y = area.top + Math.max(0, (area.height - totalHeight) / 2);
    groups.forEach((group, layer) => {
      const rowWidth = group.reduce((sum, node) => sum + node.width, 0) + GAP_X * Math.max(0, group.length - 1);
      let x = area.left + Math.max(0, (area.width - rowWidth) / 2);
      for (const node of group) {
        node.x = x;
        node.y = y + (rowHeights[layer]! - node.height) / 2;
        x += node.width + GAP_X;
      }
      y += rowHeights[layer]! + GAP_Y;
    });
  } else {
    const columnWidths = groups.map((group) => Math.max(0, ...group.map((node) => node.width)));
    const totalWidth = columnWidths.reduce((sum, width) => sum + width, 0) + GAP_Y * Math.max(0, layers - 1);
    let x = area.left + Math.max(0, (area.width - totalWidth) / 2);
    groups.forEach((group, layer) => {
      const columnHeight = group.reduce((sum, node) => sum + node.height, 0) + GAP_X * Math.max(0, group.length - 1);
      let y = area.top + Math.max(0, (area.height - columnHeight) / 2);
      for (const node of group) {
        node.x = x + (columnWidths[layer]! - node.width) / 2;
        node.y = y;
        y += node.height + GAP_X;
      }
      x += columnWidths[layer]! + GAP_Y;
    });
  }
}

function radial(nodes: SizedNode[], edges: EdgeIndex[], area: Frame): void {
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) indegree.set(edge.edge.to, (indegree.get(edge.edge.to) ?? 0) + 1);
  const roots = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0);
  const root = roots[0] ?? nodes[0];
  if (!root) return;
  const cx = area.left + area.width / 2;
  const cy = area.top + area.height / 2;
  root.x = cx - root.width / 2;
  root.y = cy - root.height / 2;
  const others = nodes.filter((node) => node !== root);
  const radius = Math.max(30, Math.min(area.width, area.height) / 2 - Math.max(24, Math.max(...others.map((node) => node.width)) / 2));
  others.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(1, others.length)) * Math.PI * 2;
    node.x = cx + Math.cos(angle) * radius - node.width / 2;
    node.y = cy + Math.sin(angle) * radius - node.height / 2;
  });
}

function network(nodes: SizedNode[], area: Frame): void {
  const cx = area.left + area.width / 2;
  const cy = area.top + area.height / 2;
  const radius = Math.max(20, Math.min(area.width, area.height) / 2 - 26);
  nodes.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(1, nodes.length)) * Math.PI * 2;
    node.x = cx + Math.cos(angle) * radius - node.width / 2;
    node.y = cy + Math.sin(angle) * radius - node.height / 2;
  });
}

function anchorOn(node: SizedNode, towardX: number, towardY: number): { x: number; y: number } {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const dx = towardX - cx;
  const dy = towardY - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const halfW = node.width / 2 + 2;
  const halfH = node.height / 2 + 2;
  const scale = Math.min(
    Math.abs(halfW / (dx || 1e-6)),
    Math.abs(halfH / (dy || 1e-6)),
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

function drawNode(node: SizedNode, ctx: RenderContext, shapes: FigureShape[]): void {
  const color = ctx.color('ink');
  const fill = ctx.color('accent');
  const left = node.x;
  const top = node.y;
  const width = node.width;
  const height = node.height;
  const centreX = left + width / 2;
  const centreY = top + height / 2;
  const shape = node.shape ?? 'rounded';

  switch (shape) {
    case 'rect':
      shapes.push(rect(left, top, width, height, color, fill, 0.06));
      break;
    case 'rounded':
      shapes.push(rect(left, top, width, height, color, fill, 0.06, 8));
      break;
    case 'ellipse':
      shapes.push({ kind: 'ellipse', cx: round(centreX), cy: round(centreY), rx: round(width / 2), ry: round(height / 2), color, width: 1.6, fill, fillOpacity: 0.06 });
      break;
    case 'diamond':
      shapes.push(path(`M ${round(centreX)} ${round(top)} L ${round(left + width)} ${round(centreY)} L ${round(centreX)} ${round(top + height)} L ${round(left)} ${round(centreY)} Z`, color, 1.6, fill, 0.06));
      break;
    case 'parallelogram': {
      const skew = Math.min(width * 0.16, height * 0.4);
      shapes.push(path(`M ${round(left + skew)} ${round(top)} L ${round(left + width)} ${round(top)} L ${round(left + width - skew)} ${round(top + height)} L ${round(left)} ${round(top + height)} Z`, color, 1.6, fill, 0.06));
      break;
    }
    case 'class':
      shapes.push(rect(left, top, width, height, color, fill, 0.04));
      // The class name sits in the top compartment; the line starts the
      // attributes/methods compartment below it.
      shapes.push(line(left, top + Math.min(26, height * 0.62), left + width, top + Math.min(26, height * 0.62), color, 1));
      break;
    case 'entity':
      shapes.push(rect(left, top, width, height, color, fill, 0.04));
      break;
    case 'person': {
      shapes.push(circle(centreX, top + 13, 8, color, fill, 0.12));
      shapes.push(path(`M ${round(centreX - 12)} ${round(top + 30)} Q ${round(centreX)} ${round(top + 18)} ${round(centreX + 12)} ${round(top + 30)}`, color, 1.4));
      shapes.push(rect(left, top, width, height, color, fill, 0.02));
      break;
    }
    default:
      shapes.push(rect(left, top, width, height, color, fill, 0.06));
      break;
  }

  const lines = wrap(node.text, width - NODE_PAD_X * 2);
  const lineHeight = 14;
  const visibleLines = shape === 'class' ? lines.slice(0, 1) : lines;
  const startY =
    shape === 'class'
      ? top + Math.min(18, height * 0.5)
      : centreY - ((visibleLines.length - 1) * lineHeight) / 2 + 4 + (shape === 'person' ? 8 : 0);
  visibleLines.forEach((value, index) => {
    shapes.push(text(centreX, startY + index * lineHeight, value, { size: NODE_FONT, color: 'var(--ink)' }));
  });
}

export function renderGraph(element: GraphElement, ctx: RenderContext): FigureShape[] {
  const shapes: FigureShape[] = [];
  const area = frameOf(element, ctx);
  const nodes = buildNodes(element);
  const edges = indexEdges(nodes, element.edges);
  if (nodes.length === 0) return shapes;

  switch (element.layout ?? 'layered') {
    case 'tree':
      layered(nodes, edges, area, element.direction ?? 'TD');
      break;
    case 'radial':
      radial(nodes, edges, area);
      break;
    case 'network':
      network(nodes, area);
      break;
    case 'layered':
    default:
      layered(nodes, edges, area, element.direction ?? 'TD');
      break;
  }

  for (const item of edges) {
    const from = nodes[item.from];
    const to = nodes[item.to];
    if (!from || !to) continue;
    const start = anchorOn(from, to.x + to.width / 2, to.y + to.height / 2);
    const end = anchorOn(to, from.x + from.width / 2, from.y + from.height / 2);
    const color = ctx.color('muted');
    const dashed = item.edge.kind === 'inheritance' || item.edge.dashed === true;
    shapes.push(line(start.x, start.y, end.x, end.y, color, 1.3, dashed ? '5 4' : undefined));
    if (item.edge.arrow !== false) {
      shapes.push(arrowHead(start.x, start.y, end.x, end.y, color));
    }
    if (item.edge.kind === 'composition' || item.edge.kind === 'aggregation') {
      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2;
      shapes.push(path(`M ${round(midX - 4)} ${round(midY)} L ${round(midX)} ${round(midY - 4)} L ${round(midX + 4)} ${round(midY)} L ${round(midX)} ${round(midY + 4)} Z`, color, 1, item.edge.kind === 'composition' ? color : undefined, item.edge.kind === 'composition' ? 0.3 : undefined));
    }
    if (item.edge.label) {
      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2;
      shapes.push(text(midX, midY - 4, item.edge.label, { size: 9, color: 'var(--ink-3)' }));
    }
  }

  for (const node of nodes) drawNode(node, ctx, shapes);
  // A small legend for grouped nodes (UML classes, network zones).
  const groups = [...new Set(nodes.map((node) => node.group).filter((group): group is string => Boolean(group)))];
  groups.slice(0, 4).forEach((group, index) => {
    shapes.push(rect(area.left + 4, area.top + 4 + index * 14, 8, 8, ctx.color('muted'), paletteColor(ctx, index), 0.5));
    shapes.push(text(area.left + 16, area.top + 11 + index * 14, group.slice(0, 16), { size: 8, anchor: 'start', color: 'var(--ink-3)' }));
  });
  return shapes;
}
