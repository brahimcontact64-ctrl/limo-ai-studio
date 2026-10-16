/** Shared rules for manual payment submissions (client and server). */
export const PAYMENT_METHODS = ['redotpay', 'baridimob', 'ccp'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export type PaymentErrorCode =
  | 'method_unavailable'
  | 'too_many_pending'
  | 'not_authorized'
  | 'invalid_reference'
  | 'invalid_item'
  | 'receipt_invalid'
  | 'needs_active_cycle'
  | 'unavailable'
  | 'unknown';

export function isPaymentMethod(v: unknown): v is PaymentMethod {
  return typeof v === 'string' && (PAYMENT_METHODS as readonly string[]).includes(v);
}

/** Receipts live at "<organization_id>/<uuid>.<ext>" in the private payment-receipts bucket. */
export function isValidReceiptPath(path: string, organizationId: string): boolean {
  const re = new RegExp(`^${organizationId}/[0-9a-f-]{36}\\.(jpg|png|webp|pdf)$`);
  return re.test(path);
}

export function mapPaymentError(message: string | undefined | null): PaymentErrorCode {
  const m = (message ?? '').toLowerCase();
  if (m.includes('payment method unavailable')) return 'method_unavailable';
  if (m.includes('too many pending')) return 'too_many_pending';
  if (m.includes('not authorized') || m.includes('authentication required')) return 'not_authorized';
  if (m.includes('transaction reference')) return 'invalid_reference';
  if (m.includes('unknown plan') || m.includes('unsupported purchase')) return 'invalid_item';
  if (m.includes('receipt path')) return 'receipt_invalid';
  if (m.includes('active billing cycle')) return 'needs_active_cycle';
  return 'unknown';
}
