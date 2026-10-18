'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { utcToZoned, zonedToUtc } from '@/lib/social/schedule';
import type { PageRow } from '@/lib/data/social';

const COMMON_ZONES = ['Africa/Algiers', 'Africa/Casablanca', 'Africa/Tunis', 'Africa/Cairo', 'Europe/Paris', 'Europe/Berlin', 'Europe/London', 'Asia/Riyadh', 'Asia/Dubai', 'America/New_York', 'UTC'];

/** Choose the Page and the local date/time (in a time zone). "Publish now" queues it immediately. */
export function ScheduleDialog({
  open,
  pages,
  suggested,
  busy,
  onSchedule,
  onClose,
}: {
  open: boolean;
  pages: PageRow[];
  suggested: { local: string; timezone: string } | null;
  busy: boolean;
  onSchedule: (pageId: string, local: string | null, timezone: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const s = t.social.schedule;
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const browserZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  const active = pages.filter((p) => p.status === 'active' && p.connection_status === 'connected');
  const [page, setPage] = useState(active[0]?.id ?? '');
  const [zone, setZone] = useState(suggested?.timezone ?? browserZone);
  const [local, setLocal] = useState(suggested?.local ?? utcToZoned(new Date(Date.now() + 3_600_000), suggested?.timezone ?? browserZone));
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    if (!page && active[0]) setPage(active[0].id);
  }, [active, page]);
  const zones = [...new Set([zone, browserZone, ...COMMON_ZONES])];
  let utc = '';
  try {
    utc = zonedToUtc(local, zone).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  } catch {
    utc = '';
  }
  const chosen = active.find((p) => p.id === page);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby={`${id}-h`}>
      <div className="dialog-body stack">
        <h2 id={`${id}-h`}>{s.title}</h2>
        {active.length === 0 ? (
          <p className="callout callout-warning small">{s.noPages}</p>
        ) : (
          <>
            <label className="field">
              <span className="field-label">{s.page}</span>
              <select className="select" value={page} onChange={(e) => setPage(e.target.value)}>
                {active.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.page_name}
                    {p.is_mock ? ` · ${s.simulated}` : ''}
                  </option>
                ))}
              </select>
            </label>
            {chosen?.is_mock && <p className="xsmall muted">{s.simulatedNote}</p>}
            <div className="form-grid cols-2">
              <label className="field">
                <span className="field-label">{s.when}</span>
                <input className="input ltr" type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} data-testid="schedule-time" />
              </label>
              <label className="field">
                <span className="field-label">{s.zone}</span>
                <select className="select" value={zone} onChange={(e) => setZone(e.target.value)} data-testid="schedule-zone">
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {utc && <p className="xsmall muted ltr">= {utc}</p>}
            {suggested && <p className="xsmall muted">{fmt(s.suggested, { time: suggested.local.replace('T', ' '), zone: suggested.timezone })}</p>}
          </>
        )}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={() => ref.current?.close()}>
          {t.common.cancel}
        </button>
        <button type="button" className="btn" disabled={busy || !page} onClick={() => onSchedule(page, null, zone)} data-testid="publish-now">
          {s.now}
        </button>
        <button type="button" className="btn btn-primary" disabled={busy || !page || !utc} onClick={() => onSchedule(page, local, zone)} data-testid="confirm-schedule">
          {s.confirm}
        </button>
      </div>
    </dialog>
  );
}
