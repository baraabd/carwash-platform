import type { PrincipalKind } from '../domain';

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

/** Uniform in [0, 1). Injected so backoff jitter is deterministic in tests. */
export interface RandomSource {
  next(): number;
}

/**
 * The bearer credential of the calling principal. It is used only to read the
 * principal's OWN quote and hold from their owners during the principal's own
 * request (on-behalf-of, read-only). It is never persisted, evented or logged:
 * serialisation yields a fixed marker.
 */
export class UserCredential {
  readonly #authorization: string;

  constructor(authorization: string) {
    this.#authorization = authorization;
  }

  authorizationHeader(): string {
    return this.#authorization;
  }

  toJSON(): string {
    return '[redacted]';
  }

  toString(): string {
    return '[redacted]';
  }
}

/**
 * The authenticated caller, resolved at the transport edge. USER kind and
 * permissions come from Identity's own session view, never from a header the
 * caller could forge.
 */
export type Actor =
  | {
      readonly kind: 'USER';
      readonly principalKind: PrincipalKind;
      readonly subject: string;
      readonly permissions: readonly string[];
    }
  | { readonly kind: 'SYSTEM'; readonly component: string };

export interface RequestMeta {
  readonly actor: Actor;
  readonly correlationId: string;
  readonly credential: UserCredential | null;
}

/**
 * Structured, redacted business log/metric sink. Fields are opaque ids, step
 * names, counts and codes only; callers never pass personal data.
 */
export interface Observer {
  record(event: string, fields: Readonly<Record<string, string | number | boolean | null>>): void;
}
