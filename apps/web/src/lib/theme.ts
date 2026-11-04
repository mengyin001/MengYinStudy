import type { FontScale, Locale, ThemeMode } from '@mengyin/core';

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
