import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHealth, healthStatus } from '../src/health.ts';

test('fresh worker is live but not healthy until a database call succeeds', () => {
  const h = createHealth('w1', 'render');
  const s = healthStatus(h.state, 60_000);
  assert.equal(s.live, true);
  assert.equal(s.healthy, false);
  assert.equal(s.body.last_db_ok_s, null);
  h.db(null);
  assert.equal(healthStatus(h.state, 60_000).healthy, true);
});

test('database error keeps the last success time and reports the message', () => {
  const h = createHealth('w1', 'publisher');
  h.db(null);
  h.db({ message: 'connection refused' });
  const s = healthStatus(h.state, 60_000);
  assert.equal(s.healthy, true, 'one failed call inside the window does not flip health');
  assert.equal(s.body.db_error, 'connection refused');
  const later = healthStatus(h.state, 60_000, Date.now() + 61_000);
  assert.equal(later.live, false);
  assert.equal(later.healthy, false);
});

test('counters and busy flag; body carries no secrets', () => {
  const h = createHealth('w1', 'render');
  h.busy(true);
  h.result(true);
  h.result(false);
  h.result(true);
  const s = healthStatus(h.state, 60_000);
  assert.deepEqual([s.body.busy, s.body.done, s.body.failed], [true, 2, 1]);
  assert.deepEqual(Object.keys(s.body).sort(), ['busy', 'db_error', 'done', 'failed', 'kind', 'last_db_ok_s', 'last_tick_s', 'uptime_s', 'worker']);
});
