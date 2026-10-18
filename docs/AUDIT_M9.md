# Milestone 9 — full-system audit and production readiness

Date 2026-10-18 · branch `rebuild/v1` · audited on the local replica (production schema + 10 pending
migrations) with a production build of the app, the render worker and the publisher. Production was only
read (schema, counts). "Works" below means verified end to end by the listed evidence, **not** that it is
live in production: no pending migration is applied and the production web deployment predates this branch.

Legend: ✅ works (local, verified) · 🟡 works with a mock/simulation or a known gap · ⛔ blocked/not built.

## 1. Feature audit (15 areas)
| # | Area | State | Evidence | Mock-only / gaps |
|---|---|---|---|---|
| 1 | Universal Creation, 8 types (`product_ad`, `business_promo`, `social_video`, `social_post`, `story`, `explainer`, `ugc_ad`, `custom`) | ✅ | backend e2e universal creation (16 checks); `create.spec.ts`; journeys (product ad, business promo) | M9 fix: FAQ said wrong limits; Video step allowed 120 s per scene while the database allows 15 s (now `LIMITS`) |
| 2 | Script and dialogue editing | 🟡 | backend e2e script (18); `script.spec.ts`; revisions, conflict, approval lock | script assistant is the deterministic **Mock AI** (facts only, `[placeholders]`); no real LLM |
| 3 | Story Bible, episodes, continuity | 🟡 | backend e2e Story Engine (55); `story.spec.ts`; story journey | continuation/ending suggestions are mock (rule-based from canon); no LLM continuity check |
| 4 | Canonical characters | ⛔ artwork | backend e2e characters (32); SQL `character-spec-approval-test` (6) | **no artwork or references exist**; all specs proposed; generation blocked by design (CHARACTER_ARTWORK_PLAN) |
| 5 | Image Studio, real downloads | 🟡 | backend e2e (33); `images.spec.ts` (PNG/JPG/WebP decoded); journeys | variations are **mock layouts** of the customer's own photo ("Mock layout — not AI artwork"); no image provider |
| 6 | MP4 rendering and downloads | ✅ (assembly) | `e2e-render.ts` (55); render unit 6/6 (480p + 1080p, 4 formats); `video.spec.ts`; journeys export real MP4s | assembles customer media + text cards; **no AI footage, voice or character animation** (labelled). The pricing/charging mismatch (B5) is resolved by the V1 video policy (30 s max, one credit per completed video; VIDEO_POLICY.md) |
| 7 | Facebook composer, approval, scheduling | 🟡 | `e2e-publish.ts` (63); `social.spec.ts`; journeys (publish now, scheduled) | composer is Mock AI; publishing is **simulated Pages only**; live Graph adapter refuses while `facebook_live_publishing` is off; no Meta app review |
| 8 | Automatic publishing policies | 🟡 | `e2e-publish.ts` automation section | off by default (platform flag + owner authorisation per version); posts only approved media; simulated publishing |
| 9 | Subscriptions, entitlements, metering | 🟡 | `payments.spec.ts`; backend e2e payments; ledger checks in render/publish e2e | manual payments (RedotPay, BaridiMob, CCP receipts + admin approval); **no automatic payment provider**; production test subscription lacks a `usage_balances` row (rollout G10) |
| 10 | Admin security, 2FA, audit | ✅ | `security-admin.spec.ts`; backend e2e admin sections (aal2 required) | admin MFA enforced in DB functions; audit events recorded; no alerting on admin actions |
| 11 | RLS and workspace isolation | ✅ | every backend/e2e section has cross-workspace + anonymous refusals; M9 privilege audit on the replica | M9 fixes: default grants removed from 3 new tables + 1 trigger function; older tables' TRUNCATE/REFERENCES/TRIGGER grants → proposed script (G6) |
| 12 | Auth, email confirmation, recovery | ✅ | `email-flows.spec.ts` (confirm from another device, resend, password recovery) via local Mailpit | production email sender/deliverability not verified in M9 |
| 13 | Worker reliability, queue recovery | ✅ local | lease takeover, retries, cancellation, idempotency in render/publish e2e; M9 health endpoints (unit 3/3 + live check) | workers **not deployed**; nothing processes jobs in production (WORKER_HOSTING_PLAN) |
| 14 | Responsive, Arabic RTL, accessibility | ✅ | browser suite desktop + Pixel 7; RTL overflow checks; **new** `a11y.spec.ts` (axe, WCAG 2.1 AA, en + ar, 16 pages): 0 serious/critical | M9 fixes: contrast tokens, tab semantics (`aria-current`, no `aria-selected` on links), radio group in composer; moderate/minor axe findings not gated |
| 15 | Errors, observability, recovery | 🟡 | API errors normalized (401/403/404/409/429/501); `/api/health` | **no error monitoring** (Sentry or similar); `/api/health` is liveness only; no alerting; restore drill not done (G3) |

## 2. Journeys (Phase G) — `tests/e2e/journeys.spec.ts`, 3/3 pass on the production build
| Journey | Steps verified through the UI | Real | Mocked / simulated | Blocked for production |
|---|---|---|---|---|
| Product seller | photo upload → product ad with price → approve script → image from the project → approve → MP4 export (H.264+AAC) → post from the project with price → video attached → approve → publish now | storage, approvals, MP4 file, ledger, scheduling, audit | Mock layout (no AI image), Mock AI caption, simulated Page publication ("Nothing was posted on Facebook") | migrations, workers, Meta app + live flag, image/text providers |
| Story creator | series + Story Bible v1 (Limo boy, Nova grandmother) → episode 1 → approve script → ending (summary/hook/location) → approve episode → Continue story → episode 2 starts from that ending → illustration → MP4 export of episode 1 | canon versions, continuation rules, export | mock ending suggestion, mock illustration with "artwork pending", text-card video ("Characters are not animated") | character artwork, LLM, image/video/voice providers |
| Business owner | brand kit (name, CTA) → business promo brief → post with brief → Mock AI draft uses brand name + CTA → library image → send for review → approve → schedule (3 h) → due → published (simulated) | brand kit, review workflow, scheduling with time zone, publisher | Mock AI, simulated Page | Meta app + live flag, text provider |

Fix made while writing the journeys: none in the product — two test-side waits (navigation, mock suggestion).

## 3. Security and production-readiness report
### Verified controls
- RLS on every public table (replica check: no table without RLS); tables with RLS and no policy are deny-all by design.
- Every SECURITY DEFINER function has a fixed `search_path`; workspace functions check `can_edit_org`/membership.
- Worker and Vault functions: `service_role` only; workers checked as lease holders.
- Admin: platform admin + aal2 (TOTP) checked inside the database, not only in the UI; non-admins get 404.
- Private bucket `workspace-assets`; downloads via 10-minute signed URLs created with the user's session.
- Rate limiting on uploads, assist, payments, images, characters (`hit_rate_limit`, migration #1).
- Headers: HSTS (preload), `frame-ancestors 'none'`, X-Frame-Options DENY, CSP.
- Paid AI: env flag + DB flag + registry + cost policy + references; new `paidCallBlockers` adds capability
  approval, verified price, budget and user confirmation. Facebook: network guard in the publisher, live flag off.
- Secrets: none committed (scan of the diff before commit); service role only in workers and server code.

### Findings
| ID | Severity | Finding | Status |
|---|---|---|---|
| S1 | medium | Default Supabase grants on pending tables (`rate_limit_hits`, `feature_flags`, `brand_kits`) and EXECUTE on a trigger function | **fixed** in the unapplied migration files |
| S2 | low (defence in depth) | TRUNCATE/REFERENCES/TRIGGER for anon (46 tables) / authenticated (49) on older tables; not reachable via PostgREST | proposed `scripts/sql/proposed-grant-cleanup.sql` (dry-run OK), owner decision |
| S3 | medium (ops) | No error monitoring or alerting for the web app and workers | open — choose a service before customers |
| S4 | low | CSP allows `'unsafe-inline'` scripts (Next.js inline runtime) | open — nonce-based CSP is an architectural change; report only |
| S5 | medium (ops) | Recovery never tested (only rollback dry run) | open — restore drill G3 |
| S6 | low | `/api/health` is liveness only (no DB check) | open; workers now have `/healthz` with a DB check |
| S7 | info | Facebook webhooks verify the signature but events are not processed (503 until configured) | by design until Meta integration |
| B5 | product | Pricing text said a video slot covers 30 s; renders charged one slot per approved revision (≤ 10 min) | **resolved 2026-10-18** by the V1 video policy (30 s max, one credit per completed video; VIDEO_POLICY.md); migration #11 pending |

### Accessibility fixes in M9
Contrast of `--text-3`, `--eyebrow`, footer and the ADAM heading; tab links use `aria-current` only; the
composer's media switch is a proper radio group. Axe scan: 0 serious/critical on 16 pages × 2 languages.

## 4. Prioritized blockers before real paying customers
| # | Blocker | Needs | Ref |
|---|---|---|---|
| 1 | Pending migrations not in production | owner approval G1–G7, window | PRODUCTION_ROLLOUT_PLAN |
| 2 | Production app is the old deployment | approval to promote `rebuild/v1` (G8) after #1 | — |
| 3 | No render worker / publisher running | host choice + deployment approval (W1–W8) | WORKER_HOSTING_PLAN |
| 4 | Recovery not proven | restore drill (G3) | PRODUCTION_ROLLOUT_PLAN §4 |
| 5 | No error monitoring/alerting | service choice + setup (S3) | — |
| 6 | ~~Pricing vs slot charging mismatch~~ | resolved by the V1 video policy (apply migration #11 with the others) | VIDEO_POLICY.md |
| 7 | Payment methods in production | owner configures methods and receipts review process; test subscription balance (G10) | — |
| 8 | Email deliverability in production | verify sender domain (SPF/DKIM) and the three email flows on production | — |
| 9 | Legal review for a paid service | terms and privacy pages exist (`/legal/terms`, `/legal/privacy`); no refund policy page; legal review for the selling countries not done | — |

Not blockers for a **first paid offer limited to what works today** (manual payments, script/storyboard editing
with Mock AI, Image Studio layouts from own photos, MP4 assembly of own media, social post drafts): the AI
providers, live Facebook publishing and character artwork. They are blockers for selling "AI-generated video
with LIMO/NOVA/ADAM characters" and "automatic Facebook publishing" — the product copy must not promise
those until they are activated.

## 5. Next milestones (proposal)
1. **M10 — Production rollout:** gates G1–G10, apply migrations, promote the app, deploy workers (W1–W8),
   monitoring, restore drill, production smoke with test accounts.
2. **M11 — Text providers:** implement `CapabilityAdapter` for text/story/translation with one provider,
   price sheet + budgets, staging evaluation, pilot workspaces.
3. **M12 — Character artwork:** pilot character, then families (CHARACTER_ARTWORK_PLAN), review in Admin.
4. **M13 — Image, voice, subtitles providers**, then **M14 — video clips** and **M15 — live Facebook**
   (Meta app review, token vault use, webhooks processing).
