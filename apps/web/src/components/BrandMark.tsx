/**
 * The MengYin Study mark: a cream M whose outer strokes are stacked book
 * spines, with a terracotta bookmark dropping into the centre. The bookmark is
 * the part that survives at 16 px and makes the mark recognisable without the
 * wordmark next to it.
 *
 * The same geometry is repeated in `public/icons/favicon.svg` and rasterised
 * by `tools/make-icons.py`; change all three together.
 */
const M_PATH = 'M17 46 L17 20 L32 36 L47 20 L47 46';
const PAGE_LINES =
  'M14 25 H20 M14 31 H20 M14 37 H20 M44 25 H50 M44 31 H50 M44 37 H50';
const BOOKMARK_PATH = 'M30.5 14 L33.5 14 L33.5 28 L32 26.2 L30.5 28 Z';

export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <svg className={`brand-mark ${className}`.trim()} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect className="brand-mark__plate" width="64" height="64" rx="13" />
      <path className="brand-mark__letter" d={M_PATH} />
      <path className="brand-mark__pages" d={PAGE_LINES} />
      <path className="brand-mark__seal" d={BOOKMARK_PATH} />
    </svg>
  );
}
