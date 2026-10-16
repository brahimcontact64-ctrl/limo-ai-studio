'use client';
import { useId, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import type { Issue } from '@/lib/studio/validation';

export function issueMessage(t: ReturnType<typeof useI18n>['t'], issue: Issue): string {
  const base = fmt(t.studio.issues[issue.code], issue.params ?? {});
  return issue.scene !== undefined ? fmt(t.studio.issueInScene, { n: issue.scene + 1, message: base }) : base;
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  max,
  multiline = false,
  rows = 3,
  hint,
  error,
  optional,
  large,
  dir,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  max: number;
  multiline?: boolean;
  rows?: number;
  hint?: string;
  error?: string;
  optional?: boolean;
  large?: boolean;
  dir?: 'ltr' | 'rtl' | 'auto';
}) {
  const id = useId();
  const { t } = useI18n();
  const near = value.length > max * 0.85;
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        <span>
          {label} {optional && <small>({t.common.optional})</small>}
        </span>
        {near && (
          <small className="mono ltr" aria-live="polite">
            {value.length}/{max}
          </small>
        )}
      </label>
      {multiline ? (
        <textarea
          id={id}
          className="textarea"
          value={value}
          rows={rows}
          maxLength={max}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          dir={dir}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          className={`input${large ? ' input-lg' : ''}`}
          value={value}
          maxLength={max}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          dir={dir}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hint && (
        <span id={`${id}-hint`} className="field-hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-err`} className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}

export function StepHeader({ title, lead, aside }: { title: string; lead?: string; aside?: ReactNode }) {
  return (
    <div className="step-head">
      <div>
        <h2>{title}</h2>
        {lead && <p>{lead}</p>}
      </div>
      {aside}
    </div>
  );
}
