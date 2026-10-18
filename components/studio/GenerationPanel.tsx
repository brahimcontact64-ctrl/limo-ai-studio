'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';

interface Item { scene_number: number; asset_id: string; role: 'image' | 'video' | 'voice'; decision: 'applied' | 'rejected' | null }
interface State {
  availability: { available: boolean; reason: string | null; estimate_cents?: number };
  run: { id: string; status: string; failure_code: string | null } | null;
  items: Item[];
  assets: Record<string, { url: string | null; label: string; mock: boolean; mime: string }>;
  can_edit: boolean;
}

const ACTIVE = ['awaiting_safety', 'queued', 'processing'];
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * AI scenes (Milestone 10). Shows whether AI generation is available and its exact estimate (confirmed before
 * anything is reserved), the latest run, and each generated scene file as a proposal the customer can use or
 * reject. Nothing generated is applied automatically; "Use" sets that scene's media in the Video settings.
 */
export function GenerationPanel({ projectId, onUse }: { projectId: string; onUse: (scene: number, assetId: string) => void }) {
  const { t } = useI18n();
  const g = t.video.ai;
  const id = useId();
  const toast = useToast();
  const [state, setState] = useState<State | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/generation`).catch(() => null);
    if (res?.ok) setState((await res.json()) as State);
  }, [projectId]);
  useEffect(() => {
    void load();
  }, [load]);
  const running = !!state?.run && ACTIVE.includes(state.run.status);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [running, load]);

  if (!state) return null;
  const a = state.availability;
  const reason = a.available ? null : ((g.reasons as Record<string, string>)[a.reason ?? ''] ?? g.reasons.not_enabled);

  async function start() {
    if (!a.available || a.estimate_cents === undefined) return;
    setBusy(true);
    key.current ??= crypto.randomUUID().replace(/-/g, '');
    const res = await fetch(`/api/projects/${projectId}/generation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm_cents: a.estimate_cents, idempotency_key: key.current }) }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    setConfirming(false);
    if (!res?.ok) {
      toast((g.errors as Record<string, string>)[body.error ?? ''] ?? t.common.errorGeneric, 'error');
      if (res) key.current = null;
      await load();
      return;
    }
    key.current = null;
    toast(g.started, 'success');
    await load();
  }

  async function decide(item: Item, decision: 'applied' | 'rejected') {
    const res = await fetch('/api/generation/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run_id: state!.run!.id, scene_number: item.scene_number, asset_id: item.asset_id, decision }) }).catch(() => null);
    if (!res?.ok) {
      toast(t.common.errorGeneric, 'error');
      return;
    }
    if (decision === 'applied') {
      onUse(item.scene_number, item.asset_id);
      toast(fmt(g.used, { n: item.scene_number }), 'success');
    }
    await load();
  }

  return (
    <section className="panel panel-pad stack" aria-labelledby={`${id}-ai`} data-testid="ai-panel">
      <div className="row">
        <h3 id={`${id}-ai`} className="section-title">
          {g.title}
        </h3>
      </div>
      <p className="small muted">{g.lead}</p>
      {reason ? (
        <p className="small" data-testid="ai-unavailable">
          {reason}
        </p>
      ) : (
        <div className="stack-sm">
          <p className="small" data-testid="ai-estimate">
            {fmt(g.estimate, { amount: usd(a.estimate_cents ?? 0) })}
          </p>
          {state.can_edit && !confirming && (
            <div>
              <button type="button" className="btn btn-primary" onClick={() => setConfirming(true)} disabled={busy || running} data-testid="ai-generate">
                <Icon name="sparkle" />
                {g.generate}
              </button>
            </div>
          )}
          {confirming && (
            <div className="callout callout-warning stack-sm" role="alertdialog" aria-labelledby={`${id}-confirm`} data-testid="ai-confirm">
              <p id={`${id}-confirm`} className="small">
                {fmt(g.confirmBody, { amount: usd(a.estimate_cents ?? 0) })}
              </p>
              <div className="row">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void start()} disabled={busy}>
                  {fmt(g.confirm, { amount: usd(a.estimate_cents ?? 0) })}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setConfirming(false)} disabled={busy}>
                  {t.common.cancel}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {state.run && (
        <p className="small muted" data-testid="ai-run-status">
          {fmt(g.lastRun, { status: (g.status as Record<string, string>)[state.run.status] ?? state.run.status })}
          {state.run.failure_code ? ` · ${state.run.failure_code}` : ''}
        </p>
      )}
      {state.items.length > 0 && (
        <ul className="stack-sm ai-proposals" data-testid="ai-proposals">
          {state.items.map((item) => {
            const asset = state.assets[item.asset_id];
            return (
              <li key={`${item.scene_number}-${item.asset_id}`} className={`ai-proposal${item.decision === 'rejected' ? ' is-rejected' : ''}`}>
                <div className="ai-proposal-media">
                  {asset?.url && item.role === 'image' && <img src={asset.url} alt="" />}
                  {asset?.url && item.role === 'video' && <video src={`${asset.url}#t=0.1`} muted playsInline preload="metadata" />}
                  {asset?.url && item.role === 'voice' && <audio src={asset.url} controls preload="none" />}
                </div>
                <div className="stack-sm">
                  <span className="small">
                    {fmt(g.item, { n: item.scene_number, role: g.roles[item.role] })}{' '}
                    <span className={`badge ${asset?.mock ? 'badge-warning' : 'badge-info'}`}>{asset?.mock ? g.mock : g.aiGenerated}</span>
                    {item.decision && <span className="badge"> {g.decisions[item.decision]}</span>}
                  </span>
                  {item.role === 'voice' && <span className="xsmall muted">{g.voiceNote}</span>}
                  {state.can_edit && item.decision === null && (
                    <div className="row">
                      {item.role !== 'voice' && (
                        <button type="button" className="btn btn-sm" onClick={() => void decide(item, 'applied')}>
                          {fmt(g.use, { n: item.scene_number })}
                        </button>
                      )}
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => void decide(item, 'rejected')}>
                        {g.reject}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
