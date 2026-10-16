import 'server-only';
import type { ServerSupabase } from '../supabase/server';
import { callRpc, isMissingFunction } from '../supabase/rpc';

/**
 * Per-user rate limit backed by public.hit_rate_limit (migration 20261016140000).
 * Returns true when the call is allowed. If the function is not deployed yet the call is allowed
 * (and logged once) so existing environments keep working until the migration is applied.
 */
let warned = false;
export async function allowRequest(supabase: ServerSupabase, action: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await callRpc<boolean>(supabase, 'hit_rate_limit', { p_action: action, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) {
    if (isMissingFunction(error)) {
      if (!warned) console.warn('hit_rate_limit not deployed; rate limiting disabled');
      warned = true;
      return true;
    }
    return false;
  }
  return data === true;
}
