'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './database.types';

let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function getSupabaseBrowser() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Supabase public environment is not configured');
  client = createBrowserClient<Database>(url, key);
  return client;
}
