# Test report

Actual results only. Newest first.

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
