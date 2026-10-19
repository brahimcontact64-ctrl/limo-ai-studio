# Test report

Actual results only. Newest first.

## 2026-10-19 — Flagship #1 pre-production ("The Supernatural Eye"), branch `rebuild/v1`
- Owner scenario saved as a draft storyboard through the real database functions (local replica, workspace A,
  project `b8b9ddd3-…`): 6 shots, 30 s, all `draft`, continuity metadata on every shot, no AI job, nothing approved.
  Validator: no errors; warnings = multi-character shot 1 and Darija native-audio caveat; readiness blockers = no
  approved spec/references/voices for the cast.
- Code: optional continuity + clip sound in the scenario import; `scripts/import-animation-scenario.ts` (local only).
  Unit **186/186**; typecheck app + worker clean; `next build` compiles; browser (desktop) `animation-flow` and
  `animation-studio` specs **2/2** passed after the change. Nothing generated, no provider call, no spending.

## 2026-10-19 — Quality gate before the first flagship video, branch `rebuild/v1`
Environment: local replica (migrations #12–#14 local only; #14 amended), production build on :3200, render worker +
publisher for the browser suite, generator in mock mode. **No paid or live provider call, no real Facebook call.**
- Pushed first (owner-authorised): `362b7c0..e07a326` fast-forward (clean tree, remote unchanged, secret scan clean,
  unit 180/180 + typechecks at `e07a326`, no workflows / 0 deployments; `main` unchanged).
- Unit **185/185** (new: deterministic identity/clip checks, scenario import, music-ducking windows/filter,
  continuity rules). Typecheck app + worker clean; `next build` compiles.
- Worker (real FFmpeg) **12/12** — new: music ducks under a voice line (220 Hz band −30.6 dB → −39 dB, voice −24 dB).
- SQL **98/98**: animation-studio **45/45** (new: identity confirmation, mock clip refused, attempt cap, export
  dedupe without a second credit, failed render releases its credit; a real bug found and fixed — an ambiguous
  table alias in the new export guard), spend guard 23/23 + concurrency PASS, gate 4/4, specs 6/6, video policy
  20/20. Rollback dry run (14 scripts) clean. Restore drill PASS.
- E2E scripts: animation **19/19**, generate 24/24, backend 224/224, render 72/72, publish 63/63.
- Browser (production build, desktop + mobile): full suite **59 passed, 1 skipped** (mobile a11y by design), 39.6 min.
  New `animation-flow.spec.ts` (scenario JSON import → references → keyframe + automated checks + identity
  confirmation → voices with measured timeline → mock clip "Not animated" rejected → simulated provider clip
  (TEST FIXTURE) approved → MP4 export → identical re-export uses no credit → Arabic RTL, no overflow) and
  `facebook-flow.spec.ts` (Brand Kit → AI image → AI caption → mock markers block approval → AI rewrite accepted
  → human edit → approval → calendar → scheduled → simulated publishing → history).
- Fixed from testing: references could only be attached after saving (now every castable approved reference is
  loaded); pre-existing React hydration error #418 on onboarding (region names from different ICU data on server
  and browser — now built client-side; probe: 0 hydration errors on 12 pages).
- Not tested (cannot be without approval): real keyframes/clips/voices, real lip-sync, vision-based identity
  checks (none exist), real Meta publishing, production migrations.

## 2026-10-19 — Animation Studio, Facebook AI integration, production procedures (migration #14), branch `rebuild/v1`
Environment: local replica with migrations #12–#14 applied **locally only**; production build on :3200; render worker
and publisher running for the browser suite. No provider key exists; generator only in mock mode. **No live or paid
provider call, no real Facebook call.**
- Pushed first (owner-authorised): `2ff26d1..362b7c0` fast-forward after clean tree, unchanged remote, secret scan,
  unit 171/171 + typechecks at `362b7c0`, no workflows / 0 deployments; `main` unchanged.
- Unit **180/180** (new `animation-studio.test.ts` 9: storyboard ⇄ scenario, timeline, continuity, audio mix plan,
  first/last frame, segment audio graph, Veo `lastFrame` request + refusals, job builders, social jobs + labelled
  mocks, error codes). Typecheck app + worker clean; `next build` compiles (fixed: a client component imported
  `node:crypto` through `lib/ai/jobs.ts` → client-safe `lib/ai/constants.ts`).
- Worker **11/11** (new: real FFmpeg render of an animation export — clip sound kept −24 dB, muted shot −91 dB, voice
  line at its offset −24 dB).
- SQL: `animation-studio-test.sql` **37/37** (fixed a real bug it found: `animation_character_gaps` appended text to
  an array without `array_append`); spend guard 23/23 + concurrency PASS; generation gate 4/4; character spec 6/6;
  video policy 20/20; rollback dry run of **14** scripts clean.
- E2E (local, mock): animation **15/15** (keyframe from approved fixture references, voices with offsets, mock clip
  "not animated" and not approvable, simulated provider clip fixture approved, export → render worker → real 8 s MP4
  with clip sound + voice layers, one credit; caption/rewrite/image jobs with provenance; isolation; flags/fixtures
  restored); generate 24/24; backend 224/224; render 72/72; publish 63/63.
- Restore drill (`scripts/sql/restore-drill.sh`, local): dump 2.0 MB → scratch DB → 19 table counts identical, 7 key
  functions, RLS on every public table, pilot guard intact → **PASS** (8 s).
- Browser (production build, both viewports): full suite **55 passed, 1 skipped** (mobile a11y by design), 23.3 min;
  includes new `animation-studio.spec.ts` (storyboard write/save/reload, 30 s limit, generation refused while the flag
  is off, Facebook AI hooks off by default, mock caption reviewed and applied) and `/app/animation` in the a11y scan
  (EN + AR, 0 serious/critical).

## 2026-10-18 — Animation preparation (scenario intake, storyboard planning), branch `rebuild/v1`
- Pushed first (owner-authorised): `0418ee8..2ff26d1` fast-forward after re-running unit 165/165 and both typechecks at
  `2ff26d1`; secret scan of the pushed diff clean; no workflows, 0 deployments, Vercel has no Git link; `main` unchanged.
- New `tests/unit/animation-scenario.test.ts` 6/6: 18 canonical ids, validation (30 s, 4/6/8 s shots, unknown
  characters, speakers, expressions, aspect; characters optional), warnings (non-English native dialogue,
  multi-character / multi-speaker shots, words per second), readiness blockers, storyboard ops and planning costs
  (draft $3.616, final $14.156 per take), clip prompt built only from scenario + canon. Placeholder text only.
- No provider call, no generation; research from official pages only (sources in ANIMATION_PIPELINE.md).

## 2026-10-18 — $10 AI pilot preparation (spend guard, kill switch, pilot adapters), branch `rebuild/v1`
Environment: local replica with migrations #12 and **#13 applied locally only**; no provider key exists, generation
mode off; **no live or paid provider call was made** (adapters tested against mocked HTTP only).
- Pushed before this work (owner-authorised): `a781322..0418ee8` fast-forward; `origin/rebuild/v1` =
  `0418ee83d187e186e1057a9d4d371257a0c21f17`; `origin/main` = `2a3f426` unchanged.
- Unit tests **165/165** (new: `spend-guard.test.ts` 16 — guard rules, reserve-before-send, settle/release, billed
  refusals, no paid retry, kill switch, price end date, Gemini TTS and Claude safety request/response contracts,
  provider selectors; `ai-pilot.test.ts` 3). Typecheck app + worker clean; `next build` compiles.
- SQL `ai-spend-guard-test.sql` **23/23** (caps, duplicate keys, retry approval, reconcile, auto-off at the limit,
  kill switch, MFA-only admin switch, customers cannot call or read). `ai-spend-guard-concurrency.sh`: 20 parallel
  sessions × $1 against $10 → **exactly 10 accepted**, reserved 1000 ¢ in 10 entries; same key from 5 sessions → 1.
- Rollback dry run of all **13** pending migrations clean; existing SQL tests 4/4, 6/6, 20/20; worker 10/10;
  `e2e-generate` (mock mode, generator worker) 24/24 after the worker changes.
- Pilot runner `scripts/ai-pilot.ts`: dry runs for all 4 steps print request + planning estimate (script $0.043,
  character front $0.24 at 4K); live mode refuses with nothing sent when the brief, env, keys, scope or confirmation
  are missing, and at preflight with `kill_switch` / `capability_not_approved` / `provider_disabled` / `price_unverified`.
- Not run this round (no relevant code change): backend/render/publish e2e and the 22-minute browser suite (last full
  run on `0418ee8`: 53 passed, 1 skipped).

## 2026-10-18 — Milestone 10 (AI provider integration foundation), branch `rebuild/v1`
Environment: local replica (production schema + 12 pending migrations), production build on :3200, render worker
and publisher on the local stack. **No provider API key exists in this environment (checked by name), generation
mode unset (= off): no live or paid provider call was made.** Real adapters are verified only against mocked HTTP.

Pre-push verification of `a781322` (Part 3, before Milestone 10 code): clean tree; unit 118/118; worker 10/10
(real 30.000 s MP4); SQL 4/4, 6/6, 20/20; 11 rollbacks clean; backend 221/221; render 72/72; publish 63/63; full
browser suite on a fresh production build **51 passed, 1 skipped (mobile a11y by design), 0 failed** (21.9 min).
Pushed fast-forward `1cd8c20..a781322` to `origin/rebuild/v1`; secret scan of the 5,717 published diff lines clean;
no deployment triggered (Vercel latest deployment 2 days old, 0 GitHub deployments, 0 workflows).

| Suite | Command | Result |
|---|---|---|
| Unit | `npm test` | **146/146** (+26 provider adapter/execution tests, +2 proposal tests) |
| Provider contract tests (mocked HTTP) | `tests/unit/provider-adapters.test.ts` | 15/15: network guard; Claude request/JSON schema/refusal/429 retry-after/529/invented numbers/locked terms/story canon; Gemini image request/references/output/safety; Veo submit/poll/download/host and operation-name checks; ElevenLabs timestamps → cues; OpenAI moderation and whisper multipart |
| Execution, registry, planner, artwork | `tests/unit/provider-execution.test.ts` | 11/11: prices unverified ⇒ blocked; cost per op; default-blocked gate; retries only for transient errors (refusal/disabled/auth/quota never retried); modes off/mock/live; planner keys, reuse across formats, 30 s, references; 18 × 3 / 14 sheets |
| Worker | health + render tests | 10/10 |
| Typecheck | app / worker | clean / clean |
| SQL | gate / spec / video policy | 4/4 / 6/6 / 20/20 |
| Migrations | all 12 re-applied in order (`psql -1`); #12 applied twice | clean (after the #4 fix below) |
| Rollback | dry run of 12 scripts; #12 alone | clean |
| Backend / render / publish e2e | `scripts/e2e-*.ts` | **224/224** (+3 admin search), **72/72**, **63/63** |
| Generation e2e (mock providers) | `node scripts/e2e-generate.ts` | **24/24** |
| Browser | `tests/e2e/ai-generation.spec.ts` (desktop + phone + Arabic) | 2/2 |
| Browser, full suite (final build) | `npx playwright test` (desktop + Pixel 7, production build, render worker + publisher) | **53 passed, 1 skipped (mobile a11y by design), 0 failed** (21.6 min). Earlier runs during the milestone: 52/1 failed (upload hydration race, fixed in the product) and 52/1 failed (admin list cap, fixed in the product) |
| Client bundle scan | `.next/static` for provider hosts, auth headers, key names, `@anthropic-ai` | none found |
| Orphan-worker guard | start a worker, stop its shell task, run `e2e-render.ts` | the node process survived (orphan reproduced); the test refused to start and named the PID; after killing it the stale lock was cleaned automatically |

Generation e2e covers: mode off/live-without-flag do nothing; test worker refuses a non-local database; other
workspace cannot request or see; request reserves AI budget and **no video credit**; all stages complete in mock
mode at $0; customer photo kept; generated image stored privately with provenance (mock label, operation key,
prompt hash, scene); mock video honest (still, not animated); narration audio + subtitle cues; proposal not applied
automatically; approved script and video settings untouched; decisions only for files of that run; applied image
renders into a real 10 s MP4 with one credit; retry reuses earlier results (no new files); local settings restored.

Defects found and fixed during Milestone 10: Veo operation-name check allowed `../` (now strict); usage reports
contained unbilled units (strict pricing refused them; now only billed units are metered); the generator crashed
on `.catch` of a Supabase RPC builder; `--once` exited before mock clips were polled; migration #4 narrowed the media
kind list when re-run after #12 (constraint now created only when absent; production first-apply unchanged);
"already generated" was shown as "busy". Character scenes were priced with the cheaper image model while the worker used the character model (planner now prices and records the character model; registry row for Gemini 3 Pro Image added, disabled and unverified). **Product fix:** the Assets library and Image Studio upload inputs now stay disabled until the page is interactive — a file chosen during hydration was silently lost (seen twice in the full suite: the desktop product-seller journey in M9 and the desktop Facebook post spec in the first Milestone 10 run, 52 passed / 1 failed / 1 skipped); tests now wait for the enabled input instead of a per-test workaround. **Product fix:** the admin workspace list was capped at the 500 newest workspaces with no way to find older ones (found when the local test data passed 500 workspaces and the admin test could no longer see its account); `admin_list_workspaces` now has a search (name, owner email, id; wildcards literal) and the page a search box — backend e2e +3 checks (224/224), admin spec updated.

## 2026-10-18 — V1 video duration and credit policy (before Milestone 10), branch `rebuild/v1`
Environment: local replica (production schema + all 11 pending migrations incl. `20261018090000_limo_video_policy_v1`), production build on :3200, render worker and publisher against the local stack. Nothing applied to production.

| Suite | Command | Result |
|---|---|---|
| Unit | `npm test` | **118/118** (new `video-policy.test.ts` 6; studio, video, generation and provider tests updated for the policy) |
| Worker | `node --test worker/test/health.test.ts worker/test/render.test.ts` | **10/10**; a real 30.000 s MP4 (480×854); 30.001 s refused before any download, not retried |
| Typecheck | app / worker | clean / clean |
| SQL | `video-policy-test.sql` / `generation-gate-test.sql` / `character-spec-approval-test.sql` | **20/20** / 4/4 / 6/6 (all rolled back) |
| Migrations | all 11 re-applied in order (`psql -1`); #11 applied twice | clean, idempotent |
| Rollback | `rollback-dry-run.sh` (11 scripts) and #11 alone (restores the 10-minute limit, per-revision slot and production generation functions) | clean |
| Backend e2e | `scripts/e2e-backend.ts` | **221/221** (40 s draft saved as is, 1 credit per video) |
| Render e2e | `scripts/e2e-render.ts` | **72/72** (55 + 17 policy checks) |
| Publish e2e | `scripts/e2e-publish.ts` | **63/63** |
| Browser | `video-policy.spec.ts` (desktop + phone) | 2/2 |
| Browser, full suite | `npx playwright test` (desktop + Pixel 7, production build) | **50 passed, 1 skipped** (a11y is desktop-only), 1 failed: the desktop product-seller journey chose its upload file before the Assets page was hydrated (nothing uploaded). Rerun passed; the journey now waits for the page to settle before uploading → `journeys.spec.ts` 6/6 (desktop + mobile) |

Policy coverage (details in VIDEO_POLICY.md): 30 s boundary at every layer (approval trigger, render-job trigger incl. direct service-role inserts and inconsistent totals, enqueue, retry, worker, API 422, Studio UI), 31 s drafts saved but not approvable or exportable, legacy 35 s approved project and over-limit retry refused without a credit, credit reserved → consumed / released, ledger = balance, downloads and identical re-exports free, worker retry and lease takeover charged once, retry after failure paid once in total, credit limit refuses without creating a job, AI generation within 30 s reserves budget only (no credit, nothing to refund), 31 s generation refused, starter templates and story continuations ≤ 30 s, pricing/FAQ/billing copy in four languages.

Found while testing: the new duplicate protection correctly returned existing videos for two render-e2e exports that were byte-for-byte the same video as earlier ones (the test passed `quality` inside the settings instead of as the export quality); the test now requests genuinely different videos. A browser check counted nested note items as export rows; it now counts top-level rows.

## 2026-10-18 — Milestone 9 (full-system audit, production readiness), branch `rebuild/v1`
Environment: local Supabase replica (production schema dump + all 10 pending migrations, including the M9 privilege blocks) on ports 564xx; app as a production build on :3200; render worker and publisher against the local stack (local service role only). Production was read only (schema dump, counts). No paid AI call, no Facebook request, no payment activation.

| Suite | Command | Result |
|---|---|---|
| Unit | `npm test` | **110/110** (103 + 7 new provider-contract tests) |
| Worker unit | `node --test worker/test/health.test.ts worker/test/render.test.ts` | **9/9** (3 new health tests + 6 render); render also at 1080p high: 6/6, 4 formats × 9 s in ≈55 s (8 logical cores) |
| Typecheck | `npx tsc --noEmit -p .` / `-p worker` | clean / clean |
| Backend e2e | `node scripts/e2e-backend.ts` | **221/221** |
| Render e2e | `node scripts/e2e-render.ts` | **55/55** |
| Publish e2e | `node scripts/e2e-publish.ts` | **63/63** (blocked Facebook calls: 0) |
| SQL | `generation-gate-test.sql` / `character-spec-approval-test.sql` | **4/4** / **6/6** |
| Migrations | re-apply of all 10 files in order (`psql -1`) | clean |
| Rollback | `scripts/sql/rollback-dry-run.sh` | 10 rollbacks clean (rolled back) |
| Proposed grant cleanup | `scripts/sql/proposed-grant-cleanup.sql` in a rolled-back transaction | 0 TRUNCATE/REFERENCES/TRIGGER grants left for anon/authenticated; 61 SELECT grants unchanged |
| Worker health | `HEALTH_PORT` on both workers, `curl /healthz /livez /x` | 200 / 200 / 404 for each; counters only |
| Browser, full suite | `npx playwright test` (desktop + Pixel 7, production build) | **49 passed, 1 skipped** (a11y scan is desktop-only by design), 22.7 min |

New browser coverage:
- `a11y.spec.ts`: axe-core WCAG 2.0/2.1 A + AA on 5 public and 11 workspace pages, English and Arabic → 0 serious/critical violations (before the fixes: colour contrast on tokens/footer/ADAM heading, `aria-selected` on links, `role=tab` with `aria-checked` in the composer).
- `journeys.spec.ts` (desktop + mobile): product seller, story creator, business owner — see AUDIT_M9.md §2 for what is real, mocked or blocked in each.

Issues found during verification:
- **Video step allowed 120 s per scene** while the database limit is 15 s (save failed late); the input now uses `LIMITS`. FAQ limits text corrected in four languages.
- **Replica state, not a product defect:** re-running migration #4 alone restored its older `save_studio_project_v2` (replaced by #6), so one backend check failed ("characters are unavailable"); re-applying #1…#10 in order fixed it. PRODUCTION_ROLLOUT_PLAN §5 now forbids re-running one earlier file alone.
- **Test environment:** worker processes stopped with TaskStop on Windows kept running and took jobs meant for the e2e scripts' own `--once` workers (first runs: render 44/49 and 47/49, publish 62/63). After killing them by command line, both suites passed in full.
- Two test-side races in the new journeys (navigation before reading the URL; typing before the Mock AI suggestion loaded), fixed in the spec.

## 2026-10-18 — Milestone 8 (Facebook composer, approval, scheduling, safe automation), branch `rebuild/v1`
Environment: local Supabase replica (production schema dump + pending migrations through `20261017220000`) on ports 564xx; app as a production build on :3200; render worker and publisher (`worker/src/publisher.ts`, MOCK Facebook adapter) running against the local stack with the local service role only. No Facebook request was made: the publisher's network guard reported `blocked facebook calls: 0` on every run and only simulated Pages exist.

| Suite | Command | Result |
|---|---|---|
| Unit | `npm test` | 103/103 pass (8 new: facts-only composer with blocking placeholders, request instructions not taken as subject, four languages + Arabic, time-zone conversion/DST/weekly slots, automation rules and planning, mock adapter without network + idempotency, Graph error normalization, live adapter refusal, webhook signature/handshake) |
| Rendering (no database) | `node --test worker/test/render.test.ts` | 6/6 pass |
| Publishing end to end (database + real publisher) | `node scripts/e2e-publish.ts` (local only) | **63/63 pass** (stable on repeated runs) |
| Rendering end to end (regression) | `node scripts/e2e-render.ts` (local only) | 55/55 pass |
| Type check / build | `npm run typecheck`, `npx tsc -p worker`, `npm run build` | pass |
| Backend e2e | `node scripts/e2e-backend.ts` | 221/221 pass (Milestone 6 social post checks unchanged on the new functions) |
| Generation gate / spec approval (SQL, rolled back) | `scripts/sql/*.sql` | 4/4, 6/6 |
| Rollback dry run | `scripts/sql/rollback-dry-run.sh` | all 10 rollbacks pass; the Milestone 8 rollback alone restores the Milestone 6 functions; database unchanged afterwards |
| Migration re-apply | `psql -1 < 20261017220000_…` three times | clean |
| Browser, full suite | `npx playwright test` (desktop + Pixel 7) | **42/42 pass (2 new: Facebook composer → simulated publishing on desktop and Pixel 7)** |

Publishing end-to-end coverage: drafts and revisions (created/manual/approval); foreign images refused; `[placeholders]` block approval; review request and rejection with a note; stale saves refused; another workspace cannot approve, read posts or revisions, cancel, pause, retry or see jobs; approved posts locked; scheduling needs a connected Page of the workspace, a future time and a valid IANA time zone; the stored instant matches the wall-clock time in Africa/Algiers; one post credit reserved; scheduling twice refused and the database rejects a second live job (unique index); customers cannot insert jobs, call worker functions or read the test-only failure-injection column; a scheduled post is not published early and survives publisher restarts (published by a new process); the simulated publication is recorded once with the approved text; full audit trail; two concurrent schedule requests → exactly one; cancellation withdraws the job and refunds the credit; rate-limit errors retried with back-off then published, each retry audited; content rejection fails at once with explanation and refund, then the post can be edited again; a publisher that dies after publishing is taken over without a duplicate publication (idempotency key); an expired connection fails with "reconnect required" and blocks new scheduling; emergency pause holds queued posts and refuses scheduling, resume publishes; removing a design's approval or the video's script approval withdraws scheduled posts (refunded) and blocks re-approval; a real (non-simulated) Page cannot be scheduled while live publishing is off and even a forced live job is refused without a Graph call; automation is off by default (platform flag), needs explicit confirmation of the exact version by an owner/admin of the workspace, creates one post from an approved design without invented facts, schedules it at a policy slot, audits the policy version; editing rules creates a new version and de-authorises; revoking withdraws its scheduled post and cannot be re-authorised; customers and the platform admin cannot call the Vault token functions; the admin cannot read workspace posts; signed-out users see nothing.

Browser coverage (desktop + Pixel 7): simulated Page added (real "Connect Facebook" disabled, automation unavailable notice); product brief → "Create post" prefilled with the brief's facts; Mock AI drafts with the missing price shown as a blocking `[Price]`; adding the price and regenerating; accepting a proposal does not tick fields the customer edited ("replaces your text"); paragraph rewrite rejected and tone change accepted; library image; preview labelled simulated; save; review → reject with note → approve (locked); revisions show the accepted AI suggestion and the approval; schedule in Africa/Algiers 2 minutes ahead → time passes → the running publisher publishes to the simulated Page ("Nothing was posted on Facebook", payload `published: false`, `simulated: true`); planner list and calendar; emergency stop disables scheduling, resume and "Publish now"; another workspace gets HTTP 404 and refused actions; Arabic RTL composer with Arabic Mock AI drafts and the Arabic missing-price placeholder, no horizontal overflow.

Fixed during verification:
- Workflow actions refreshed the page and remounted the composer, closing a dialog opened right after (same class of bug as in Milestone 6); state is now applied in place (restore still refreshes).
- On phones a checkbox could scroll under the sticky top bar (`scroll-padding-top` added) and callouts used as small forms laid their content out in two columns (now one column).
- The Mock AI composer took the request's own instructions ("… with the price and customer reviews") as the subject and produced hashtags like #with/#price; the instructions are now cut and filler words skipped (regression test).
- Test timing: the schedule picker works in minutes, so "now + 20 s" is due at once; the test schedules minutes ahead and simulates time passing instead.

## 2026-10-17 — Milestone 7 (video assembly, rendering and MP4 export), branch `rebuild/v1`
Environment: local Supabase replica (production schema dump + pending migrations through `20261017200000`) on ports 564xx; app as a production build (`next build` + `next start` on :3200); render worker `node worker/src/index.ts` with the bundled static FFmpeg 6.0 (libx264, AAC), service role from the local stack only. Real playback checked in Google Chrome (H.264/AAC).

| Suite | Command | Result |
|---|---|---|
| Unit | `npm test` | 95/95 pass (5 new: render sizes, timeline/transition maths keeps approved start times and totals, FFmpeg graphs + finite music loops, settings normalisation and error mapping, overlays incl. text cards and Arabic font choice) |
| Rendering (no database) | `node --test worker/test/render.test.ts` | 6/6 pass: all four formats at 480p draft, again at 1080p high (`RENDER_RESOLUTION=1080 RENDER_QUALITY=high`, 4/4); silent video still has an AAC track; cancellation stops FFmpeg; missing input fails without retry; step timeout is retryable |
| Rendering end to end (database + worker) | `node scripts/e2e-render.ts` (local only) | **55/55 pass** |
| Type check / build | `npm run typecheck`, `npx tsc -p worker`, `npm run build` | pass |
| Backend e2e | `node scripts/e2e-backend.ts` | 221/221 pass (4 new episode export checks) |
| Generation gate / spec approval (SQL, rolled back) | `scripts/sql/*.sql` | 4/4, 6/6 |
| Rollback dry run | `scripts/sql/rollback-dry-run.sh` | all 9 rollbacks pass; database unchanged afterwards |
| Migration re-apply | `psql -1 < 20261017200000_…` three times | clean |
| Browser, full suite | `npx playwright test` (desktop + Pixel 7) | **40/40 pass (2 new: video export on desktop and Pixel 7; account helper now opens the usage cycle like real activation)** |

Real MP4 files produced (sample media generated with FFmpeg: solid-colour pictures, a test clip, sine-tone narration and music — so files are small):

| Run | Format | Pixels | Duration | Size | Streams |
|---|---|---|---|---|---|
| e2e-render (480p draft, 3 scenes 3+3+4 s, music, narration) | 9:16 | 480×854 | 10.000 s | 262.5 KB | H.264 + AAC |
| | 16:9 | 854×480 | 10.000 s | 257.8 KB | H.264 + AAC |
| | 1:1 | 480×480 | 10.000 s | 230.1 KB | H.264 + AAC |
| | 4:5 | 480×600 | 10.000 s | 241.3 KB | H.264 + AAC |
| render test (1080p high, 3 scenes 3+2.5+3.5 s, logo, subtitles, Arabic text) | 9:16 | 1080×1920 | 9.000 s | 271 KB | H.264 + AAC |
| | 16:9 | 1920×1080 | 9.000 s | 269 KB | H.264 + AAC |
| | 1:1 | 1080×1080 | 9.000 s | 253 KB | H.264 + AAC |
| | 4:5 | 1080×1350 | 9.000 s | 262 KB | H.264 + AAC |
| browser (UI export, 480p draft, 5 scenes 2+2+2+1+1 s, music) | 9:16 | 480×854 | 8 s | ≈0.3 MB | H.264 + AAC, plays in Chrome |

Each file was probed (container, codecs, size, duration), decoded completely (`ffmpeg -f null`), and its scene order checked by sampling the colour in the middle of each scene.

Rendering end-to-end coverage: unapproved scripts cannot be exported; another workspace cannot export, read jobs, create links or download files; music from another workspace refused; customers cannot call worker functions; idempotency key returns the same job; at most 3 active renders per workspace; one video slot per approved revision whatever the number of formats; the job copies the approved scene order and durations; all four formats rendered, downloaded by the owner through a signed link and verified; the file is registered in the library (kind render); signed-out users see nothing; a missing input fails once (no retry loop) and frees the slot; after fixing the input, retry renders the same job to the same path; a job left by a dead worker is taken over after the lease (attempt 2) and completes; a new approved revision uses a new slot, cancelling its only queued job refunds it; the new revision exports its own timeline; cancelling during rendering stops the worker; the other job of that revision keeps the slot.

Browser coverage (desktop + mobile): upload real sample media; product ad; in the Video step reorder scenes and change durations while the script is a draft; save; approve; timeline locked to the approved revision; choose a clip/pictures per scene and background music; storyboard preview; export → waiting/rendering with progress → ready; download decoded (480×854, 8 s, H.264+AAC, scene order green/red/blue as reordered); in-app preview; real playback in Google Chrome; another workspace gets HTTP 404 for the project, the job and the download link and cannot retry; Arabic RTL Video step without horizontal overflow.

Fixed during verification:
- **Final assembly never finished when background music was looped endlessly** (`-stream_loop -1` kept the mixer open; the step hit its time limit and the job was retried as designed). Music is now probed and looped a finite number of times; regression unit test added.
- **Arabic overlay text rendered as empty boxes**: the canvas engine does not fall back per glyph, so right-to-left text now uses an installed font with Arabic (Tahoma on Windows, Noto Sans Arabic in the worker image).
- **Exports with text-card scenes or characters failed** (`v_notes || 'text'` parsed as an array literal); fixed with `array_append`, covered by the episode export check.
- The browser test helper activated subscriptions without opening a usage cycle (real activation does); the helper now creates the plan's usage balance.

## 2026-10-17 — Milestone 6 (Image Studio and social posts), branch `rebuild/v1`
Environment: local Supabase replica (production schema dump + pending migrations through `20261017180000`) on ports 564xx; app as a production build (`next build` + `next start` on :3200). Only the `limo-local-e2e` stack was used.

| Suite | Command | Result |
|---|---|---|
| Unit | `npm test` | 90/90 pass (9 new: PNG/JPEG/WebP header decoding, document normalisation, single-layer editing + lock + undo/redo, crop geometry, mock layouts use only the customer's text and photos, story illustration placeholders, renderer order/RTL/wrapping, social post rules and unpublished payload, readable price/button text in every style) |
| Type check / build | `npm run typecheck`, `npm run build` | pass |
| Backend e2e | `node scripts/e2e-backend.ts` | 217/217 pass (33 new Image Studio / social post checks) |
| Generation gate / spec approval (SQL, rolled back) | `scripts/sql/*.sql` | 4/4, 6/6 |
| Rollback dry run | `scripts/sql/rollback-dry-run.sh` | all 8 rollbacks pass; database unchanged afterwards |
| Migration re-apply | `psql -1 < 20261017180000_…` twice | clean |
| Browser, full suite | `npx playwright test` (desktop + Pixel 7) | **38/38 pass (4 new: product ad flow and story illustration, each on desktop and Pixel 7; story isolation now asserts HTTP 404)** |

Backend coverage: design size must match the aspect; images from another workspace refused (design and post); another workspace cannot create, read, read revisions, approve, see or download exports, register exports, read or approve posts; stale saves refused (conflict); revisions, autosave coalescing, restore as a new revision; `[placeholder]` text blocks approval; approved designs are locked; exports only under `<org>/exports/`, only at the design size (1× or 2×), registered as library "design" files and marked "from approved"; posts need a caption and an image, an attached design must be approved; approved posts are locked; removing a design's approval returns its posts to draft; anonymous users read nothing.

Browser coverage (desktop + mobile): product ad from an uploaded photo with typed name, price and call to action → four mock layouts labelled "Mock layout — not AI artwork" → editor shows exactly the typed text and the photo (no offer was typed, none shown, no placeholder); edit only the headline; drag the price tag on the canvas, undo, redo; resize from a corner; add a price tag (starts as a `[placeholder]`, warning until replaced); save; restore revision 1 from the history (as revision 3); preview and approve (editing locked); real PNG, JPG and WebP downloads decoded from the file bytes (format and 1080×1080), all three saved to the library; social post with caption and hashtags, attach the approved design, preview card, approve ("ready to publish — Facebook is not connected"), payload `published: false`; removing the design approval puts the post back to draft; another workspace gets **HTTP 404** for the design and the post and is refused by the APIs; Arabic RTL editor and composer with Arabic text on the canvas, no horizontal overflow. Story illustration from a series: character identity and "artwork pending" kept with the design; approval disabled while the artwork placeholder is present.

Fixed during verification:
- **Unauthorized detail pages answered HTTP 200** (streaming with `loading.tsx` sends the status before `notFound()`). The middleware now checks the record with the user's own access for `/app/stories|projects|images|posts/<id>` and rewrites to the not-found page with **status 404**; the story and image tests assert the status.
- Approve/unapprove refreshed the page and remounted the editor, closing a dialog opened right after (seen only on the production build). State is now updated in place.
- The revision history only listed revisions present when the page loaded; it now loads the current list when opened.
- The "modern" mock layout drew the price as white text on a white tag; text colours on filled tags are now chosen for contrast (unit test over all styles and brand colours).

## 2026-10-17 — Milestone 5 (Story Engine), branch `rebuild/v1`
Environment: local Supabase replica (production schema dump + pending migrations through `20261017160000`) on ports 564xx; app as a production build (`next build` + `next start` on :3200). Docker Desktop was started by the owner; only the `limo-local-e2e` stack was used.

| Suite | Command | Result |
|---|---|---|
| Unit | `npm test` | 81/81 pass (7 new: bible validation/diff, three consecutive episodes from approved endings, identity/relationship/thread continuity, checkpoint validation, affected-episode detection, non-series projects untouched, undo step for discrete actions; plus guide-drift check) |
| Type check / build | `npm run typecheck`, `npm run build` | pass |
| Backend e2e | `node scripts/e2e-backend.ts` | 184/184 pass (55 new Story Engine checks) |
| Generation gate / spec approval (SQL, rolled back) | `scripts/sql/*.sql` | 4/4, 6/6 |
| Rollback dry run | `scripts/sql/rollback-dry-run.sh` | all 7 rollbacks pass; database unchanged afterwards |
| Migration re-apply | `psql -1 < 20261017160000_…` twice | clean |
| Browser, full suite | `npx playwright test` (desktop + Pixel 7) | **34/34 pass** |

Backend Story Engine coverage: anonymous and other-workspace refusal (create, read series/bible/timeline, add episodes, approve, resolve); no direct writes on series; unknown characters refused; bible conflict (stale version) and versioning; episode 1 from the bible; no second "episode 1"; no continuation before approval; ending required; ending conflict; script approval required; endings with non-canon characters or events outside the episode's scenes refused; approval writes the timeline and turns new threads into canon; continuation with a wrong fingerprint refused; episode 2 opens with episode 1's ending hook, location, present characters and carried states, casts only characters present at the ending, gets a scene per open thread, records its base ending; resolved threads leave later drafts; three consecutive episodes; characters used by approved episodes cannot be removed; removing episode 1's script approval reopens it, removes its timeline events and flags episodes 2 and 3 (episode 2 direct) without rewriting them; continuation blocked while an episode needs review; changing episode 1's ending lists exactly the changed characters and marks episode 3 downstream; reviews in order with a note, kept in history; concurrent continuations (second refused); restore of an earlier bible version.

Browser coverage (desktop + mobile): create a series with characters, first location and thread; three episodes through the UI (studio script approval, Mock AI ending suggestion, approve episode, Continue story), each starting point and first scene equal to the previous approved ending; timeline with three approved episodes and the open thread; reopening episode 1 flags episodes 2 and 3 ("directly affects"), blocks Continue story; another workspace gets the not-found page and no data; Arabic RTL story pages without horizontal overflow.

Fixed during verification:
- **Production-only stale page:** returning from the studio to the episode page showed the script as "Not approved" (Next.js link prefetch kept the old page). Story/studio cross-links no longer prefetch. Reproduced and fixed against the production build.
- **Undo merged a Mock AI apply with the typing before it** when applied within 800 ms (visible only on the faster production build): discrete actions now always get their own undo step (regression unit test added).
- Another workspace opening a story URL gets the 404 page with HTTP 200 because of streaming (`loading.tsx`); the content is the not-found page with no data. The test asserts the content.
- Local replica moved from ports 554xx to 564xx: after a restart Windows reserved TCP 55375–55474.

Interrupted earlier run: a previous full-suite run was still active when the session resumed and overlapped with a new run; its results (shared database and results folder) were discarded and the suite was re-run cleanly.

## 2026-10-17 — Milestone 4 (canonical character system), branch `rebuild/v1`
Environment: local Supabase replica (production schema dump + pending migrations through `20261017140000`), app as a production build (`next build` + `next start` on :3200).

| Suite | Command | Result |
|---|---|---|
| Unit | `npm test` | 74/74 pass (8 new: canon structure and shared family identity, palette/proportions/expressions/outfits/views, migration seed equals the canon, slot readiness, image vs model file types, workspace character parsing/spec/cast ids, prompts use the identity text) |
| Type check / build | `npm run typecheck`, `npm run build` | pass |
| Backend e2e | `node scripts/e2e-backend.ts` | 129/129 pass (32 new) |
| Spec approval (SQL, rolled back) | `scripts/sql/character-spec-approval-test.sql` | 6/6: aal1 admin refused; only the latest version; approved spec alone not ready; approved spec + 3 approved views = ready and `visual_ref` set; new spec version resets readiness |
| Generation gate (SQL) | `scripts/sql/generation-gate-test.sql` | 4/4 |
| Rollback dry run | `scripts/sql/rollback-dry-run.sh` | all 6 rollbacks pass; database unchanged afterwards |
| Browser, full suite | `npx playwright test` (desktop + Pixel 7) | **32/32 pass** |

New browser coverage (desktop + mobile): admin opens a canonical character (spec v1 proposed, readiness "not ready", four "Artwork pending" slots, no rigged model), uploads a test fixture, approval stays disabled until the file is opened and all six checklist items are confirmed, approves, still "not ready" (one view, spec unapproved), then withdraws the fixture; customers see 0/18 approved, the written spec with palette, pending slots and no upload control; create a workspace character, upload and approve its reference as owner, cast it next to Limo · Boy, save and reload; Arabic RTL character library and details without horizontal overflow.

Backend coverage added: 18 specs readable, none approved, no character approved; workspace character isolation (read, create, direct status write refused); storage folder isolation (upload/read); an image cannot be registered as a rigged model; review refused for another workspace, without viewing, with an incomplete checklist; front-only approval keeps the character not ready; workspace characters castable only in their own workspace; archive. Canonical: customers cannot upload, register, see or download pending files, or review; admin with two-factor uploads, registers, approves after viewing; customers then see and download it; still not ready; fixture withdrawn and hidden again.

State after all runs: 0 approved specs, 0 approved characters, every canonical fixture withdrawn.

Fixed during verification: upload form selects were wrapped in their labels, which gave them unclear accessible names; they now use explicit `htmlFor` labels.

## 2026-10-17 — Milestone 3 (script, dialogue and scene editing), branch `rebuild/v1`
Environment: local Supabase replica (production schema dump + pending migrations through `20261017120000`), app as a **production build** (`next build` + `next start` on :3200) unless noted.

| Suite | Command | Result |
|---|---|---|
| Unit | `npm test` | 66/66 pass (9 new: undo history, word diff, revision comparison, snapshot restore, Mock AI for all 8 modes, no invented facts, transforms, continuity) |
| Type check | `npm run typecheck` | pass |
| Production build | `npm run build` | pass |
| Backend e2e | `node scripts/e2e-backend.ts` | 97/97 pass (18 new script checks) |
| Generation gate (SQL) | `scripts/sql/generation-gate-test.sql` (rolled back) | 4/4: unapproved run refused; approved run records its revision; direct scene write refused while approved; status changes still allowed |
| Rollback dry run | `scripts/sql/rollback-dry-run.sh` (rolled back) | all 5 rollbacks run newest-first; pending objects removed, previous payment policy and v1 save present; database unchanged afterwards. The first dry run found an ordering bug (policy dropped after the function it uses); fixed |
| Browser, full suite | `npx playwright test` (desktop + Pixel 7) | **26/26 pass** |

New browser coverage (desktop + mobile): Mock AI whole-script draft reviewed in a dialog then applied; per-scene shorten with "Replaces your text" marking; undo/redo; autosave; history list, comparison and restore of revision 1; approval lock (fields and Mock AI disabled, survives reload); explicit removal of approval; Arabic RTL editor with Mock AI dialog and no horizontal overflow; two tabs editing the same project (second save refused with a reload option, no silent overwrite); another workspace gets an empty history and 404 for snapshot, restore and approval.

Backend coverage added: v3 create (character-free) → revision 1; stale save refused (conflict); revisions 2–3; consecutive autosaves coalesced; snapshots hold saved text; revisions invisible to another workspace; restore/approve refused for another workspace; approval → approval revision; approved script refused through v2, through v3 without removing approval, and content unchanged; approval removal → "changed"; restore of revision 2 as revision 5; approved project deletable.

Fixed during verification:
- On phones, the fifth step tab widened the whole studio (grid `min-width:auto`): the tab strip now scrolls inside itself.
- The History button had no accessible name on phones (label hidden): added.
- After a restore the editor jumped back to the Scenes step: the open step is kept per tab.
- Guard trigger referenced a column of the other table (PL/pgSQL resolves both branches): split into two trigger functions.

### Investigation: Milestone 2 browser timeout
The desktop product-ad test timed out once (90 s) in the full Milestone 2 run. Measured per step (`test.step`, JSON reporter), same test, same database:

| Run | Total | Sign up | Upload | Create | Reload | Edit + save | List |
|---|---|---|---|---|---|---|---|
| `next dev`, cold (fresh `.next`) | 99.6 s | 23.3 | 11.1 | 24.6 | 6.5 | 5.6 | 7.2 |
| `next dev`, warm | 47.3 s | 14.7 | 5.3 | 7.1 | 6.6 | 4.6 | 3.1 |
| production build, 1st run | 21.1 s | 4.4 | 3.2 | 4.4 | 3.5 | 2.5 | 0.8 |
| production build, 2nd run | 18.7 s | 4.1 | 2.6 | 4.8 | 2.7 | 1.5 | 0.9 |

The dev server log shows each route compiled on first request (1–10 s each, e.g. `/` 9.6 s, `/app/projects/[id]` 3.6 s) and recompiled after file changes. The production build has no cold penalty and every step stays under 5 s. Conclusion: the timeout came from on-demand compilation in `next dev`, not from a functional or performance regression. The full suite now runs against a production build; the 150 s budget on that test only covers cold dev runs.

## 2026-10-16 — Milestone 2 (universal creation), branch `rebuild/v1`
Environment: local Supabase replica (production schema dump + pending migrations through `20261017100000`, Storage, Mailpit, TOTP on), `next dev` on :3200.

| Suite | Command | Result |
|---|---|---|
| Unit | `npm test` | 57/57 pass |
| Type check | `npm run typecheck` | pass |
| Production build | `npm run build` | pass |
| Backend e2e | `node scripts/e2e-backend.ts` (local, with admin + TOTP secret) | 79/79 pass |
| Browser, full suite | `npx playwright test` (desktop + Pixel 7) | 22/22 pass (21 in the full run; the desktop product-ad test timed out on a cold dev compile, then passed on rerun with a 150 s budget) |

New coverage:
- Backend (16 checks): workspace-assets Storage isolation (upload, read, foreign folder); registration refused for another workspace's file; asset invisible to other workspaces; character-free product ad saved with mode, brief, narration and scene assets; story mode still requires characters; foreign asset refused in a scene; deleting an asset used by a scene refused; brand kit refuses a foreign logo; unused asset deleted.
- Browser: product ad without characters, with an uploaded product photo. Covers upload → Create content → brief and selling points → media picker → create → reload (mode, brief, scenes, media) → edit and save → listed with its type.

Fixed during verification: on phones, wide admin tables widened the whole page and blocked taps. Grid stack children now get `min-width: 0`, and the workspace "Manage plan" action moved to the first column.

## 2026-10-16 — Milestone 1 (security and onboarding), branch `rebuild/v1`
Environment: local Supabase replica (production schema dump + pending migrations, email confirmation on, TOTP on, Mailpit), `next dev` on :3200.

| Suite | Command | Result |
|---|---|---|
| Unit | `npm test` | 48/48 pass |
| Type check | `npm run typecheck` | pass |
| Backend e2e | `node scripts/e2e-backend.ts` (local, with admin + TOTP secret) | 63/63 pass |
| Browser: security & admin | `npx playwright test security-admin --project=desktop` | 3/3 pass |
| Browser: payments | `npx playwright test payments --project=desktop` | 1/1 pass |

Backend coverage: save/reload/edit, DB limits, tenant isolation, anonymous access, lifecycle, payments (server pricing, blocked direct insert, receipt isolation, admin-only review, single review, audit), admin two-factor (wrong code rejected, aal1 refused, aal2 accepted), workspace administration (reason required, customers refused, audited), feature flags, provider registry privacy, rate limiting (3 allowed, 4th refused).

## 2026-10-16 — Email flows and activation (commit `c4bbca3`)
Browser e2e 14/14 (desktop + mobile): email confirmation across devices in French, resend with cooldown, password recovery (old password refused, link not replayable), payments approve/reject, studio journey, signed-in smoke. Backend e2e 47/47. Production-database smoke (desktop + mobile) 2/2 against the production build.

## 2026-10-16 — Design restore (commit `50622d9`)
Unit 43/43, browser 4/4 + smoke 2/2, backend 26/26 (local) and 26/26 (production).

## How to run locally
1. Start the local replica (see `ARCHITECTURE.md`), export `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
2. `E2E_* … E2E_ADMIN_TOTP_FILE=<file> node scripts/e2e-local-setup.ts`
3. `E2E_ADMIN_TOTP_SECRET=$(cat <file>) node scripts/e2e-backend.ts`
4. Run the app with the replica's public env on :3200, then `E2E_BASE_URL=http://localhost:3200 E2E_MAILPIT_URL=http://127.0.0.1:58024 … npx playwright test`.
