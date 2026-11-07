/** Absolute URL for a docs route, so links can open in their own tab. */
export function docsUrl(path = '/docs'): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (typeof window === 'undefined') return `#${normalized}`;
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = `#${normalized}`;
  return url.href;
}
