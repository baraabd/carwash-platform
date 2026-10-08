import { CORRELATION_HEADER, resolveCorrelationId } from '@carwash/service-kit';
import { UserCredential, type RequestMeta } from '../../ports';
import {
  IdentityAuthFailure,
  type IdentitySessionClient,
} from '../../infrastructure/identity/identity-session.client';
import { RateLimited } from './http-errors';

export interface HeaderBag {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

function header(request: HeaderBag, name: string): string | undefined {
  const value = request.headers[name];
  if (Array.isArray(value)) return undefined; // duplicated auth headers are ambiguous
  return value;
}

/**
 * Fixed-window, per-actor request budget. Process-local by design: it bounds
 * abuse from one caller against one replica; global quotas belong to the edge.
 */
export class RequestBudget {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): void {
    const at = this.now();
    const current = this.windows.get(key);
    if (!current || at - current.start >= this.windowMs) {
      if (this.windows.size > 10_000) this.windows.clear();
      this.windows.set(key, { start: at, count: 1 });
      return;
    }
    current.count += 1;
    if (current.count > this.limit) throw new RateLimited();
  }
}

/**
 * Resolves the caller, deny by default. Booking's API is used by principals
 * (account or guest customers, operations staff) only: `Authorization: Bearer`
 * is resolved by Identity. Service credentials are refused here; no service
 * calls Booking in this version.
 */
export class ActorResolver {
  constructor(
    private readonly identity: IdentitySessionClient,
    private readonly budget: RequestBudget,
  ) {}

  async resolve(request: HeaderBag): Promise<RequestMeta> {
    const correlationId = resolveCorrelationId(header(request, CORRELATION_HEADER));
    if (
      request.headers['x-service-client'] !== undefined ||
      request.headers['x-service-token'] !== undefined
    ) {
      throw new IdentityAuthFailure('UNAUTHENTICATED');
    }
    const authorization = header(request, 'authorization');
    if (authorization === undefined) throw new IdentityAuthFailure('UNAUTHENTICATED');
    const session = await this.identity.resolve(authorization, correlationId);
    this.budget.take(`${session.principalKind}:${session.subject}`);
    return {
      correlationId,
      credential: new UserCredential(authorization),
      actor: {
        kind: 'USER',
        principalKind: session.principalKind,
        subject: session.subject,
        permissions: session.permissions,
      },
    };
  }
}
