import { NextResponse } from 'next/server';
import { hasSupabaseEnv } from '@/lib/supabase/env';

export const dynamic = 'force-dynamic';

/** Liveness probe. Deliberately exposes no configuration details beyond readiness. */
export async function GET() {
  return NextResponse.json(
    { ok: true, service: 'limo-ai-studio', version: process.env.npm_package_version ?? '1.0.0', ready: hasSupabaseEnv(), time: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
