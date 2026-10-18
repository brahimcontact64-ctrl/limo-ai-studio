/**
 * Time zone maths without libraries (Intl only). Times are stored in UTC with the IANA zone the customer
 * chose; the database converts the same way (`timestamp AT TIME ZONE`).
 */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parts(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return { y: +o.year!, m: +o.month!, d: +o.day!, h: +o.hour!, min: +o.minute!, s: +o.second!, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday!) };
}

/** Offset of `tz` from UTC at `date`, in minutes. */
export function zoneOffsetMinutes(date: Date, tz: string): number {
  const p = parts(date, tz);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** "2026-10-20T18:30" in `tz` → UTC Date. Times skipped by a DST change move forward, like Postgres. */
export function zonedToUtc(local: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new Error('invalid_local_time');
  const asUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  let guess = asUtc - zoneOffsetMinutes(new Date(asUtc), tz) * 60000;
  guess = asUtc - zoneOffsetMinutes(new Date(guess), tz) * 60000;
  return new Date(guess);
}

/** UTC Date → "YYYY-MM-DDTHH:mm" wall-clock time in `tz` (for datetime-local inputs). */
export function utcToZoned(date: Date, tz: string): string {
  const p = parts(date, tz);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${p.y}-${z(p.m)}-${z(p.d)}T${z(p.h)}:${z(p.min)}`;
}

/** Day of week (0 = Sunday) in `tz`. */
export function weekdayIn(date: Date, tz: string): number {
  return parts(date, tz).weekday;
}

/**
 * Next slot of a weekly plan (days 0–6, "HH:mm" times) strictly after `after`, in `tz`.
 * Returns null when the plan has no days or times.
 */
export function nextSlot(days: number[], times: string[], tz: string, after: Date): Date | null {
  const valid = times.filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)).sort();
  if (!days.length || !valid.length) return null;
  for (let i = 0; i < 8; i++) {
    const day = new Date(after.getTime() + i * 86_400_000);
    const local = utcToZoned(day, tz).slice(0, 10);
    for (const t of valid) {
      const at = zonedToUtc(`${local}T${t}`, tz);
      if (at.getTime() > after.getTime() && days.includes(weekdayIn(at, tz))) return at;
    }
  }
  return null;
}
