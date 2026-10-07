/** A session Identity has verified for this request. */
export interface VerifiedSession {
  readonly subject: string;
  readonly sessionId: string;
  readonly authVersion: number;
  readonly permissions: readonly string[];
}

export type AccessFaultCode = 'AUTH_REQUIRED' | 'AUTH_FORBIDDEN' | 'AUTH_UNAVAILABLE';

export class AccessFault extends Error {
  constructor(readonly code: AccessFaultCode) {
    super(code);
    this.name = 'AccessFault';
  }
}

/**
 * Establishes who is calling, by asking Identity. Implementations MUST fail
 * closed: an unreachable or malformed Identity answer is AUTH_UNAVAILABLE,
 * never a permissive fallback or a cached older session.
 */
export interface SessionAuthority {
  verify(input: {
    authorization: string | undefined;
    forwardedSubject: string | undefined;
  }): Promise<VerifiedSession>;
}
