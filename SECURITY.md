# Security model

LIMO is designed for defense in depth. It is not advertised as “unhackable”.

- Supabase RLS and organization-scoped policies isolate tenants.
- Privileged mutations use SECURITY DEFINER RPCs with explicit membership/role checks.
- Secrets remain server-only and are never prefixed with NEXT_PUBLIC_.
- Durable content jobs use idempotency keys and atomic usage reservation.
- Publishing remains approval-first; Facebook OAuth is not enabled until token storage is encrypted and reviewed.
- Payment receipts are evidence only; an admin must verify settlement before approval in the first release.
- Add-ons expire with the subscription cycle by design.
- A real external worker/queue consumer is still required before enabling video providers at scale.
