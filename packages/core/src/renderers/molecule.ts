/**
 * The molecule renderer.
 *
 * Skeletal formulae, reaction schemes, crystal lattices and orbital diagrams.
 * The model supplies atoms and bonds by index; the renderer draws the bonds,
 * places the heteroatom labels and keeps the reaction arrow between groups.
 */
import type { FigureShape, MoleculeAtom, MoleculeElement, MoleculeGroup } from '../figure';
import { arrow, circle, line, text, type Frame, type RenderContext } from './shared';

const INK = 'var(--ink)';

function frameOf(element: MoleculeElement, ctx: RenderContext): Frame {
  const left = ctx.mapX(element.x);
  const top = ctx.mapY(element.y);
  return {
    left,
    top,
    width: Math.max(1, ctx.mapX(element.x + element.w) - left),
    height: Math.max(1, ctx.mapY(element.y + element.h) - top),
  };
}

function atomPosition(atom: MoleculeAtom, area: Frame): [number, number] {
  return [area.left + (atom.x / 100) * area.width, area.top + (atom.y / 100) * area.height];
}

function drawGroup(
  group: MoleculeGroup,
  area: Frame,
  shapes: FigureShape[],
  crystal: boolean,
): void {
  const positions = group.atoms.map((atom) => atomPosition(atom, area));
  for (const bond of group.bonds) {
    const from = positions[bond.from];
    const to = positions[bond.to];
    if (!from || !to) continue;
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const order = bond.order ?? 1;
    const offsets = order === 3 ? [-3, 0, 3] : order === 2 ? [-2.4, 2.4] : [0];
    for (const offset of offsets) {
      shapes.push(
        line(
          from[0] + nx * offset,
          from[1] + ny * offset,
          to[0] + nx * offset,
          to[1] + ny * offset,
          INK,
          1.5,
        ),
      );
    }
  }
  group.atoms.forEach((atom, index) => {
    const position = positions[index];
    if (!position) return;
    const label = atom.label ?? atom.element;
    const isCarbon = atom.element === 'C' && !atom.label;
    if (crystal) {
      shapes.push(circle(position[0], position[1], 4, INK, 'var(--accent)', 0.25));
      shapes.push(text(position[0], position[1] - 7, label.slice(0, 4), { size: 8, color: INK }));
      return;
    }
    if (isCarbon) return;
    const radius = Math.max(7, label.length * 3.4 + 4);
    shapes.push(circle(position[0], position[1], radius, INK, 'var(--surface, #fff)', 1));
    shapes.push(text(position[0], position[1] + 3.5, label.slice(0, 4), { size: 10, color: INK }));
    if (atom.charge) {
      shapes.push(text(position[0] + radius + 1, position[1] - radius, atom.charge.slice(0, 3), { size: 7, anchor: 'start', color: INK }));
    }
  });
  if (group.label) {
    shapes.push(text(area.left + area.width / 2, area.top + area.height - 4, group.label.slice(0, 24), { size: 9, color: 'var(--ink-3)' }));
  }
}

function orbital(element: MoleculeElement, area: Frame, shapes: FigureShape[]): void {
  const levels = [...(element.levels ?? [])].sort((a, b) => a.energy - b.energy);
  if (levels.length === 0) return;
  const min = levels[0]!.energy;
  const max = levels[levels.length - 1]!.energy;
  const yMap = (energy: number): number =>
    area.top + area.height - 12 - ((energy - min) / (max - min || 1)) * (area.height - 24);
  levels.forEach((level) => {
    const y = yMap(level.energy);
    shapes.push(line(area.left + 40, y, area.left + area.width - 20, y, INK, 1.6));
    if (level.label) {
      shapes.push(text(area.left + 36, y + 3, level.label.slice(0, 16), { size: 9, anchor: 'end', color: INK }));
    }
    const electrons = Math.min(4, Math.max(0, level.electrons ?? 0));
    for (let index = 0; index < electrons; index += 1) {
      const x = area.left + 52 + index * 10;
      shapes.push(text(x, y - 3, index % 2 === 0 ? '↑' : '↓', { size: 12, color: 'var(--accent)' }));
    }
  });
  shapes.push(text(area.left + 8, area.top + 10, 'E', { size: 9, color: 'var(--ink-3)' }));
}

export function renderMolecule(element: MoleculeElement, ctx: RenderContext): FigureShape[] {
  const shapes: FigureShape[] = [];
  const area = frameOf(element, ctx);
  const mode = element.mode ?? 'structure';
  if (mode === 'orbital') {
    orbital(element, area, shapes);
    return shapes;
  }
  const groups = element.groups ?? [];
  if (groups.length === 0) return shapes;
  if (mode === 'reaction' && groups.length >= 2) {
    const cellWidth = area.width / groups.length;
    groups.forEach((group, index) => {
      const cell: Frame = {
        left: area.left + index * cellWidth,
        top: area.top,
        width: cellWidth,
        height: area.height,
      };
      drawGroup(group, cell, shapes, false);
      if (index < groups.length - 1) {
        const arrowY = area.top + area.height / 2;
        shapes.push(...arrow(cell.left + cellWidth - 8, arrowY, cell.left + cellWidth + 8, arrowY, INK, 1.8));
      }
    });
    if (element.arrowLabel) {
      shapes.push(text(area.left + area.width / 2, area.top + area.height / 2 - 10, element.arrowLabel.slice(0, 28), { size: 9, color: 'var(--ink-2)' }));
    }
    return shapes;
  }
  drawGroup(groups[0]!, area, shapes, mode === 'crystal');
  return shapes;
}
