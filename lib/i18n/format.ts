import { fmt } from './config';
import type { Dictionary } from './dictionaries/en';

export function formatDuration(t: Dictionary, totalSeconds: number): string {
  if (totalSeconds < 60) return fmt(t.common.seconds, { n: totalSeconds });
  return fmt(t.common.minutesSeconds, { m: Math.floor(totalSeconds / 60), s: totalSeconds % 60 });
}

export function formatDate(intl: string, iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(intl, opts).format(d);
}

export function formatRelative(intl: string, iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Math.round((then - now) / 1000);
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(intl, { numeric: 'auto' });
  if (abs < 60) return rtf.format(diff, 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return formatDate(intl, iso);
}

export function formatNumber(intl: string, n: number): string {
  return new Intl.NumberFormat(intl).format(n);
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : fmt(many, { n });
}
