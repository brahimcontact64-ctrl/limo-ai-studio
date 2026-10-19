# Worker hosting plan (render worker + publisher)

Status: **prepared, not deployed** (Milestone 9, 2026-10-18). No image was built or pushed, no host was
provisioned, no production secret was used. Config files: `worker/Dockerfile`, `worker/Dockerfile.publisher`,
`worker/deploy/docker-compose.example.yml`, `worker/deploy/limo-render.service`.

## 1. What runs where
| Process | Entry | Needs | Must not run on |
|---|---|---|---|
| Render worker | `node worker/src/index.ts` | FFmpeg/ffprobe (H.264 + AAC), Noto fonts (Latin + Arabic), `@napi-rs/canvas`, temp disk, outbound HTTPS to Supabase | Vercel functions (time limits, no FFmpeg, no persistent temp disk) |
| Publisher | `node worker/src/publisher.ts` | outbound HTTPS to Supabase only (Facebook domains are blocked inside the process until live publishing is approved) | Vercel functions (it is a long-lived poller) |
| AI generator (M10) | `node worker/src/generator.ts` | outbound HTTPS to Supabase and, only when live, to the AI providers; provider keys | Vercel functions (long provider calls and polling) |

Both are stateless: all state (queue, leases, schedule, retries) is in the database, so any host can be
replaced, restarted or scaled without losing work.

## 2. Resources (evidence-based starting point)
Measured on the development machine (8 logical cores), synthetic inputs:
- 480p draft: an 18 s, 5-scene video rendered in **8.7 s** wall time (worker log, journey test).
- 1080p high: 9 s, 3-scene videos (logo, subtitles, Arabic text) in **≈14 s each** (render test, 4 formats in 55 s).
- Output sizes 230–271 KB for 9–10 s of these simple inputs; real photos and clips will be larger and slower.

| | Render worker (per process) | Publisher |
|---|---|---|
| CPU | 2 vCPU (one job at a time; libx264 uses all cores given) | 0.25 vCPU |
| RAM | 2 GB (canvas overlays + FFmpeg; input files up to 100 MB each) | 256 MB |
| Temp disk | 4–10 GB fast local disk (`RENDER_TMP`), cleaned after every job, leftovers > 1 h swept at start | none |
| Network | download inputs + upload one MP4 per job (Supabase Storage) | small RPCs |

Worst case under the V1 policy (30 s per video): a 30 s 1080p video ≈ 45–50 s of rendering on the dev machine
at the measured rate, roughly 1–2 minutes on 2 vCPU (to be re-measured with real customer media before launch:
**gate W3**). The step timeout (`STEP_TIMEOUT_MS`,
300 s per FFmpeg step) bounds a stuck step; long videos are many steps.

## 3. Concurrency and limits
- One job per render process; throughput = number of processes. Database rules already limit **3 active
  renders per workspace**, so one customer cannot fill the queue.
- Start with **1 render worker + 1 publisher**. Add render processes when the queue wait (oldest `queued`
  `render_jobs.created_at`) regularly exceeds the target (proposal: 5 minutes).
- Publisher: one process is enough at launch; several are safe (lease + idempotency key prevent double posts).
- Leases: render 120 s, publisher 60 s; heartbeats every lease/6. A crashed worker's job is taken over after
  the lease, up to 3 attempts.

## 4. Secrets
- Only two: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Store them in the host's secret store or a
  root-owned env file (`/etc/limo/worker.env`, mode 0640); never in the image, git, logs or CI output.
- The service role key never goes to the web app's browser bundle (`NEXT_PUBLIC_*`) — the workers are the
  only place outside Supabase that holds it. Rotate it if a worker host is compromised (rotation also
  requires updating any server env of the web app that uses it).
- Later (live Facebook, AI providers): provider keys live with the process that calls the provider, never in
  the browser; Page tokens stay in Supabase Vault and are read only through the service-role functions.

## 5. Supabase connectivity
- HTTPS (supabase-js REST/RPC + Storage). No direct Postgres connection, no connection pooler needed.
- The worker functions (`claim_*`, `report_*`, `complete_*`, `fail_*`) are executable by `service_role`
  only and check the lease holder, so a worker cannot complete another worker's job.
- Region: place workers in or near the Supabase project's region (Storage transfer dominates render time
  for large inputs).

## 6. Queues
The queue is the database (`render_jobs`, `publish_jobs`) — no extra queue service. Claiming uses row locks
(`for update skip locked`) so processes never take the same job. Scheduled posts wait in `publish_jobs` with
`run_at`; they survive restarts of every component.

## 7. Health checks
`HEALTH_PORT` enables `GET /livez` (loop or job heartbeat ticked within `HEALTH_STALE_MS`) and
`GET /healthz` (live **and** last database call succeeded). Both images set `HEALTH_PORT=8080` and a Docker
`HEALTHCHECK` on `/livez`. Do not expose the port publicly; the body has counters only (no job contents,
no secrets). Verified locally: both processes answer 200 on both paths and 404 elsewhere; unit tests 3/3.

## 8. Logs and alerts
Logs are one line per event on stdout (`<ISO time> <worker id> <event> …`): start/stop, claim errors, render
done/failed (size, duration), publish/simulated publish/failed (normalized code), lease lost, automation,
blocked Facebook calls. Ship stdout to the host's log service; rotate locally (compose example: 5 × 20 MB).

Alerts to configure (proposal):
| Alert | Signal |
|---|---|
| Worker down | `/healthz` not 200 for 2 minutes |
| Queue backing up | oldest queued render job older than 15 min; publish job past `run_at` by 5 min |
| Repeated failures | > 3 `failed` render jobs or `publish failed` in 15 min |
| Facebook guard | any `blocked facebook calls` > 0 (must stay 0 until live publishing is approved) |
| Disk | temp disk > 80 % |
A database-side check (SQL on `render_jobs` / `publish_jobs`) can run from the existing admin dashboard or a
scheduled job; no external monitoring is configured yet (see the security report: no error monitoring).

## 9. Restart behaviour
- `SIGTERM`/`SIGINT` stop claiming new work; the current job finishes (or times out). Grace periods in the
  examples: render 330 s, publisher 40 s. A hard kill is safe: the lease expires and another process takes over.
- Restart policy: always / unless-stopped, 5 s delay.
- Temporary files of a killed job are removed at the next start.

## 10. Scaling
Horizontal only (more processes); no shared state besides the database. Options, cheapest first:
1. one small VM running both containers (start);
2. more render containers on the same or a second VM;
3. a container platform with scale-to-zero for render workers (needs a minimum of one publisher always on,
   because schedules are polled).
Vertical: 4 vCPU per render process shortens long 1080p videos but does not raise throughput per vCPU.

## 11. Cost variables (no prices — fill in at decision time)
| Variable | Driver |
|---|---|
| Compute | vCPU-hours of render processes (≈ render minutes × vCPUs) + one always-on publisher |
| Temp disk | GB provisioned per render host |
| Supabase Storage | GB of MP4s, exports and uploads kept; retention policy |
| Supabase egress | input downloads by workers (if outside Supabase's network) + customer downloads |
| Logs | GB ingested/retained by the log service |
| Monitoring | uptime checks / alerting service |
Per-video compute ≈ (render seconds × vCPUs) — measure with real media (gate W3) and divide by videos per plan
to compare with the video-credit price (one credit per finished video of up to 30 s).

## 12. Deployment gates (all open)
- **W1** owner chooses the host/provider and region.
- **W2** production migrations applied (render/publish tables and functions exist) — see PRODUCTION_ROLLOUT_PLAN.md.
- **W3** render benchmark with real customer-like media at 720p/1080p; adjust CPU/RAM (videos are at most 30 s in V1).
- **W4** images built from a tagged commit, scanned, pushed to a private registry.
- **W5** secrets placed in the host secret store; verify they are absent from images and logs.
- **W6** alerts from §8 connected and tested (stop a worker, see the alert).
- **W7** smoke test: one render and one simulated publication in the production test workspace only.
- **W8** live Facebook publishing stays off (separate approval: FACEBOOK_INFRASTRUCTURE.md).

## 13. AI generator (Milestone 10; since 2026-10-19 also processes `ai_jobs`: Animation Studio shots and Facebook AI content)
Image `worker/Dockerfile.generator` (no FFmpeg), compose service `generator` (example; `LIMO_GENERATION_MODE=off`
by default — the process idles, claims nothing and calls no provider). Resources: 0.5 vCPU, 512 MB (it waits on
providers; files up to 200 MB are streamed to storage). Secrets: provider keys only in this service's env file.
Health `/livez` + `/healthz`. One process is enough for a pilot; video clips are asynchronous (task ids stored in
the database), so a restart never resubmits. Gate: deploy only with the AI activation checklist (AI_GENERATION.md §5).
