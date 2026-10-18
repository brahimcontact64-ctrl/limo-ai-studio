'use client';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { normalizeRules } from '@/lib/social/automation';
import { POST_LANGUAGES, POST_TONES, type AutomationRules } from '@/lib/social/types';
import type { PageRow, PolicyRow } from '@/lib/data/social';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { RelativeTime } from '@/components/ui/RelativeTime';
import { useToast } from '@/components/ui/Toast';

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  return { ok: !!res?.ok, body: ((await res?.json().catch(() => ({}))) ?? {}) as Record<string, any> };
}

/** Pages (simulated until Meta is approved), emergency pause, controlled automation policies. */
export function SocialSettings({ pages, policies, paused, pausedReason, autoAvailable, canEdit, canAuthorize, pageLimit }: { pages: PageRow[]; policies: PolicyRow[]; paused: boolean; pausedReason: string | null; autoAvailable: boolean; canEdit: boolean; canAuthorize: boolean; pageLimit: number }) {
  const { t } = useI18n();
  const s = t.social;
  const a = s.automation;
  const id = useId();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: 'disconnect'; page: PageRow } | { kind: 'pause' } | { kind: 'revoke'; policy: PolicyRow }>(null);
  const [editing, setEditing] = useState<{ id: string | null; name: string; rules: AutomationRules } | null>(null);
  const [authorizing, setAuthorizing] = useState<PolicyRow | null>(null);
  const [checks, setChecks] = useState<boolean[]>([]);
  const active = pages.filter((p) => p.status === 'active');
  const err = (code?: string) => setError((s.errors as Record<string, string>)[code ?? ''] ?? t.common.errorGeneric);

  async function run(url: string, body: unknown, done: string) {
    setBusy(true);
    setError(null);
    const r = await post(url, body);
    setBusy(false);
    setConfirm(null);
    if (!r.ok) return err(r.body.error);
    toast(done, 'success');
    router.refresh();
    return r.body;
  }

  const newRules = (): AutomationRules =>
    normalizeRules({ page_id: active[0]?.id ?? '', content_types: ['approved_designs'], days: [1, 3, 5], times: ['18:00'], timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', max_posts_per_week: 3, boundary: 'review_each', language_code: 'en', tone: 'friendly' });

  return (
    <div className="stack-lg">
      <section className="panel panel-pad stack" aria-labelledby={`${id}-pages`}>
        <h2 id={`${id}-pages`} className="section-title">
          {s.pages.title}
        </h2>
        <p className="small muted">{fmt(s.pages.limit, { used: active.length, total: pageLimit })}</p>
        <div className="callout small">
          <Icon name="lock" />
          <div className="stack-sm">
            <span>{s.pages.realNote}</span>
            <div>
              <button type="button" className="btn btn-sm" disabled title={s.pages.realDisabled}>
                {s.pages.connectReal}
              </button>
            </div>
          </div>
        </div>
        {pages.length > 0 && (
          <ul className="plain-list stack-sm" data-testid="page-list">
            {pages.map((p) => (
              <li key={p.id} className="row page-row">
                <span className="avatar" aria-hidden="true">
                  {p.page_name.charAt(0)}
                </span>
                <b className="small" dir="auto">
                  {p.page_name}
                </b>
                {p.is_mock && <span className="badge badge-warning plain">{s.simulatedBadge}</span>}
                <span className={`badge ${p.status === 'active' && p.connection_status === 'connected' ? 'badge-success' : 'badge-danger'}`}>
                  {p.status !== 'active' ? s.pages.disconnected : p.connection_status === 'connected' ? s.pages.connected : s.pages.reconnect}
                </span>
                <span className="spacer" />
                {canEdit && p.status === 'active' && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm({ kind: 'disconnect', page: p })}>
                    {s.pages.disconnect}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void run('/api/social/pages', { action: 'add_mock', name }, s.pages.added).then(() => setName(''));
            }}
          >
            <label className="field">
              <span className="field-label xsmall">{s.pages.mockName}</span>
              <input className="input input-sm" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} dir="auto" />
            </label>
            <button type="submit" className="btn btn-sm" disabled={busy || !name.trim()}>
              <Icon name="plus" />
              {s.pages.addMock}
            </button>
          </form>
        )}
      </section>

      <section className="panel panel-pad stack" aria-labelledby={`${id}-pause`}>
        <h2 id={`${id}-pause`} className="section-title">
          {s.pause.title}
        </h2>
        <p className="small">{paused ? fmt(s.pause.isPaused, { reason: pausedReason ?? '—' }) : s.pause.isRunning}</p>
        {canEdit &&
          (paused ? (
            <div>
              <button type="button" className="btn" disabled={busy} onClick={() => void run('/api/social/controls', { paused: false }, s.pause.resumed)} data-testid="resume-publishing">
                {s.pause.resume}
              </button>
            </div>
          ) : (
            <div>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setConfirm({ kind: 'pause' })} data-testid="pause-publishing">
                <Icon name="alert" />
                {s.pause.pause}
              </button>
            </div>
          ))}
      </section>

      <section className="panel panel-pad stack" aria-labelledby={`${id}-auto`}>
        <h2 id={`${id}-auto`} className="section-title">
          {a.title}
        </h2>
        <p className="small muted">{a.lead}</p>
        {!autoAvailable && (
          <p className="callout callout-warning small" data-testid="automation-unavailable">
            <Icon name="lock" />
            <span>{a.unavailable}</span>
          </p>
        )}
        {policies.length > 0 && (
          <ul className="plain-list stack-sm" data-testid="policy-list">
            {policies.map((pol) => (
              <li key={pol.id} className="panel panel-pad stack-xs">
                <div className="row">
                  <b className="small" dir="auto">
                    {pol.name}
                  </b>
                  <span className={`badge ${pol.status === 'active' ? 'badge-success' : pol.status === 'revoked' ? 'badge-danger' : 'badge-warning'}`}>{a.status[pol.status]}</span>
                  <span className="xsmall muted">{fmt(a.version, { n: pol.version })}</span>
                  {pol.authorized_at && pol.status === 'active' && (
                    <span className="xsmall muted">
                      · {a.authorizedAt} <RelativeTime iso={pol.authorized_at} />
                    </span>
                  )}
                </div>
                <p className="xsmall muted">{describe(normalizeRules(pol.rules))}</p>
                {pol.paused_reason && pol.status === 'paused' && <p className="xsmall">{(a.pausedReasons as Record<string, string>)[pol.paused_reason] ?? pol.paused_reason}</p>}
                {canEdit && pol.status !== 'revoked' && (
                  <div className="row">
                    <button type="button" className="btn btn-sm" onClick={() => setEditing({ id: pol.id, name: pol.name, rules: normalizeRules(pol.rules) })}>
                      {a.edit}
                    </button>
                    {pol.status !== 'active' && canAuthorize && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={!autoAvailable || busy}
                        onClick={() => {
                          setAuthorizing(pol);
                          setChecks([false, false, false]);
                        }}
                      >
                        {a.authorize}
                      </button>
                    )}
                    {pol.status === 'active' && (
                      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void run('/api/social/policies', { action: 'pause', id: pol.id }, a.pausedToast)}>
                        {a.pause}
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirm({ kind: 'revoke', policy: pol })}>
                      {a.revoke}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && !editing && (
          <div>
            <button type="button" className="btn" disabled={active.length === 0} onClick={() => setEditing({ id: null, name: '', rules: newRules() })}>
              <Icon name="plus" />
              {a.newPolicy}
            </button>
          </div>
        )}
        {editing && (
          <PolicyEditor
            pages={active}
            value={editing}
            busy={busy}
            onCancel={() => setEditing(null)}
            onSave={(v) =>
              void run('/api/social/policies', { action: 'save', id: v.id, name: v.name, rules: v.rules }, a.saved).then((r) => {
                if (r) setEditing(null);
              })
            }
          />
        )}
      </section>

      {error && (
        <p className="callout callout-danger small" role="alert">
          {error}
        </p>
      )}

      {authorizing && (
        <div className="callout stack-sm" role="dialog" aria-label={a.authorizeTitle} data-testid="authorize-box">
          <b>{fmt(a.authorizeTitle, { name: authorizing.name, n: authorizing.version })}</b>
          <p className="small">{describe(normalizeRules(authorizing.rules))}</p>
          {a.confirmations.map((c, i) => (
            <label key={i} className="checkbox">
              <input type="checkbox" checked={checks[i] ?? false} onChange={(e) => setChecks((x) => x.map((v, j) => (j === i ? e.target.checked : v)))} />
              <span>{c}</span>
            </label>
          ))}
          <div className="row">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy || checks.some((c) => !c)}
              onClick={() => void run('/api/social/policies', { action: 'authorize', id: authorizing.id, version: authorizing.version, confirmed: true }, a.authorizedToast).then(() => setAuthorizing(null))}
            >
              {a.authorizeConfirm}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAuthorizing(null)}>
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'pause' ? s.pause.pause : confirm?.kind === 'revoke' ? a.revoke : s.pages.disconnect}
        body={confirm?.kind === 'pause' ? s.pause.confirm : confirm?.kind === 'revoke' ? a.revokeBody : s.pages.disconnectBody}
        confirmLabel={confirm?.kind === 'pause' ? s.pause.pause : confirm?.kind === 'revoke' ? a.revoke : s.pages.disconnect}
        danger
        busy={busy}
        onConfirm={() => {
          if (confirm?.kind === 'disconnect') void run('/api/social/pages', { action: 'disconnect', page_id: confirm.page.id }, s.pages.removed);
          else if (confirm?.kind === 'pause') void run('/api/social/controls', { paused: true, reason: s.pause.reasonDefault }, s.pause.pausedToast);
          else if (confirm?.kind === 'revoke') void run('/api/social/policies', { action: 'revoke', id: confirm.policy.id }, a.revokedToast);
        }}
        onClose={() => setConfirm(null)}
      />
    </div>
  );

  function describe(r: AutomationRules) {
    const page = pages.find((p) => p.id === r.page_id)?.page_name ?? '—';
    return fmt(a.summary, {
      page,
      days: r.days.map((d) => a.days[d]).join(', ') || '—',
      times: r.times.join(', ') || '—',
      zone: r.timezone,
      max: r.max_posts_per_week,
      boundary: a.boundaries[r.boundary],
    });
  }
}

function PolicyEditor({ pages, value, busy, onSave, onCancel }: { pages: PageRow[]; value: { id: string | null; name: string; rules: AutomationRules }; busy: boolean; onSave: (v: { id: string | null; name: string; rules: AutomationRules }) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const a = t.social.automation;
  const [v, setV] = useState(value);
  const r = v.rules;
  const setR = (patch: Partial<AutomationRules>) => setV((x) => ({ ...x, rules: { ...x.rules, ...patch } }));
  return (
    <form
      className="panel panel-pad stack"
      data-testid="policy-editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(v);
      }}
    >
      <label className="field">
        <span className="field-label">{a.name}</span>
        <input className="input" value={v.name} maxLength={120} onChange={(e) => setV((x) => ({ ...x, name: e.target.value }))} dir="auto" required />
      </label>
      <div className="form-grid cols-2">
        <label className="field">
          <span className="field-label">{a.page}</span>
          <select className="select" value={r.page_id} onChange={(e) => setR({ page_id: e.target.value })}>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.page_name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{a.boundary}</span>
          <select className="select" value={r.boundary} onChange={(e) => setR({ boundary: e.target.value as AutomationRules['boundary'] })}>
            <option value="review_each">{a.boundaries.review_each}</option>
            <option value="publish_within_policy">{a.boundaries.publish_within_policy}</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">{a.maxPerWeek}</span>
          <input className="input ltr" type="number" min={1} max={21} value={r.max_posts_per_week} onChange={(e) => setR({ max_posts_per_week: Math.max(1, Math.min(21, Number(e.target.value) || 1)) })} />
        </label>
        <label className="field">
          <span className="field-label">{a.times}</span>
          <input className="input ltr" value={r.times.join(', ')} onChange={(e) => setR({ times: e.target.value.split(/[,\s]+/).filter(Boolean) })} placeholder="09:00, 18:00" />
        </label>
        <label className="field">
          <span className="field-label">{a.zone}</span>
          <input className="input ltr" value={r.timezone} onChange={(e) => setR({ timezone: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">{t.social.language}</span>
          <select className="select" value={r.language_code} onChange={(e) => setR({ language_code: e.target.value as AutomationRules['language_code'] })}>
            {POST_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {t.social.languages[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t.social.tone}</span>
          <select className="select" value={r.tone} onChange={(e) => setR({ tone: e.target.value as AutomationRules['tone'] })}>
            {POST_TONES.map((x) => (
              <option key={x} value={x}>
                {t.social.tones[x]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="field">
        <legend className="field-label">{a.daysLabel}</legend>
        <div className="row">
          {a.days.map((d, i) => (
            <label key={i} className="checkbox">
              <input type="checkbox" checked={r.days.includes(i)} onChange={(e) => setR({ days: e.target.checked ? [...r.days, i].sort() : r.days.filter((x) => x !== i) })} />
              <span>{d}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="field">
        <legend className="field-label">{a.content}</legend>
        <div className="row">
          {(['approved_designs', 'approved_videos'] as const).map((c) => (
            <label key={c} className="checkbox">
              <input type="checkbox" checked={r.content_types.includes(c)} onChange={(e) => setR({ content_types: e.target.checked ? [...r.content_types, c] : r.content_types.filter((x) => x !== c) })} />
              <span>{a.contentTypes[c]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="field">
        <span className="field-label">{a.topics}</span>
        <textarea className="textarea" rows={2} maxLength={500} value={r.topics} onChange={(e) => setR({ topics: e.target.value })} dir="auto" />
      </label>
      <p className="xsmall muted">{a.factsNote}</p>
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={busy || !v.name.trim() || !r.page_id}>
          {a.save}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          {t.common.cancel}
        </button>
      </div>
      <p className="xsmall muted">{a.saveNote}</p>
    </form>
  );
}
