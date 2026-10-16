import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totp } from '../../scripts/lib/totp.ts';

// RFC 6238 Appendix B test vectors (SHA-1 seed "12345678901234567890"), truncated to 6 digits.
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('matches RFC 6238 SHA-1 test vectors', () => {
  assert.equal(totp(SECRET, 59_000), '287082');
  assert.equal(totp(SECRET, 1_111_111_109_000), '081804');
  assert.equal(totp(SECRET, 1_234_567_890_000), '005924');
  assert.equal(totp(SECRET, 2_000_000_000_000), '279037');
});
