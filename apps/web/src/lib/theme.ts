import type { FontScale, Locale, ThemeMode } from '@mengyin/core';

/**
 * Small mirror of the resolved theme for pages that are not the React app.
 *
 * The static privacy and terms pages are self-contained HTML with no bundle.
 * They read this key before paint so a reader who chose dark in the app does
 * not land on a light legal page. The stored value is the theme *mode*
 * (`light`, `dark` or `system`); `system` deliberately leaves the page to
 * `prefers-color-scheme`, so it keeps following the OS after the app closes.
 */
export const THEME_STORAGE_KEY = 'mengyin:theme';

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function applyAppearance(mode: ThemeMode, fontScale: FontScale, locale: Locale = 'en'): void {
  const root = document.documentElement;
  const resolved = resolveTheme(mode);
  root.dataset.theme = resolved;
  root.dataset.font = fontScale;
  root.dataset.locale = locale === 'zh-Hant' ? 'zh' : 'en';
  root.lang = locale === 'zh-Hant' ? 'zh-Hant-HK' : 'en';
  root.style.colorScheme = resolved;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Private mode or a blocked storage policy: the OS preference still works.
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#14130f' : '#f6f3ec');
}

export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = () => onChange();
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
