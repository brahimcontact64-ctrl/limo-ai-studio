'use client';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { POST_LANGUAGES, type PostDraftProposal, type PostFacts, type PostLanguage, type PostTone } from '@/lib/social/types';
import { REWRITE_MODES, type RewriteMode } from '@/lib/ai/constants';
import { Icon } from '@/components/ui/Icon';
import { useAiFlags, useAiJob } from '@/components/ai/useAiJob';

/**
 * Real AI captions and rewrites for the composer (Facebook Content Studio). Disabled unless the owner turns on
 * `ai_social_text`; the generator worker produces the text (Claude behind every cost gate, or the labelled mock),
 * and the customer reviews the proposal through the same per-field acceptance as the Mock AI drafts.
 */
export function AiCaptionJob({
  prompt, business, facts, language, tone, caption, disabled, onProposal, onRewrite,
}: {
  prompt: string; business: string; facts: PostFacts; language: PostLanguage; tone: PostTone; caption: string; disabled: boolean;
  onProposal: (p: PostDraftProposal) => void; onRewrite: (text: string) => void;
}) {
  const { t } = useI18n();
  const c = t.aiContent;
  const flags = useAiFlags();
  const gen = useAiJob();
  const rw = useAiJob();
  const [mode, setMode] = useState<RewriteMode>('shorter');
  const [target, setTarget] = useState<PostLanguage>(language === 'fr' ? 'ar' : 'fr');
  if (!flags) return null;
  if (!flags.text) {
    return (
      <p className="xsmall muted" data-testid="ai-real-disabled">
        <Icon name="info" /> {c.notEnabled}
      </p>
    );
  }
  const out = gen.job?.status === 'completed' ? (gen.job.output.result as { headline?: string; caption?: string; hashtags?: string[]; cta?: string } | undefined) : undefined;
  const mock = gen.job?.output.mock === true;
  const rewritten = rw.job?.status === 'completed' ? String((rw.job.output.result as { text?: string } | undefined)?.text ?? '') : '';
  const failed = (j: ReturnType<typeof useAiJob>) => (j.job?.status === 'failed' ? j.job.error_code : j.error);
  return (
    <div className="stack-sm" data-testid="ai-real">
      <div className="row">
        <b className="small">{c.title}</b>
        <button type="button" className="btn btn-sm" disabled={disabled || gen.busy || !prompt.trim()} onClick={() => void gen.request('social_caption', { language, prompt, business_type: business, tone, facts })} data-testid="ai-real-generate">
          <Icon name="sparkle" /> {gen.busy ? c.generating : c.generate}
        </button>
      </div>
      {gen.busy && <p className="xsmall muted">{c.queued}</p>}
      {failed(gen) && <p className="callout callout-danger small" role="alert">{fmt(c.failed, { code: String(failed(gen)) })}</p>}
      {out && (
        <div className="proposal" data-testid="ai-real-result">
          <p className="xsmall muted">{mock ? c.mockResult : c.result}</p>
          {out.headline && <p className="small" dir="auto"><b>{out.headline}</b></p>}
          <p className="small pre" dir="auto">{out.caption}</p>
          {!!out.hashtags?.length && <p className="xsmall muted" dir="auto">{out.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}</p>}
          <button type="button" className="btn btn-sm btn-primary" onClick={() => onProposal({ variant: 'standard', headline: out.headline ?? '', caption: out.caption ?? '', hashtags: (out.hashtags ?? []).map((h) => h.replace(/^#/, '')), cta: out.cta ?? '' })}>
            {c.accept}
          </button>
        </div>
      )}
      {caption.trim() && (
        <div className="row">
          <select className="select select-sm" value={mode} onChange={(e) => setMode(e.target.value as RewriteMode)} aria-label={c.rewrite}>
            {REWRITE_MODES.map((m) => <option key={m} value={m}>{c.modes[m]}</option>)}
          </select>
          {mode === 'translate' && (
            <select className="select select-sm" value={target} onChange={(e) => setTarget(e.target.value as PostLanguage)} aria-label={c.targetLanguage}>
              {POST_LANGUAGES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
            </select>
          )}
          <button type="button" className="btn btn-sm" disabled={disabled || rw.busy} onClick={() => void rw.request('social_rewrite', { language, text: caption, mode, target_language: mode === 'translate' ? target : undefined, facts })} data-testid="ai-real-rewrite">
            {rw.busy ? c.generating : c.rewrite}
          </button>
        </div>
      )}
      {failed(rw) && <p className="callout callout-danger small" role="alert">{fmt(c.failed, { code: String(failed(rw)) })}</p>}
      {rewritten && (
        <div className="proposal" data-testid="ai-real-rewritten">
          <p className="xsmall muted">{rw.job?.output.mock === true ? c.mockResult : c.rewriteResult}</p>
          <p className="small pre" dir="auto">{rewritten}</p>
          <button type="button" className="btn btn-sm" onClick={() => onRewrite(rewritten)}>{c.useRewrite}</button>
        </div>
      )}
    </div>
  );
}
