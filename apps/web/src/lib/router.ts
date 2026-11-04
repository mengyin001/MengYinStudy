import { useEffect, useState } from 'react';

export interface Route {
  /** Path without query, always starts with `/`. */
  path: string;
  segments: string[];
  query: URLSearchParams;
}

const NAV_EVENT = 'app:navigate';

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [pathPart = '/', queryPart = ''] = raw.split('?');
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  return {
    path,
    segments: path.split('/').filter(Boolean),
    query: new URLSearchParams(queryPart),
  };
}

function currentRoute(): Route {
  return parseHash(window.location.hash);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(currentRoute);
  useEffect(() => {
    const update = () => setRoute(currentRoute());
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    window.addEventListener(NAV_EVENT, update);
    return () => {
      window.removeEventListener('hashchange', update);
      window.removeEventListener('popstate', update);
      window.removeEventListener(NAV_EVENT, update);
    };
  }, []);
  return route;
}

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  const [pathname = '', search = ''] = path.split('?');
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const target = `#${normalized}${search ? `?${search}` : ''}`;
  if (window.location.hash === target) {
    window.dispatchEvent(new Event(NAV_EVENT));
    return;
  }
  if (options.replace) {
    window.history.replaceState(null, '', target);
  } else {
    window.history.pushState(null, '', target);
  }
  window.dispatchEvent(new Event(NAV_EVENT));
}

export function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === false || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
