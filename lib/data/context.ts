import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSupabaseServer } from '../supabase/server';
import type { Database } from '../supabase/database.types';

export const ACTIVE_ORG_COOKIE = 'limo_org';

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export interface Membership {
  organization_id: string;
  role: Role;
  name: string;
  created_at: string | null;
}
type Tables = Database['public']['Tables'];
export type Subscription = Tables['organization_subscriptions']['Row'];
export type UsageBalance = Tables['usage_balances']['Row'];
export type UserProfile = Tables['user_profiles']['Row'];

export interface AppContext {
  user: { id: string; email: string };
  memberships: Membership[];
  org: Membership | null;
  profile: UserProfile | null;
  subscription: Subscription | null;
  usage: UsageBalance | null;
  subscriptionActive: boolean;
  canEdit: boolean;
  isPlatformAdmin: boolean;
}

export function canEditRole(role: Role | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor';
}

export function isSubscriptionActive(sub: Pick<Subscription, 'status' | 'renews_at'> | null, now = Date.now()): boolean {
  return Boolean(sub && sub.status === 'active' && sub.renews_at && new Date(sub.renews_at).getTime() > now);
}

/**
 * Resolves the signed-in user and their active workspace.
 * The active organization comes from a cookie but is only honoured when the
 * user is a member (membership rows are read through RLS).
 */
export const loadAppContext = cache(async (): Promise<AppContext | null> => {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [membershipsRes, profileRes, adminRes] = await Promise.all([
    supabase
      .from('organization_members')
      .select('organization_id, role, organizations(name, created_at)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true }),
    supabase.from('user_profiles').select('*').eq('user_id', user.id).maybeSingle(),
    supabase.rpc('is_platform_admin'),
  ]);

  const memberships: Membership[] = (membershipsRes.data ?? []).map((m) => {
    const org = m.organizations as unknown as { name: string; created_at: string } | null;
    return { organization_id: m.organization_id, role: m.role as Role, name: org?.name ?? '—', created_at: org?.created_at ?? null };
  });

  const preferred = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  const org = memberships.find((m) => m.organization_id === preferred) ?? memberships[0] ?? null;

  let subscription: Subscription | null = null;
  let usage: UsageBalance | null = null;
  if (org) {
    const [subRes, usageRes] = await Promise.all([
      supabase.from('organization_subscriptions').select('*').eq('organization_id', org.organization_id).maybeSingle(),
      supabase.from('usage_balances').select('*').eq('organization_id', org.organization_id).maybeSingle(),
    ]);
    subscription = subRes.data ?? null;
    usage = usageRes.data ?? null;
  }

  return {
    user: { id: user.id, email: user.email ?? '' },
    memberships,
    org,
    profile: profileRes.data ?? null,
    subscription,
    usage,
    subscriptionActive: isSubscriptionActive(subscription),
    canEdit: canEditRole(org?.role),
    isPlatformAdmin: adminRes.data === true,
  };
});

/** For pages inside the workspace: requires a session and a completed profile. */
export async function requireAppContext(): Promise<AppContext> {
  const ctx = await loadAppContext();
  if (!ctx) redirect('/login');
  if (!ctx.profile) redirect('/app/onboarding');
  return ctx;
}
