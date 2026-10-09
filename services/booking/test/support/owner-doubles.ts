import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HOUR, addressWire, holdWire, quoteWire, vehicleWire } from './fixtures';

/**
 * One local HTTP server standing in for Identity, Pricing, Scheduling, Vehicle,
 * Customer and Billing, speaking their PUBLISHED route shapes (Billing: the
 * REQUESTED shape of CR-P02-C2). Stateful where the contract is: holds commit
 * once per booking, obligations are idempotent per booking with a void
 * tombstone. It checks the service credential Booking presents per owner and
 * the bearer token on on-behalf reads. Declared as a double in the evidence.
 */
type Principal = { kind: 'account' | 'guest'; subjectId: string };

export interface OwnerDoubles {
  readonly url: string;
  readonly tokens: Readonly<
    Record<'pricing' | 'scheduling' | 'vehicle' | 'customer' | 'billing', string>
  >;
  readonly sessions: Map<
    string,
    { subject: string; principalKind: 'account' | 'guest'; permissions: string[] } | 'DOWN'
  >;
  readonly quotes: Map<string, ReturnType<typeof quoteWire> & { owner: string }>;
  readonly holds: Map<string, ReturnType<typeof holdWire> & { owner: string }>;
  readonly obligations: Map<string, { obligationId: string; state: 'OPEN' | 'VOIDED' }>;
  readonly requests: { method: string; path: string; headers: IncomingMessage['headers'] }[];
  /** Per-owner forced HTTP status (e.g. 503) for the next N calls. */
  readonly failNext: Map<string, { status: number; times: number }>;
  commitsApplied: number;
  /** Delay before Scheduling answers a commit (the effect is applied first). */
  commitDelayMs: number;
  issue(owner: Principal, zoneId?: string): { quoteId: string; holdId: string; zoneId: string };
  close(): Promise<void>;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function err(
  res: ServerResponse,
  status: number,
  code: string,
  reason: string | null = null,
): void {
  send(res, status, {
    error: {
      code,
      reason,
      message: 'double',
      requestId: 'double',
      correlationId: 'double',
      retryable: false,
      retryAfterMs: null,
      issues: [],
    },
  });
}

export async function startOwnerDoubles(): Promise<OwnerDoubles> {
  const tokens = {
    pricing: `p${'x'.repeat(39)}`,
    scheduling: `s${'x'.repeat(39)}`,
    vehicle: `v${'x'.repeat(39)}`,
    customer: `c${'x'.repeat(39)}`,
    billing: `b${'x'.repeat(39)}`,
  } as const;
  const state: OwnerDoubles = {
    url: '',
    tokens,
    sessions: new Map(),
    quotes: new Map(),
    holds: new Map(),
    obligations: new Map(),
    requests: [],
    failNext: new Map(),
    commitsApplied: 0,
    commitDelayMs: 0,
    issue(owner, zoneId = randomUUID()) {
      const now = new Date();
      const quote = { ...quoteWire({ beneficiary: owner, zoneId, now }), owner: owner.subjectId };
      const hold = {
        ...holdWire({
          beneficiary: owner,
          zoneId,
          startsAt: new Date(now.getTime() + 3 * HOUR),
          now,
        }),
        owner: owner.subjectId,
      };
      state.quotes.set(quote.quoteId, quote);
      state.holds.set(hold.holdId, hold);
      return { quoteId: quote.quoteId, holdId: hold.holdId, zoneId };
    },
    close: () => Promise.resolve(),
  };

  const service = (req: IncomingMessage, owner: keyof typeof tokens): boolean =>
    req.headers['x-service-client'] === 'booking' &&
    req.headers['x-service-token'] === tokens[owner];
  const session = (req: IncomingMessage) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const s = state.sessions.get(token);
    return s === 'DOWN' ? undefined : s;
  };
  const strip = <T extends { owner: string }>(value: T): Omit<T, 'owner'> => {
    const { owner: _owner, ...rest } = value;
    void _owner;
    return rest;
  };

  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
    req.on('end', () => {
      void (async () => {
        const url = new URL(req.url ?? '/', 'http://double');
        const path = url.pathname;
        state.requests.push({ method: req.method ?? '', path, headers: req.headers });
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const owner = path.split('/')[3] ?? '';
        const forced = state.failNext.get(owner);
        if (forced && forced.times > 0) {
          forced.times -= 1;
          err(
            res,
            forced.status,
            forced.status >= 500 ? 'DEPENDENCY_UNAVAILABLE' : 'BUSINESS_RULE_VIOLATION',
          );
          return;
        }

        if (path === '/internal/v1/identity/session') {
          const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
          const s = state.sessions.get(token);
          if (s === 'DOWN') return err(res, 500, 'INTERNAL_ERROR');
          if (!s) return err(res, 401, 'AUTH_REQUIRED');
          return send(res, 200, { ...s, sessionId: randomUUID(), authVersion: 1, roles: [] });
        }

        let m = /^\/internal\/v1\/pricing\/quotes\/([^/]+)$/.exec(path);
        if (m && req.method === 'GET') {
          const who = session(req);
          const quote = state.quotes.get(m[1] ?? '');
          if (!who) return err(res, 401, 'AUTH_REQUIRED');
          if (!quote || quote.owner !== who.subject) return err(res, 404, 'NOT_FOUND');
          return send(res, 200, strip(quote));
        }
        m = /^\/internal\/v1\/pricing\/quotes\/([^/]+)\/validate$/.exec(path);
        if (m && req.method === 'POST') {
          if (!service(req, 'pricing')) return err(res, 403, 'AUTH_FORBIDDEN');
          const quote = state.quotes.get(m[1] ?? '');
          if (!quote) return err(res, 404, 'NOT_FOUND');
          const beneficiary = body.beneficiary as Principal;
          const reason =
            Date.parse(quote.expiresAt) <= Date.now()
              ? 'QUOTE_EXPIRED'
              : body.expectedRevision !== quote.revision
                ? 'REVISION_MISMATCH'
                : beneficiary.subjectId !== quote.owner
                  ? 'BENEFICIARY_MISMATCH'
                  : null;
          return send(res, 200, {
            quoteId: quote.quoteId,
            revision: quote.revision,
            valid: reason === null,
            reason,
            total: quote.total,
          });
        }

        m = /^\/internal\/v1\/scheduling\/holds\/([^/]+)$/.exec(path);
        if (m && req.method === 'GET') {
          const who = session(req);
          const hold = state.holds.get(m[1] ?? '');
          if (!who) return err(res, 401, 'AUTH_REQUIRED');
          if (!hold || hold.owner !== who.subject) return err(res, 404, 'NOT_FOUND');
          return send(res, 200, strip(hold));
        }
        m = /^\/internal\/v1\/scheduling\/holds\/([^/]+)\/commit$/.exec(path);
        if (m && req.method === 'POST') {
          if (!service(req, 'scheduling')) return err(res, 403, 'AUTH_FORBIDDEN');
          const hold = state.holds.get(m[1] ?? '');
          if (!hold) return err(res, 404, 'NOT_FOUND');
          let result: () => void;
          if (hold.state === 'COMMITTED') {
            result =
              hold.bookingId === body.bookingId
                ? () => send(res, 200, strip(hold))
                : () => err(res, 422, 'BUSINESS_RULE_VIOLATION', 'HOLD_NOT_ACTIVE');
          } else if (hold.state !== 'HELD') {
            result = () => err(res, 422, 'BUSINESS_RULE_VIOLATION', 'HOLD_NOT_ACTIVE');
          } else if (Date.parse(hold.expiresAt) <= Date.now()) {
            result = () => err(res, 422, 'BUSINESS_RULE_VIOLATION', 'HOLD_EXPIRED');
          } else if (hold.revision !== body.expectedRevision) {
            result = () => err(res, 412, 'REVISION_CONFLICT');
          } else {
            const committed = {
              ...hold,
              state: 'COMMITTED' as const,
              revision: hold.revision + 1,
              bookingId: String(body.bookingId),
            };
            state.holds.set(hold.holdId, committed);
            state.commitsApplied += 1;
            result = () => send(res, 200, strip(committed));
          }
          if (state.commitDelayMs > 0)
            await new Promise((resolve) => setTimeout(resolve, state.commitDelayMs));
          return result();
        }

        if (path === '/internal/v1/vehicle/vehicle-snapshots/resolve' && req.method === 'POST') {
          if (!service(req, 'vehicle')) return err(res, 403, 'AUTH_FORBIDDEN');
          return send(
            res,
            200,
            vehicleWire(String(body.vehicleId), Number(body.expectedRevision), new Date()),
          );
        }
        if (path === '/internal/v1/customer/address-snapshots/resolve' && req.method === 'POST') {
          if (!service(req, 'customer')) return err(res, 403, 'AUTH_FORBIDDEN');
          return send(
            res,
            200,
            addressWire(String(body.addressId), Number(body.expectedRevision), new Date()),
          );
        }

        if (path === '/internal/v1/billing/obligations' && req.method === 'POST') {
          if (!service(req, 'billing')) return err(res, 403, 'AUTH_FORBIDDEN');
          const bookingId = String(body.bookingId);
          const existing = state.obligations.get(bookingId);
          if (existing?.state === 'VOIDED')
            return err(res, 422, 'BUSINESS_RULE_VIOLATION', 'OBLIGATION_VOIDED');
          const obligation = existing ?? {
            obligationId: `obl_${randomUUID().replace(/-/g, '')}`,
            state: 'OPEN' as const,
          };
          state.obligations.set(bookingId, obligation);
          const quote = state.quotes.get(String(body.quoteId));
          if (!quote) return err(res, 422, 'BUSINESS_RULE_VIOLATION', 'QUOTE_NOT_USABLE');
          return send(res, existing ? 200 : 201, {
            obligationId: obligation.obligationId,
            status: obligation.state,
            quoteId: quote.quoteId,
            amount: quote.total,
          });
        }
        if (path === '/internal/v1/billing/obligations/void-for-booking' && req.method === 'POST') {
          if (!service(req, 'billing')) return err(res, 403, 'AUTH_FORBIDDEN');
          const bookingId = String(body.bookingId);
          const existing = state.obligations.get(bookingId);
          state.obligations.set(bookingId, {
            obligationId: existing?.obligationId ?? 'tombstone',
            state: 'VOIDED',
          });
          return send(res, 200, { state: 'VOIDED' });
        }
        err(res, 404, 'NOT_FOUND');
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return Object.assign(state, {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}

/** Environment for a Booking process wired to the doubles. */
export function bookingEnv(doubles: OwnerDoubles, databaseUrl: string): Record<string, string> {
  return {
    DATABASE_URL: databaseUrl,
    IDENTITY_URL: doubles.url,
    PRICING_URL: doubles.url,
    SCHEDULING_URL: doubles.url,
    VEHICLE_URL: doubles.url,
    CUSTOMER_URL: doubles.url,
    BILLING_URL: doubles.url,
    BOOKING_TOKEN_PRICING: doubles.tokens.pricing,
    BOOKING_TOKEN_SCHEDULING: doubles.tokens.scheduling,
    BOOKING_TOKEN_VEHICLE: doubles.tokens.vehicle,
    BOOKING_TOKEN_CUSTOMER: doubles.tokens.customer,
    BOOKING_TOKEN_BILLING: doubles.tokens.billing,
  };
}
