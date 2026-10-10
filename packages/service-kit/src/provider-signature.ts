import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verification of signed provider server notifications (webhooks), P04-E3.
 *
 * This is the platform's normalized HMAC scheme ("washgo-hmac-v1"). It is used
 * by the authorized test provider and by any provider/aggregator whose
 * documented scheme is HMAC-SHA256 over timestamp + id + raw body. A provider
 * with a different documented scheme gets its own verifier in the owner's
 * adapter; it never weakens this one. Sham Cash and Syriatel Cash publish no
 * webhook scheme today (external blocker), so no live provider uses this yet.
 *
 * Rules:
 *  - verify over the EXACT raw bytes, before any JSON parsing;
 *  - bounded body size;
 *  - signed timestamp inside a tolerance window (replay of old captures fails);
 *  - the notification id is inside the signed material, so an attacker cannot
 *    re-label a captured notification to dodge de-duplication;
 *  - constant-time comparison against every configured secret (rotation:
 *    several secrets may be active at once) and every presented signature;
 *  - failure reasons are for logs/metrics only; the HTTP answer reveals nothing
 *    beyond 401.
 * De-duplication itself is the owner's durable store (unique constraint on the
 * replay key), never process memory.
 */
export const PROVIDER_SIGNATURE_HEADER = 'x-provider-signature' as const;
export const PROVIDER_TIMESTAMP_HEADER = 'x-provider-timestamp' as const;
export const PROVIDER_NOTIFICATION_ID_HEADER = 'x-provider-notification-id' as const;
export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;
export const DEFAULT_MAX_NOTIFICATION_BYTES = 16_384;

const NOTIFICATION_ID = /^[A-Za-z0-9_-]{8,128}$/;
const TIMESTAMP = /^[1-9][0-9]{8,10}$/;
const SIGNATURE = /^v1=([0-9a-f]{64})$/;
const MAX_SIGNATURES = 4;
export const MIN_SIGNING_SECRET_BYTES = 32;

export type ProviderSignatureFailure =
  'MALFORMED' | 'TOO_LARGE' | 'STALE' | 'SIGNATURE_INVALID' | 'NOT_CONFIGURED';

export type ProviderSignatureResult =
  | { readonly ok: true; readonly notificationId: string; readonly signedAt: Date }
  | { readonly ok: false; readonly reason: ProviderSignatureFailure };

export interface ProviderSignatureInput {
  readonly rawBody: Buffer;
  readonly signature: string | undefined;
  readonly timestamp: string | undefined;
  readonly notificationId: string | undefined;
  /** Active secrets, newest first. Empty means the provider is not configured. */
  readonly secrets: readonly Buffer[];
  readonly now: Date;
  readonly toleranceSeconds?: number;
  readonly maxBytes?: number;
}

function mac(secret: Buffer, timestamp: string, notificationId: string, body: Buffer): Buffer {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${notificationId}.`, 'utf8')
    .update(body)
    .digest();
}

export function verifyProviderSignature(input: ProviderSignatureInput): ProviderSignatureResult {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_NOTIFICATION_BYTES;
  const tolerance = input.toleranceSeconds ?? DEFAULT_SIGNATURE_TOLERANCE_SECONDS;
  if (
    input.secrets.length === 0 ||
    input.secrets.some((s) => s.length < MIN_SIGNING_SECRET_BYTES)
  ) {
    return { ok: false, reason: 'NOT_CONFIGURED' };
  }
  if (input.rawBody.length > maxBytes) return { ok: false, reason: 'TOO_LARGE' };
  const { timestamp, notificationId, signature } = input;
  if (
    typeof timestamp !== 'string' ||
    !TIMESTAMP.test(timestamp) ||
    typeof notificationId !== 'string' ||
    !NOTIFICATION_ID.test(notificationId) ||
    typeof signature !== 'string' ||
    signature.length > MAX_SIGNATURES * 70
  ) {
    return { ok: false, reason: 'MALFORMED' };
  }
  const presented: Buffer[] = [];
  for (const part of signature.split(',')) {
    const match = SIGNATURE.exec(part.trim());
    if (!match?.[1]) return { ok: false, reason: 'MALFORMED' };
    presented.push(Buffer.from(match[1], 'hex'));
  }
  if (presented.length === 0 || presented.length > MAX_SIGNATURES) {
    return { ok: false, reason: 'MALFORMED' };
  }
  const signedAt = new Date(Number(timestamp) * 1000);
  if (Math.abs(input.now.getTime() - signedAt.getTime()) > tolerance * 1000) {
    return { ok: false, reason: 'STALE' };
  }
  let valid = false;
  // Every secret against every presented signature: no early exit on a match.
  for (const secret of input.secrets) {
    const expected = mac(secret, timestamp, notificationId, input.rawBody);
    for (const candidate of presented) {
      if (timingSafeEqual(expected, candidate)) valid = true;
    }
  }
  return valid
    ? { ok: true, notificationId, signedAt }
    : { ok: false, reason: 'SIGNATURE_INVALID' };
}

/**
 * Signs a notification with the same scheme. Used by the authorized test
 * provider and by tests; production code only verifies.
 */
export function signProviderNotification(input: {
  readonly rawBody: Buffer;
  readonly notificationId: string;
  readonly secret: Buffer;
  readonly at: Date;
}): Record<
  | typeof PROVIDER_SIGNATURE_HEADER
  | typeof PROVIDER_TIMESTAMP_HEADER
  | typeof PROVIDER_NOTIFICATION_ID_HEADER,
  string
> {
  if (!NOTIFICATION_ID.test(input.notificationId)) throw new Error('NOTIFICATION_ID_INVALID');
  if (input.secret.length < MIN_SIGNING_SECRET_BYTES) throw new Error('SIGNING_SECRET_TOO_SHORT');
  const timestamp = String(Math.floor(input.at.getTime() / 1000));
  const signature = mac(input.secret, timestamp, input.notificationId, input.rawBody).toString(
    'hex',
  );
  return {
    [PROVIDER_SIGNATURE_HEADER]: `v1=${signature}`,
    [PROVIDER_TIMESTAMP_HEADER]: timestamp,
    [PROVIDER_NOTIFICATION_ID_HEADER]: input.notificationId,
  };
}

/**
 * Durable de-duplication port. Implementations claim the key with a unique
 * constraint in the owner's own database, in the SAME transaction as the
 * effect; FIRST means "apply", DUPLICATE means "acknowledge without applying".
 */
export interface NotificationReplayGuard {
  claim(provider: string, notificationId: string): Promise<'FIRST' | 'DUPLICATE'>;
}
