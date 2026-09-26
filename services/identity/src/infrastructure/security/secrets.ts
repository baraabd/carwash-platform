import { randomInt, randomUUID } from 'node:crypto';
import { keyedDigest, opaqueSecret, safeEqual, secretDigest } from '@carwash/security-kit';
import type { Secrets } from '../../ports/identity.ports';

export class IdentitySecrets implements Secrets {
  private readonly pepper: Buffer;
  constructor(pepper: Uint8Array) {
    if (pepper.byteLength < 32) throw new Error('OTP_PEPPER_TOO_SHORT');
    this.pepper = Buffer.from(pepper);
  }
  id(): string {
    return randomUUID();
  }
  opaque(): string {
    return opaqueSecret();
  }
  otp(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }
  digest(value: string): string {
    return secretDigest(value);
  }
  otpDigest(challengeId: string, generation: number, code: string): string {
    return keyedDigest(this.pepper, 'otp-v1', `${challengeId}:${generation}:${code}`);
  }
  equal(left: string, right: string): boolean {
    return safeEqual(left, right);
  }
}
