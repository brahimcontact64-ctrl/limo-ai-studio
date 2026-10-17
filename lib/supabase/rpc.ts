import type { SupabaseClient } from '@supabase/supabase-js';

export interface RpcError {
  code?: string;
  message: string;
}

/**
 * Calls a Postgres function that is not (yet) in the generated Database types,
 * e.g. functions added by a migration that has not been applied to production.
 */
export async function callRpc<T>(supabase: SupabaseClient<any, any, any>, fn: string, args: Record<string, unknown> = {}) {
  const rpc = supabase.rpc.bind(supabase) as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: T | null; error: RpcError | null }>;
  return rpc(fn, args);
}

/** True when PostgREST reports that the function does not exist (migration not applied). */
export function isMissingFunction(error: RpcError | null | undefined): boolean {
  return Boolean(error && (error.code === 'PGRST202' || error.code === '42883'));
}

/** Query builder for tables that are not (yet) in the generated Database types. */
export function untyped(supabase: SupabaseClient<any, any, any>) {
  return supabase as unknown as SupabaseClient<any, 'public', any>;
}
