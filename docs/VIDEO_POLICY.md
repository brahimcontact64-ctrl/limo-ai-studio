# V1 video duration and credit policy

Owner decision, 2026-10-18. Implemented and verified locally; migration `20261018090000_limo_video_policy_v1`
is **pending** like the other production migrations (not applied, nothing deployed).

## Rule
1. Every plan: an exported video lasts **at most 30 seconds** in total.
2. Every successfully completed video consumes **exactly one video credit**, whether it lasts 10, 20 or 30 s.
   Each format (9:16, 16:9, 1:1, 4:5) is its own video.
3. Nothing longer than 30 s can be exported — not through the UI, the API, the database, or the worker.
4. Credit lifecycle: **reserved** when the export starts → **consumed** when the render completes, or
   **released** (refunded) after a definitive failure or a cancellation.
5. Never charged twice: the same click/idempotency key returns the same job; an identical export of the same
   approved revision (same format, resolution, quality and settings) returns the existing video; worker
   retries and lease takeovers keep the single reservation; retrying a failed or cancelled export reserves
   again only because its earlier credit was released. Downloading a finished video never costs anything.
6. Projects longer than 30 s are **never deleted or truncated**: drafts still save; approval and new exports
   are refused until the scenes are shortened. Story episodes follow the same rule per episode; continuity
   across episodes is unchanged.
7. AI generation (future providers) obeys the same 30 s limit but is **budgeted separately in cents**
   (`reserve_ai_budget`, `paidCallBlockers`) and never consumes the export credit. The credit is consumed
   only when the final video is rendered.
8. Aspect ratios and resolutions are unchanged (480/720/1080, four formats). No plan restricts resolution today.

## Where it is enforced
| Layer | Enforcement |
|---|---|
| Database policy | `limo_video_max_duration_ms(org)` = 30 000 (all plans); `limo_video_export_credits(org, ms)` = 1, raises "Videos are limited to 30 seconds" above the limit |
| Approval | trigger `trg_script_approval_duration` on `studio_projects`: approving a script whose scenes add up to more than 30 s is refused (any client) |
| Export | `enqueue_render_job` and `retry_render_job` check the policy; exports of one project are serialized; identical exports are de-duplicated (`render_fingerprint`) |
| Render-job boundary | trigger `trg_render_job_duration` on `render_jobs`: no job over 30 s can be inserted or moved to queued/processing (incl. direct service-role writes), and the stored total must equal the sum of its scenes |
| Credits | `render_jobs.credits` + `charge_state` (none / reserved / consumed / released); `limo_charge_render`, `limo_consume_render_charge`, `limo_settle_render_charge`; ledger reasons `render_reserved` (−1), `render_consumed` (0), `render_refund` (+1) |
| Worker | `renderSpec` and the worker loop refuse specs over 30 s or with an inconsistent total before downloading anything (`over_duration_limit`, not retried) |
| API | `POST /api/renders` → 422 `too_long`, 402 `video_limit_reached`; `POST /api/projects/[id]/approval` → 422 `video_too_long` |
| Studio | "x s of 30 s" in the Video step, export disabled with an explanation above 30 s, approval disabled with the reason, a warning (not an error) in the issue list so saving still works; starter templates fit 30 s (story 30 s, explainer 30 s) |
| Copy | pricing ("videos of up to 30 s", one credit per video), FAQ (limits + "How are video credits counted?"), billing/usage labels "video credits", in English, French, German and Arabic |
| AI generation | `request_studio_generation` refuses more than 30 s and no longer reserves video credits; its refund paths skip jobs that never reserved; provider contract `VideoRequest.videoTotalSeconds` is validated against the same policy |

## Later: longer paid videos (not in V1)
Change `limo_video_max_duration_ms` / `limo_video_export_credits` (for example per plan or per add-on, or
credits = ceil(seconds ÷ 30)) and `VIDEO_POLICY` in `lib/video/policy.ts`. Render jobs already store their own
credit count, so reservation, consumption and refunds stay exact without changing the credit functions.

## Tests
- Unit: `tests/unit/video-policy.test.ts` (boundaries, credits, worker spec check, every starter template and
  story continuation ≤ 30 s), studio validation/mapping, render error mapping, generation estimate, provider contract.
- Database: `scripts/sql/video-policy-test.sql` (20 checks, rolled back): policy functions, approval trigger,
  direct inserts, inconsistent totals, legacy over-limit job, credit state machine and ledger, AI generation
  without credits and without refunds, 31 s generation refused.
- Worker: `worker/test/render.test.ts` renders exactly 30.000 s; 30.001 s refused before any download.
- End to end (RPC + real worker): `scripts/e2e-render.ts` (17 policy checks) — 3 formats = 3 credits, reserved
  then consumed, free downloads, identical re-export, refund on failure, single charge after retry and after a
  lease takeover, cancel releases, real 30 s MP4, 31 s saved but not approvable/exportable, legacy 35 s export
  and over-limit retry refused, no credit left, ledger = balance.
- Browser + HTTP API: `tests/e2e/video-policy.spec.ts` (desktop + phone, English + Arabic).
