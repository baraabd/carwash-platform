import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function opaqueSecret(): string {
  return randomBytes(32).toString('base64url');
}
export function secretDigest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
/** For low-entropy secrets (OTP), use a service-local secret pepper, never a plain hash. */
export function keyedDigest(key: Uint8Array, purpose: string, value: string): string {
  if (key.byteLength < 32) throw new Error('DIGEST_KEY_TOO_SHORT');
  return createHmac('sha256', key)
    .update(`${purpose.length}:${purpose}${value.length}:${value}`)
    .digest('hex');
}
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
