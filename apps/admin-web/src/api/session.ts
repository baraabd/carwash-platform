import type { StaffSession } from '../domain/access';
import { UUID, list, object, oneOf, request, text, type Result } from './http';

/**
 * Staff sign-in through Identity's published auth routes on the Gateway
 * (email + password, then a one-time code). Session cookies are HttpOnly and
 * set by Identity; the console only learns who is signed in and what they may do.
 */
function session(raw: unknown): StaffSession {
  const s = object(raw, '$');
  return {
    subject: text(s.subject, 'subject', UUID),
    principalKind: oneOf(s.principalKind, ['account', 'guest'] as const, 'principalKind'),
    roles: list(s.roles, 'roles', (v, p) => text(v, p, /^[a-z-]{2,32}$/)),
    permissions: list(s.permissions, 'permissions', (v, p) => text(v, p, /^[a-z][a-z.:-]{1,62}$/)),
  };
}

const ignore = (): null => null;

export function currentSession(): Promise<Result<StaffSession>> {
  return request('/auth/session', { read: session });
}

/** Obtains the double-submit CSRF cookie that every later auth POST must echo. */
export function prepareCsrf(): Promise<Result<null>> {
  return request('/auth/csrf', { read: ignore });
}

export function startLogin(email: string, password: string): Promise<Result<string>> {
  return request('/auth/login', {
    method: 'POST',
    body: { email, password },
    read: (raw) => text(object(raw, '$').challengeId, 'challengeId', UUID),
  });
}

export function verifyCode(challengeId: string, code: string): Promise<Result<StaffSession>> {
  return request('/auth/challenges/verify', {
    method: 'POST',
    body: { challengeId, code },
    read: session,
  });
}

export function signOut(): Promise<Result<null>> {
  return request('/auth/logout', { method: 'POST', body: {}, read: ignore });
}
