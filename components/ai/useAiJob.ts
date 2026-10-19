'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface AiJobState {
  id: string;
  kind: string;
  status: 'queued' | 'processing' | 'waiting_provider' | 'completed' | 'failed' | 'cancelled';
  error_code: string | null;
  output: Record<string, unknown>;
  files: Array<{ id: string; url: string | null; mime: string; mock: boolean }>;
}

const TERMINAL = ['completed', 'failed', 'cancelled'];

/** Feature flags for the Facebook Content Studio AI buttons (all off until the owner enables them). */
export function useAiFlags() {
  const [flags, setFlags] = useState<{ text: boolean; images: boolean; paid: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    void fetch('/api/ai-jobs')
      .then((r) => (r.ok ? r.json() : { text: false, images: false, paid: false }))
      .catch(() => ({ text: false, images: false, paid: false }))
      .then((f) => alive && setFlags(f as { text: boolean; images: boolean; paid: boolean }));
    return () => {
      alive = false;
    };
  }, []);
  return flags;
}

/** Requests one AI job and follows it until it ends (the worker produces it; the customer reviews the result). */
export function useAiJob() {
  const [job, setJob] = useState<AiJobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  const stop = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  const follow = useCallback((id: string) => {
    stop();
    const tick = async () => {
      const res = await fetch(`/api/ai-jobs/${id}`).catch(() => null);
      if (!res?.ok) return;
      const j = (await res.json()) as AiJobState;
      setJob(j);
      if (TERMINAL.includes(j.status)) {
        stop();
        setBusy(false);
      }
    };
    void tick();
    timer.current = window.setInterval(() => void tick(), 2000);
  }, []);

  const request = useCallback(
    async (kind: 'social_caption' | 'social_rewrite' | 'social_image', input: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      setJob(null);
      const res = await fetch('/api/ai-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, input, idempotency_key: crypto.randomUUID().replace(/-/g, ''), confirm_cents: 0 }),
      }).catch(() => null);
      const body = (await res?.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res?.ok || !body.id) {
        setBusy(false);
        setError(body.error ?? 'unavailable');
        return;
      }
      follow(body.id);
    },
    [follow],
  );

  return { job, error, busy, request, reset: () => (stop(), setJob(null), setError(null), setBusy(false)) };
}
