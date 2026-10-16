import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPaymentMethod, isValidReceiptPath, mapPaymentError, RECEIPT_TYPES, RECEIPT_MAX_BYTES } from '../../lib/billing/payments.ts';

const ORG = '0f9c2a6e-1b2c-4d3e-8f90-112233445566';
const FILE = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

test('payment methods match the database CHECK constraint', () => {
  for (const m of ['redotpay', 'baridimob', 'ccp']) assert.equal(isPaymentMethod(m), true);
  for (const m of ['paypal', '', null, 'CCP']) assert.equal(isPaymentMethod(m), false);
});

test('receipts must live in the caller workspace folder with an allowed extension', () => {
  assert.equal(isValidReceiptPath(`${ORG}/${FILE}.pdf`, ORG), true);
  assert.equal(isValidReceiptPath(`${ORG}/${FILE}.jpg`, ORG), true);
  assert.equal(isValidReceiptPath(`11111111-1111-4111-8111-111111111111/${FILE}.pdf`, ORG), false);
  assert.equal(isValidReceiptPath(`${ORG}/../other/${FILE}.pdf`, ORG), false);
  assert.equal(isValidReceiptPath(`${ORG}/${FILE}.exe`, ORG), false);
  assert.equal(isValidReceiptPath(`${ORG}/receipt.pdf`, ORG), false);
});

test('receipt limits match the private bucket (5 MB, jpg/png/webp/pdf)', () => {
  assert.equal(RECEIPT_MAX_BYTES, 5 * 1024 * 1024);
  assert.deepEqual(Object.keys(RECEIPT_TYPES).sort(), ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
});

test('database errors map to stable codes', () => {
  assert.equal(mapPaymentError('Payment method unavailable'), 'method_unavailable');
  assert.equal(mapPaymentError('Too many pending payments; wait for review'), 'too_many_pending');
  assert.equal(mapPaymentError('Not authorized'), 'not_authorized');
  assert.equal(mapPaymentError('Transaction reference must be 3 to 200 characters'), 'invalid_reference');
  assert.equal(mapPaymentError('Unknown plan or add-on'), 'invalid_item');
  assert.equal(mapPaymentError('Invalid receipt path'), 'receipt_invalid');
  assert.equal(mapPaymentError('Add-ons require an active billing cycle'), 'needs_active_cycle');
  assert.equal(mapPaymentError('Too many requests; try again later'), 'rate_limited');
  assert.equal(mapPaymentError('boom'), 'unknown');
});
