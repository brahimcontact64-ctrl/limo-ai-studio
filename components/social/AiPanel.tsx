'use client';
import { useId, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { BUSINESS_TYPES, EMPTY_FACTS, type BusinessType, type ComposeResult, type PostDraftProposal, type PostFacts, type PostLanguage, type PostTone } from '@/lib/social/types';
import { Icon } from '@/components/ui/Icon';
import { AiCaptionJob } from './AiCaptionJob';

export type ProposalField = 'headline' | 'caption' | 'hashtags' | 'cta';
const FIELDS: ProposalField[] = ['headline', 'caption', 'hashtags', 'cta'];
const FACT_KEYS: Array<keyof PostFacts> = ['product_name', 'business_name', 'price', 'offer', 'availability', 'location', 'hours', 'link'];

/**
 * "Describe your post" → Mock AI proposals. A proposal is never applied silently: accepting opens a
 * per-field choice in which fields the customer already wrote are NOT ticked by default.
 */
export function AiPanel({
  language,
  tone,
  current,
  initialPrompt,
  initialFacts,
  initialBusiness,
  disabled,
  onAccept,
  onResult,
}: {
  language: PostLanguage;
  tone: PostTone;
  current: Record<ProposalField, string>;
  initialPrompt: string;
  initialFacts: Partial<PostFacts>;
  initialBusiness: BusinessType;
  disabled: boolean;
  onAccept: (p: PostDraftProposal, fields: ProposalField[]) => void;
  onResult: (r: ComposeResult) => void;
}) {
  const { t } = useI18n();
  const a = t.social.ai;
  const id = useId();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [business, setBusiness] = useState<BusinessType>(initialBusiness);
  const [facts, setFacts] = useState<PostFacts>({ ...EMPTY_FACTS, ...initialFacts });
  const [showFacts, setShowFacts] = useState(Object.values(initialFacts).some(Boolean));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ComposeResult | null>(null);
  const [choosing, setChoosing] = useState<{ proposal: PostDraftProposal; fields: Record<ProposalField, boolean> } | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/social/compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, business_type: business, tone, language, facts, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as (ComposeResult & { error?: string }) | null;
    setBusy(false);
    if (!res?.ok || !body?.proposals) return setError(body?.error === 'prompt_required' ? a.promptRequired : body?.error === 'rate_limited' ? t.rateLimited : t.common.errorGeneric);
    setResult(body);
    onResult(body);
  }

  const valueOf = (p: PostDraftProposal, f: ProposalField) => (f === 'hashtags' ? p.hashtags.map((h) => `#${h}`).join(' ') : p[f]);
  const startAccept = (p: PostDraftProposal) =>
    setChoosing({ proposal: p, fields: Object.fromEntries(FIELDS.map((f) => [f, !current[f].trim()])) as Record<ProposalField, boolean> });

  return (
    <section className="panel panel-pad stack" aria-labelledby={`${id}-h`} data-testid="ai-panel">
      <div className="row">
        <h2 id={`${id}-h`} className="section-title">
          <Icon name="sparkle" /> {a.title}
        </h2>
        <span className="badge badge-warning plain">{a.mockBadge}</span>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-prompt`}>
          {a.describe}
        </label>
        <textarea id={`${id}-prompt`} className="textarea" rows={3} maxLength={2000} value={prompt} placeholder={a.example} onChange={(e) => setPrompt(e.target.value)} dir="auto" disabled={disabled} />
      </div>
      <div className="row">
        <label className="field">
          <span className="field-label xsmall">{a.business}</span>
          <select className="select select-sm" value={business} onChange={(e) => setBusiness(e.target.value as BusinessType)} disabled={disabled}>
            {BUSINESS_TYPES.map((b) => (
              <option key={b} value={b}>
                {a.businesses[b]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowFacts((v) => !v)} aria-expanded={showFacts}>
          {showFacts ? a.hideFacts : a.showFacts}
        </button>
      </div>
      {showFacts && (
        <div className="stack-sm" data-testid="facts">
          <p className="xsmall muted">{a.factsHint}</p>
          <div className="form-grid cols-2">
            {FACT_KEYS.map((k) => (
              <label key={k} className="field">
                <span className="field-label xsmall">{a.facts[k]}</span>
                <input className="input input-sm" value={facts[k]} maxLength={200} onChange={(e) => setFacts((f) => ({ ...f, [k]: e.target.value }))} dir="auto" disabled={disabled} />
              </label>
            ))}
          </div>
        </div>
      )}
      {error && (
        <p className="callout callout-danger small" role="alert">
          {error}
        </p>
      )}
      <div>
        <button type="button" className="btn btn-primary" onClick={() => void generate()} disabled={disabled || busy || !prompt.trim()} data-testid="ai-generate">
          <Icon name="sparkle" />
          {busy ? a.generating : result ? a.regenerate : a.generate}
        </button>
      </div>
      <AiCaptionJob
        prompt={prompt}
        business={business}
        facts={facts}
        language={language}
        tone={tone}
        caption={current.caption}
        disabled={disabled}
        onProposal={startAccept}
        onRewrite={(text) => onAccept({ variant: 'standard', headline: '', caption: text, hashtags: [], cta: '' }, ['caption'])}
      />

      {result && (
        <div className="stack-sm" data-testid="ai-result">
          <p className="xsmall muted">{result.label}</p>
          {result.missing_facts.length > 0 && (
            <div className="callout callout-warning small" data-testid="missing-facts">
              <Icon name="alert" />
              <span>{fmt(a.missing, { list: result.missing_facts.map((f) => (a.facts as Record<string, string>)[f] ?? a.testimonial).join(', ') })}</span>
            </div>
          )}
          <ul className="proposal-list">
            {result.proposals.map((p) => (
              <li key={p.variant} className="proposal" data-testid={`proposal-${p.variant}`}>
                <div className="row">
                  <b className="small">{a.variants[p.variant]}</b>
                </div>
                {p.headline && (
                  <p className="small" dir="auto">
                    <b>{p.headline}</b>
                  </p>
                )}
                <p className="small pre" dir="auto">
                  {p.caption}
                </p>
                <p className="xsmall muted" dir="auto">
                  {p.hashtags.map((h) => `#${h}`).join(' ')} · {p.cta}
                </p>
                <div className="row">
                  <button type="button" className="btn btn-sm" onClick={() => startAccept(p)} disabled={disabled}>
                    <Icon name="check" />
                    {a.accept}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setResult((r) => (r ? { ...r, proposals: r.proposals.filter((x) => x !== p) } : r))}
                  >
                    {a.reject}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {choosing && (
        <div className="callout stack-sm" role="dialog" aria-label={a.chooseTitle} data-testid="accept-fields">
          <b className="small">{a.chooseTitle}</b>
          {FIELDS.map((f) => {
            const edited = !!current[f].trim() && current[f].trim() !== valueOf(choosing.proposal, f).trim();
            return (
              <label key={f} className="checkbox">
                <input type="checkbox" checked={choosing.fields[f]} onChange={(e) => setChoosing((c) => (c ? { ...c, fields: { ...c.fields, [f]: e.target.checked } } : c))} />
                <span>
                  {a.fields[f]}
                  {edited && <small className="muted"> · {a.replacesEdited}</small>}
                </span>
              </label>
            );
          })}
          <div className="row">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                onAccept(choosing.proposal, FIELDS.filter((f) => choosing.fields[f]));
                setChoosing(null);
              }}
              data-testid="apply-proposal"
            >
              {a.apply}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChoosing(null)}>
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
