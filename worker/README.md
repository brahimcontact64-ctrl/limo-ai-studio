# LIMO render worker

Turns approved projects into real MP4 files. It runs **outside** the web app (Vercel functions are not
used for rendering): a Node process with FFmpeg that takes jobs from the `render_jobs` table.

## How it works
1. A user clicks **Export MP4** in the Studio's Video step. `POST /api/renders` calls
   `enqueue_render_job`, which copies the **approved** script revision (scene order, durations, text,
   media) into the job's `spec` and reserves one video slot per approved revision.
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
- 10 minutes per video (scenes per project are limited by the Studio), 3 active renders per workspace, input files up to 100 MB.
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
