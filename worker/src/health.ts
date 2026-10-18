/**
 * Optional health endpoint for the long-lived workers (Milestone 9). Off unless HEALTH_PORT is set.
 *   GET /livez   200 while the main loop (or a running job's heartbeat) has ticked within staleMs, else 503
 *                → for the orchestrator's restart policy (a hung FFmpeg step or a stuck loop gets restarted).
 *   GET /healthz 200 when live AND the last database call succeeded within staleMs, else 503
 *                → for alerts (database unreachable, wrong key, missing RPC after a migration).
 * The JSON body holds counters and ages only: no job contents, URLs or keys. Binds to 127.0.0.1 unless
 * HEALTH_HOST is set (e.g. 0.0.0.0 inside a container whose port is not published publicly).
 */
import { createServer, type Server } from 'node:http';

export interface HealthState {
  worker: string;
  kind: 'render' | 'publisher';
  startedAt: number;
  lastTick: number;
  lastDbOk: number;
  lastDbError: string | null;
  busy: boolean;
  done: number;
  failed: number;
}

export function createHealth(worker: string, kind: HealthState['kind']) {
  const now = Date.now();
  const state: HealthState = { worker, kind, startedAt: now, lastTick: now, lastDbOk: 0, lastDbError: null, busy: false, done: 0, failed: 0 };
  return {
    state,
    tick: () => void (state.lastTick = Date.now()),
    db: (error: { message: string } | null) => {
      state.lastTick = Date.now();
      if (error) state.lastDbError = error.message.slice(0, 200);
      else {
        state.lastDbOk = Date.now();
        state.lastDbError = null;
      }
    },
    busy: (b: boolean) => void (state.busy = b),
    result: (ok: boolean) => void (ok ? state.done++ : state.failed++),
  };
}

/** Pure status computation (unit-tested). */
export function healthStatus(s: HealthState, staleMs: number, at = Date.now()) {
  const live = at - s.lastTick <= staleMs;
  const dbOk = s.lastDbOk > 0 && at - s.lastDbOk <= staleMs;
  return {
    live,
    healthy: live && dbOk,
    body: {
      worker: s.worker,
      kind: s.kind,
      uptime_s: Math.round((at - s.startedAt) / 1000),
      last_tick_s: Math.round((at - s.lastTick) / 1000),
      last_db_ok_s: s.lastDbOk ? Math.round((at - s.lastDbOk) / 1000) : null,
      db_error: s.lastDbError,
      busy: s.busy,
      done: s.done,
      failed: s.failed,
    },
  };
}

export function serveHealth(state: HealthState, staleMs: number): Server | null {
  const port = Number(process.env.HEALTH_PORT || 0);
  if (!port) return null;
  const server = createServer((req, res) => {
    const st = healthStatus(state, staleMs);
    const path = (req.url || '').split('?')[0];
    const ok = path === '/livez' ? st.live : path === '/healthz' ? st.healthy : null;
    if (ok === null || req.method !== 'GET') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ ok, ...st.body }));
  });
  server.listen(port, process.env.HEALTH_HOST || '127.0.0.1');
  return server;
}
