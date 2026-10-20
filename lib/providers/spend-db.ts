/**
 * The database spend guard (migration 20261018150000) behind the SpendGuard interface. Service role only: used by the
 * generator worker and the pilot runner, never by the web app or the browser.
 */
import { SpendBlockedError, type SpendGuard } from './spend.ts';

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

export function dbSpendGuard(scope: string, rpc: Rpc, log: (...a: unknown[]) => void = () => {}): SpendGuard {
  const call = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await rpc(fn, args);
    if (error) throw new SpendBlockedError(`guard_error:${error.message.slice(0, 80)}`);
    return data as { ok?: boolean; reason?: string } | null;
  };
  return {
    scope,
    async reserve(r) {
      const d = await call('ai_spend_reserve', { p_scope: scope, p_op_key: r.opKey, p_capability: r.capability, p_provider: r.provider, p_model: r.model, p_organization_id: r.organizationId || null, p_cents: r.cents, p_retry_approved: r.retryApproved === true });
      if (!d?.ok) throw new SpendBlockedError(d?.reason ?? 'refused');
      log('spend reserved', scope, r.opKey.slice(0, 16), `${r.cents}¢`);
    },
    async settle(opKey, actualCents, d) {
      await call('ai_spend_settle', { p_scope: scope, p_op_key: opKey, p_actual_cents: actualCents, p_provider_request_id: d?.providerRequestId ?? null, p_needs_reconciliation: d?.needsReconciliation === true, p_note: d?.note ?? null });
      log('spend settled', scope, opKey.slice(0, 16), actualCents === null ? 'at reservation' : `${actualCents}¢`, d?.needsReconciliation ? '(reconcile)' : '');
    },
    async release(opKey, reason) {
      await call('ai_spend_release', { p_scope: scope, p_op_key: opKey, p_reason: reason });
      log('spend released', scope, opKey.slice(0, 16), reason);
    },
  };
}
