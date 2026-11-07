import type { FigureShape } from '../figure';

/** Everything a compound renderer needs to draw in SVG pixel space. */
export interface RenderContext {
  width: number;
  height: number;
  /** True for the plain percentage canvas. */
  plain: boolean;
  mapX(x: number): number;
  mapY(y: number): number;
  color(value: unknown, fallback?: string): string;
}

export type Renderer<T> = (element: T, ctx: RenderContext) => FigureShape[];
