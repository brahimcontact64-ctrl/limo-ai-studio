import { AppShell } from './Shell';
import { getPlans } from '@/lib/data/catalog';
import type { AppContext } from '@/lib/data/context';

/** Server wrapper that maps the workspace context onto the client shell. */
export async function ShellFromContext({ ctx, children }: { ctx: AppContext; children: React.ReactNode }) {
  const plans = ctx.subscription ? await getPlans() : null;
  const usage = ctx.usage;
  return (
    <AppShell
      email={ctx.user.email}
      orgId={ctx.org?.organization_id ?? null}
      orgName={ctx.org?.name ?? null}
      role={ctx.org?.role ?? null}
      memberships={ctx.memberships.map((m) => ({ organization_id: m.organization_id, name: m.name }))}
      isPlatformAdmin={ctx.isPlatformAdmin}
      plan={{
        name: ctx.subscription ? (plans?.find((p) => p.code === ctx.subscription?.plan_code)?.name ?? ctx.subscription.plan_code) : null,
        active: ctx.subscriptionActive,
        slotsUsed: usage ? usage.used_video_slots : null,
        slotsTotal: usage ? usage.base_video_slots + usage.extra_video_slots : null,
      }}
    >
      {children}
    </AppShell>
  );
}
