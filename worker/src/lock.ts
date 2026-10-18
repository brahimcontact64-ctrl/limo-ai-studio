/**
 * Worker registry and isolation guards (Milestone 10).
 *
 * Problem seen in Milestones 8/9: on Windows, stopping the shell that started a worker could leave the node
 * process running; that orphan kept claiming jobs meant for the e2e scripts' own `--once` workers.
 * Fix:
 *  - every worker writes `<tmp>/limo-workers/<kind>-<pid>.json` (pid, kind, database host, worker id) and removes
 *    it on exit; files of dead processes are ignored and cleaned up;
 *  - test scripts call `assertNoForeignWorkers` before they start: if another LIVE worker targets the same
 *    database, the script stops and names its PID instead of producing confusing failures;
 *  - test-named workers (WORKER_ID e2e-* / local-*) refuse to start against a non-local database, so a test
 *    worker can never consume production jobs.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const LOCK_DIR = process.env.LIMO_WORKER_LOCK_DIR || join(tmpdir(), 'limo-workers');

export interface WorkerLock {
  pid: number;
  kind: string;
  host: string;
  workerId: string;
  startedAt: string;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return url;
  }
};
export const isLocalUrl = (url: string) => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(url);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Test workers may only ever talk to a local database. */
export function assertSafeTarget(workerId: string, url: string): void {
  if (/^(e2e|local)-/i.test(workerId) && !isLocalUrl(url)) {
    throw new Error(`Test worker "${workerId}" refuses to run against a non-local database`);
  }
}

/** Live workers registered for the database at `url` (stale files of dead processes are removed). */
export function liveWorkers(url: string, exceptPid = process.pid): WorkerLock[] {
  let names: string[] = [];
  try {
    names = readdirSync(LOCK_DIR).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const host = hostOf(url);
  const out: WorkerLock[] = [];
  for (const n of names) {
    const file = join(LOCK_DIR, n);
    let lock: WorkerLock;
    try {
      lock = JSON.parse(readFileSync(file, 'utf8')) as WorkerLock;
    } catch {
      continue;
    }
    if (!alive(lock.pid)) {
      rmSync(file, { force: true });
      continue;
    }
    if (lock.pid !== exceptPid && lock.host === host) out.push(lock);
  }
  return out;
}

/** Called by test scripts before they start their own workers. */
export function assertNoForeignWorkers(url: string, kinds: string[]): void {
  const others = liveWorkers(url).filter((l) => kinds.includes(l.kind));
  if (others.length) {
    const list = others.map((l) => `${l.kind} pid ${l.pid} (${l.workerId}, since ${l.startedAt})`).join('; ');
    throw new Error(`Other LIMO workers are running against this database and would take the test's jobs: ${list}. Stop them first.`);
  }
}

/** Registers this process; returns the unregister function (also run on exit). */
export function registerWorker(kind: string, url: string, workerId: string): () => void {
  assertSafeTarget(workerId, url);
  mkdirSync(LOCK_DIR, { recursive: true });
  const file = join(LOCK_DIR, `${kind}-${process.pid}.json`);
  const lock: WorkerLock = { pid: process.pid, kind, host: hostOf(url), workerId, startedAt: new Date().toISOString() };
  writeFileSync(file, JSON.stringify(lock));
  const remove = () => rmSync(file, { force: true });
  process.once('exit', remove);
  return remove;
}
