# LIMO render worker

Turns approved projects into real MP4 files. It runs **outside** the web app (Vercel functions are not
used for rendering): a Node process with FFmpeg that takes jobs from the `render_jobs` table.

## How it works
1. A user clicks **Export MP4** in the Studio's Video step. `POST /api/renders` calls
   `enqueue_render_job`, which copies the **approved** script revision (scene order, durations, text,
   media) into the job's `spec` and reserves one video credit (V1 policy: one per completed video, 30 s maximum;
   consumed on completion, released on failure or cancellation — see `docs/VIDEO_POLICY.md`).
2. The worker claims the oldest job (`claim_render_job`, lease + heartbeat). A job whose worker died is
   taken over after the lease, up to `max_attempts` (3).
3. It downloads the inputs, draws text/subtitle/logo overlays with the Image Studio renderer
   (`lib/images/render.ts`), encodes one segment per scene and joins them with transitions and
   background music (`lib/video/plan.ts`), probes the result, uploads
   `workspace-assets/<org>/renders/<job>.mp4` (same path on retry) and calls `complete_render_job`,
   which registers it in the library.
4. Progress is reported every few seconds; the same call tells the worker when the user cancelled.
   Failures are retried with a delay when they are temporary; missing or unreadable inputs fail at
   once, and the slot is refunded when no other render of that revision succeeds.
5. Temporary files are deleted after every job; leftovers older than an hour are swept at start.

Downloads use signed links that expire after 10 minutes, created with the user's own session.

## Limits
- 30 seconds per video on every plan (refused before rendering otherwise), 3 active renders per workspace, input files up to 100 MB.
- Each FFmpeg step stops after `STEP_TIMEOUT_MS` (default 300 000 ms).
- One job at a time per worker process; run more processes for more throughput.

## Running
```
cd worker && npm ci          # downloads static FFmpeg/ffprobe for local runs
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node worker/src/index.ts          # from the app folder
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node worker/src/index.ts --once   # exit when the queue is empty
```
Env: `WORKER_ID`, `RENDER_TMP`, `LEASE_SECONDS` (120), `STEP_TIMEOUT_MS` (300000), `POLL_MS` (3000),
`FFMPEG_PATH` / `FFPROBE_PATH` (default: bundled static binaries).

The service role key is a server secret: keep it in the worker host's secret store only.

`Dockerfile` builds an image with the distribution FFmpeg and Noto fonts (Latin + Arabic). It was not
built or deployed as part of Milestone 7; the worker was verified locally with the bundled FFmpeg 6.0.

## What it does not do
It assembles the customer's own pictures, clips and audio with the approved script's text. It does
not generate footage, animate characters or synthesize voices (those need real providers, later
milestones). Exports say so in their notes.

## Publisher (Milestone 8)
`node worker/src/publisher.ts` is a second long-lived process (same package, same env) that publishes
scheduled social posts and runs controlled automation:
- claims due `publish_jobs` (lease + heartbeat; a dead publisher's job is taken over, and the
  idempotency key prevents a second publication), skips paused workspaces and Pages over their hourly limit;
- publishes through `lib/social/adapter.ts`: the MOCK adapter records the publication in the database
  (simulated Pages); the Meta Graph adapter refuses while `facebook_live_publishing` is off;
- retries temporary errors with back-off, fails permanent ones with a reason, marks expired connections;
- blocks every network request to Facebook domains (logged as `blocked facebook calls`);
- plans automation posts for ACTIVE, authorised policies (`auto_publishing` flag must be on).
Env: `LEASE_SECONDS` (60), `POLL_MS` (2000), `AUTOMATION_EVERY_MS` (60000); `--once` exits when nothing is due.

## Health checks and deployment (Milestone 9)
Both processes serve an optional health endpoint when `HEALTH_PORT` is set (`HEALTH_HOST`, default
`127.0.0.1`; `HEALTH_STALE_MS`, default the lease, at least 60 s):
- `GET /livez` → 200 while the main loop or the current job's heartbeat ticked recently (for restarts);
- `GET /healthz` → 200 when live **and** the last database call succeeded recently (for alerts).
The body holds counters and ages only (`busy`, `done`, `failed`, `last_db_ok_s`, `db_error`).

Prepared, **not built or deployed**: `Dockerfile` (render, with HEALTHCHECK), `Dockerfile.publisher`
(no FFmpeg), `deploy/docker-compose.example.yml`, `deploy/limo-render.service` (systemd). Sizing,
secrets, scaling and alerting are in `docs/WORKER_HOSTING_PLAN.md`.

## AI generator (Milestone 10)
`node worker/src/generator.ts` executes `generation_runs` stage by stage with the provider adapters
(`lib/providers`): safety check, scene prompts, narration, scene images, scene clips (async with polling), and a
proposal the customer applies or rejects in the Video step. The MP4 itself is still the customer's export
(render worker, one video credit). Modes: `off` (default; the process exits), `mock` (no network, labelled
results, used by the local tests), `live` (only with `LIMO_ENABLE_PAID_GENERATION=true`, provider keys and the
owner's activation; every call is authorised, priced from the verified registry and budgeted). Identical
operations reuse earlier results instead of paying twice. Image: `Dockerfile.generator` (prepared, not built).
Details: `docs/AI_GENERATION.md`.

## Worker isolation (Milestone 10)
Every worker registers itself in `<tmp>/limo-workers` while it runs (`src/lock.ts`). The local e2e scripts refuse
to start while another live worker targets the same database (fixes the Windows orphan-worker interference), and
workers named `e2e-*` / `local-*` refuse to run against a non-local database.
