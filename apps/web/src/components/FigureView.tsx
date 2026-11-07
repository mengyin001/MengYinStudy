import { useMemo } from 'react';
import {
  describeFigure,
  layoutFigure,
  parseFigureSpec,
  type FigureShape,
  type FigureSpec,
} from '@mengyin/core';

interface FigureViewProps {
  spec: FigureSpec;
  alt?: string;
  className?: string;
}

function shapeNode(shape: FigureShape, index: number) {
  switch (shape.kind) {
    case 'line':
      return (
        <line
          key={index}
          x1={shape.x1}
          y1={shape.y1}
          x2={shape.x2}
          y2={shape.y2}
          stroke={shape.color}
          strokeWidth={shape.width}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          {...(shape.dash ? { strokeDasharray: shape.dash } : {})}
        />
      );
    case 'path':
      return (
        <path
          key={index}
          d={shape.d}
          stroke={shape.color}
          strokeWidth={shape.width}
          fill={shape.fill ?? 'none'}
          {...(shape.fillOpacity !== undefined ? { fillOpacity: shape.fillOpacity } : {})}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          {...(shape.dash ? { strokeDasharray: shape.dash } : {})}
        />
      );
    case 'circle':
      return (
        <circle
          key={index}
          cx={shape.cx}
          cy={shape.cy}
          r={shape.r}
          stroke={shape.color}
          strokeWidth={shape.width}
          fill={shape.fill ?? 'none'}
          {...(shape.fillOpacity !== undefined ? { fillOpacity: shape.fillOpacity } : {})}
          vectorEffect="non-scaling-stroke"
        />
      );
    case 'text':
      return (
        <text
          key={index}
          x={shape.x}
          y={shape.y}
          fill={shape.color}
          fontSize={shape.size}
          textAnchor={shape.anchor}
          fontWeight={shape.weight ?? 400}
          fontFamily={shape.mono ? 'var(--mono)' : 'var(--sans)'}
        >
          {shape.text}
        </text>
      );
    case 'rect':
      return (
        <rect
          key={index}
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          rx={shape.rx ?? 0}
          stroke={shape.color}
          strokeWidth={1.4}
          fill={shape.fill ?? 'none'}
          {...(shape.fillOpacity !== undefined ? { fillOpacity: shape.fillOpacity } : {})}
          vectorEffect="non-scaling-stroke"
        />
      );
    case 'ellipse':
      return (
        <ellipse
          key={index}
          cx={shape.cx}
          cy={shape.cy}
          rx={shape.rx}
          ry={shape.ry}
          stroke={shape.color}
          strokeWidth={shape.width}
          fill={shape.fill ?? 'none'}
          {...(shape.fillOpacity !== undefined ? { fillOpacity: shape.fillOpacity } : {})}
          vectorEffect="non-scaling-stroke"
        />
      );
    default:
      return null;
  }
}

/**
 * Draw a figure spec as inline SVG. This is our own renderer, not a sandbox:
 * the spec format has no code and no HTML, so nothing here can execute. The
 * only model-supplied computation is a plotted formula, which
 * `layoutFigure` evaluates with a capability-free interpreter.
 */
export function FigureView({ spec, alt, className }: FigureViewProps) {
  // Re-validate at render time as well as on load: local decks and drafts may
  // predate a normalisation rule (for example pixel-scale plain coordinates),
  // and a stored spec must never be trusted just because it type-checks.
  const parsed = useMemo(() => parseFigureSpec(spec), [spec]);
  const drawing = useMemo(() => (parsed ? layoutFigure(parsed) : null), [parsed]);
  if (!parsed || !drawing) return null;
  const label = alt ?? describeFigure(parsed);
  return (
    <div className={`figure ${className ?? ''}`.trim()} role="img" aria-label={label} data-figure="">
      {parsed.title ? <div className="figure__title">{parsed.title}</div> : null}
      <svg viewBox={`0 0 ${drawing.width} ${drawing.height}`} width="100%" role="presentation" focusable="false">
        {drawing.shapes.map(shapeNode)}
      </svg>
    </div>
  );
}
