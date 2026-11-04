import type { Locale } from '@mengyin/core';

const dayMs = 86_400_000;

function intlLocale(locale: Locale): string {
  return locale === 'zh-Hant' ? 'zh-Hant-HK' : 'en-GB';
}

export function pct(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDuration(ms: number, locale: Locale = 'en'): string {
  if (!Number.isFinite(ms) || ms <= 0) return locale === 'zh-Hant' ? '0 分鐘' : '0 min';
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return locale === 'zh-Hant' ? `${hours} 小時 ${minutes} 分` : `${hours}h ${minutes}m`;
  }
  if (minutes > 0) return locale === 'zh-Hant' ? `${minutes} 分鐘` : `${minutes} min`;
  return locale === 'zh-Hant' ? `${totalSeconds} 秒` : `${totalSeconds}s`;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${`${minutes}`.padStart(2, '0')}:${`${seconds}`.padStart(2, '0')}`;
}

export function formatDate(ts: number, locale: Locale = 'en', now = Date.now()): string {
  const date = new Date(ts);
  const startOf = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diffDays = Math.round((startOf(new Date(now)) - startOf(date)) / dayMs);
  if (diffDays <= 0) return locale === 'zh-Hant' ? '今日' : 'Today';
  if (diffDays === 1) return locale === 'zh-Hant' ? '昨日' : 'Yesterday';
  if (diffDays < 7) return locale === 'zh-Hant' ? `${diffDays} 日前` : `${diffDays} days ago`;
  return new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'short' }).format(date);
}

export function formatLongDate(ts: number, locale: Locale = 'en'): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(ts));
}

export function formatShortDay(ts: number, locale: Locale = 'en'): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: '2-digit',
    month: 'short',
  }).format(new Date(ts));
}

export function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** 1.4 MB / 820 KB / 1 GB, with one decimal place only when it helps. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text =
    unit === 0 || value >= 100 || Number.isInteger(value)
      ? String(Math.round(value))
      : value.toFixed(1);
  return `${text} ${units[unit]}`;
}

