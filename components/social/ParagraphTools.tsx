'use client';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { POST_LANGUAGES, POST_TONES, type PostLanguage, type PostTone } from '@/lib/social/types';
import { Icon } from '@/components/ui/Icon';

type Action = 'rewrite' | 'shorten' | 'expand' | 'tone' | 'translate';

/**
 * Rewrite ONE paragraph of the caption with the Mock AI. The proposal is shown next to the original and
 * replaces it only when the customer accepts it.
 */
export function ParagraphTools({ caption, language, tone, disabled, onReplace }: { caption: string; language: PostLanguage; tone: PostTone; disabled: boolean; onReplace: (index: number, text: string) => void }) {
  const { t } = useI18n();
  const p = t.social.paragraphs;
  const paragraphs = caption.split(/\n{2,}/);
  const [selected, setSelected] = useState(0);
  const [toneChoice, setToneChoice] = useState<PostTone>(tone);
  const [target, setTarget] = useState<PostLanguage>(language === 'en' ? 'fr' : 'en');
  const [proposal, setProposal] = useState<{ index: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!caption.trim()) return null;

  async function run(action: Action) {
    const text = paragraphs[selected] ?? '';
    if (!text.trim()) return;
    setBusy(true);
    const res = await fetch('/api/social/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, text, language, tone: toneChoice, target }) }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { text?: string } | null;
    setBusy(false);
    if (res?.ok && body?.text) setProposal({ index: selected, text: body.text });
  }

  return (
    <div className="paragraph-tools stack-sm" data-testid="paragraph-tools">
      <div className="row">
        <span className="xsmall muted">{p.label}</span>
        {paragraphs.map((x, i) => (
          <button key={i} type="button" className={`chip chip-sm${selected === i ? ' is-active' : ''}`} aria-pressed={selected === i} onClick={() => setSelected(i)} title={x.slice(0, 80)}>
            {i + 1}
          </button>
        ))}
      </div>
      <div className="row">
        {(['rewrite', 'shorten', 'expand'] as const).map((a) => (
          <button key={a} type="button" className="btn btn-sm" disabled={disabled || busy} onClick={() => void run(a)}>
            {p.actions[a]}
          </button>
        ))}
        <select className="select select-sm" value={toneChoice} onChange={(e) => setToneChoice(e.target.value as PostTone)} aria-label={p.toneLabel} disabled={disabled}>
          {POST_TONES.map((x) => (
            <option key={x} value={x}>
              {t.social.tones[x]}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-sm" disabled={disabled || busy} onClick={() => void run('tone')}>
          {p.actions.tone}
        </button>
        <select className="select select-sm" value={target} onChange={(e) => setTarget(e.target.value as PostLanguage)} aria-label={p.targetLabel} disabled={disabled}>
          {POST_LANGUAGES.map((x) => (
            <option key={x} value={x}>
              {t.social.languages[x]}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-sm" disabled={disabled || busy} onClick={() => void run('translate')}>
          {p.actions.translate}
        </button>
      </div>
      {proposal && (
        <div className="callout small stack-sm" data-testid="paragraph-proposal">
          <span className="xsmall muted">{p.mock}</span>
          <div className="diff-pair">
            <p className="muted pre" dir="auto">
              <s>{paragraphs[proposal.index]}</s>
            </p>
            <p className="pre" dir="auto">
              {proposal.text}
            </p>
          </div>
          <div className="row">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                onReplace(proposal.index, proposal.text);
                setProposal(null);
              }}
            >
              <Icon name="check" />
              {p.accept}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setProposal(null)}>
              {p.reject}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
