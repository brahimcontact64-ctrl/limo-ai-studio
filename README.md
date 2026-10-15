# LIMO AI Studio
# LIMO AI Studio v2 — Safe UI Prototype

A multilingual (Arabic, French, English, German) social content workspace inspired by social media dashboards. Facebook is preview-only; all other platforms are marked Coming Soon. Three selectable presenter concepts, chat-like content brief builder, local draft saving and export.

## Run
Open `index.html` directly, or run `npm install && npm run dev`.

## Security and limitations
This is a frontend prototype, **not a production multi-tenant SaaS**. It does not call any AI model, generate video, authenticate users, connect to Supabase, publish to Facebook, or enforce a real approval workflow. The content briefing chat is template-driven and local only. Drafts are stored in browser localStorage and not shared between devices. Do not use this prototype to store confidential client content. Do not add service_role or provider keys to frontend code.

Before production: Next.js server auth, tenant-scoped RLS, cost reservation/settlement, idempotency, concurrency tests, manual publishing approval, and provider-enforced spending limits.
