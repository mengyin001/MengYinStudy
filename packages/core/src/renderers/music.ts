/**
 * The music-staff renderer.
 *
 * A model supplies pitches ("C4", "F#5"), durations and rests. The renderer owns
 * the five lines, the clef, stems and ledger lines, so a note cannot drift off
 * the staff or lose its accidental.
 */
import type { FigureShape, MusicElement, MusicNote } from '../figure';
import { line, text, type Frame, type RenderContext } from './shared';

const INK = 'var(--ink)';

const STEPS: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

function frameOf(element: MusicElement, ctx: RenderContext): Frame {
  const left = ctx.mapX(element.x);
  const top = ctx.mapY(element.y);
  return {
    left,
    top,
    width: Math.max(1, ctx.mapX(element.x + element.w) - left),
    height: Math.max(1, ctx.mapY(element.y + element.h) - top),
  };
}

function parsePitch(value: string): { step: number; octave: number; accidental: string } | null {
  const match = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(value.trim());
  if (!match) return null;
  return {
    step: STEPS[match[1]!.toUpperCase()] ?? 0,
    octave: Number(match[3]),
    accidental: match[2] ?? '',
  };
}

export function renderMusic(element: MusicElement, ctx: RenderContext): FigureShape[] {
  const shapes: FigureShape[] = [];
  const area = frameOf(element, ctx);
  const spacing = Math.max(7, Math.min(12, area.height / 8));
  const lineGap = spacing;
  const bottomLine = area.top + area.height - spacing * 2.4;
  const topLine = bottomLine - lineGap * 4;
  for (let index = 0; index < 5; index += 1) {
    const y = topLine + index * lineGap;
    shapes.push(line(area.left + 24, y, area.left + area.width - 8, y, INK, 1));
  }
  const clef = element.clef === 'bass' ? '𝄢' : '𝄞';
  shapes.push(text(area.left + 14, bottomLine - lineGap + 4, clef, { size: spacing * 3, color: INK }));
  if (element.key) {
    shapes.push(text(area.left + 30, topLine + lineGap * 1.5 + 4, element.key.slice(0, 4), { size: spacing, color: INK }));
  }
  if (element.time) {
    shapes.push(text(area.left + 42, topLine + lineGap * 1.5 + 4, element.time.slice(0, 6), { size: spacing, color: INK }));
  }

  const startX = area.left + (element.time ? 62 : element.key ? 48 : 38);
  const available = Math.max(20, area.left + area.width - 12 - startX);
  const stepX = available / Math.max(1, element.notes.length + 0.5);
  // Treble: bottom line is E4 (diatonic index 30). Bass: bottom line is G2 (18).
  const bottomIndex = element.clef === 'bass' ? 18 : 30;

  element.notes.forEach((note: MusicNote, index) => {
    const x = startX + stepX * (index + 0.5);
    if (note.rest) {
      shapes.push(text(x, topLine + lineGap * 2 + 4, '𝄽', { size: spacing * 1.8, color: INK }));
      return;
    }
    const pitch = parsePitch(note.pitch);
    if (!pitch) return;
    const diatonic = pitch.octave * 7 + pitch.step;
    const y = bottomLine - (diatonic - bottomIndex) * (lineGap / 2);
    const accidental =
      note.accidental === '#'
        ? '#'
        : note.accidental === 'b'
          ? 'b'
          : note.accidental === 'n'
            ? '♮'
            : pitch.accidental === '#'
              ? '#'
              : pitch.accidental === 'b'
                ? 'b'
                : '';
    if (accidental) {
      shapes.push(text(x - 9, y + 3, accidental, { size: spacing, color: INK }));
    }
    const duration = note.duration ?? 1;
    const open = duration >= 2;
    shapes.push({
      kind: 'ellipse',
      cx: Math.round(x * 100) / 100,
      cy: Math.round(y * 100) / 100,
      rx: Math.round(spacing * 0.46 * 100) / 100,
      ry: Math.round(spacing * 0.34 * 100) / 100,
      color: INK,
      width: 1.3,
      ...(open ? { fill: 'var(--surface, #fff)' } : { fill: INK, fillOpacity: 1 }),
    });
    if (duration >= 0.5) {
      const stemUp = y > topLine + lineGap * 2;
      const stemX = x + (stemUp ? spacing * 0.42 : -spacing * 0.42);
      const stemY = stemUp ? y - spacing * 2.2 : y + spacing * 2.2;
      shapes.push(line(stemX, y, stemX, stemY, INK, 1.2));
      if (duration < 1) {
        shapes.push(line(stemX, stemY, stemX + spacing * 0.5, stemY + spacing * 0.5, INK, 1.4));
      }
    }
    // Ledger lines for notes above or below the staff.
    for (let ledger = topLine - lineGap; ledger >= y - 1; ledger -= lineGap) {
      shapes.push(line(x - spacing * 0.7, ledger, x + spacing * 0.7, ledger, INK, 1));
    }
    for (let ledger = bottomLine + lineGap; ledger <= y + 1; ledger += lineGap) {
      shapes.push(line(x - spacing * 0.7, ledger, x + spacing * 0.7, ledger, INK, 1));
    }
  });

  // A bar line closes the staff.
  shapes.push(line(area.left + area.width - 6, topLine, area.left + area.width - 6, bottomLine, INK, 1.6));
  return shapes;
}
