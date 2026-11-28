import type { ChallengeReceipt } from '@carwash/contracts';
import { call, sessionChanged, sessionRequests, type Result } from './client';
import { ShapeError, parseSession } from './parse';
import type { SessionView } from './types';

export function parseChallenge(value: unknown): ChallengeReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ShapeError('challenge');
  const receipt = value as Record<string, unknown>;
  if (
    Object.keys(receipt).length !== 3 ||
    typeof receipt.challengeId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      receipt.challengeId,
    ) ||
    !Number.isSafeInteger(receipt.expiresIn) ||
    (receipt.expiresIn as number) < 1 ||
    (receipt.expiresIn as number) > 86_400 ||
    !Number.isSafeInteger(receipt.resendAfter) ||
    (receipt.resendAfter as number) < 0 ||
    (receipt.resendAfter as number) > 86_400
  )
    throw new ShapeError('challenge');
  return {
    challengeId: receipt.challengeId,
    expiresIn: receipt.expiresIn as number,
    resendAfter: receipt.resendAfter as number,
  };
}

export async function startLogin(
  email: string,
  password: string,
): Promise<Result<ChallengeReceipt>> {
  const epoch = sessionRequests.capture();
  const csrf = await call({ method: 'GET', path: '/api/operator/auth/csrf', parse: null });
  if (!sessionRequests.current(epoch)) return sessionChanged();
  if (csrf.kind !== 'ok') return csrf;
  return call({
    method: 'POST',
    path: '/api/operator/auth/login',
    body: { email, password },
    parse: parseChallenge,
  });
}
export const resendCode = (challengeId: string): Promise<Result<ChallengeReceipt>> =>
  call({
    method: 'POST',
    path: '/api/operator/auth/challenges/resend',
    body: { challengeId },
    parse: parseChallenge,
  });
export const verifyCode = (challengeId: string, code: string): Promise<Result<SessionView>> =>
  call({
    method: 'POST',
    path: '/api/operator/auth/challenges/verify',
    body: { challengeId, code },
    parse: parseSession,
  });
export const signOut = (): Promise<Result<unknown>> =>
  call({ method: 'POST', path: '/api/operator/auth/logout', body: {}, parse: null });
