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
    Record<'pricing' | 'scheduling' | 'vehicle' | 'customer' | 'billing' | 'dispatch', string>
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
  /** P04-C3 Dispatch double: per-booking work progress and recorded changes. */
  readonly jobs: Map<string, { work: 'NOT_STARTED' | 'STARTED' | 'COMPLETED'; cancelled: boolean }>;
  readonly jobChanges: Map<string, { bookingId: string; state: string }>;
  /** P04-C3 Billing settlement double: false = the route is not served (404). */
  settlementAvailable: boolean;
  readonly settlements: Map<string, string>;
  /** Bookings with a reported payment: Billing answers REFUND_PENDING. */
  readonly paid: Set<string>;
  /**
   * P04-C3 fault: apply the change, then answer 503 (the response is lost after
   * the owner committed). Keys: dispatch.<action>, scheduling.<release|replace>,
   * billing.settle; the value is how many times.
   */
  readonly loseAfterApply: Map<string, number>;
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
    dispatch: `d${'x'.repeat(39)}`,
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
    jobs: new Map(),
    jobChanges: new Map(),
    settlementAvailable: true,
    settlements: new Map(),
    paid: new Set(),
    loseAfterApply: new Map(),
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
        if (changeRoutes(state, req, path, body, res, service)) return;
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

/** Holds a double released for a booking (replay of the release by booking). */
const releasedFor = new WeakMap<OwnerDoubles, Map<string, string>>();

function stripOwner<T extends { owner: string }>(value: T): Omit<T, 'owner'> {
  const { owner: _owner, ...rest } = value;
  void _owner;
  return rest;
}

/**
 * P04-C3 change routes of the REQUESTED contracts (P04-C-interfaces.md):
 * Dispatch §C2, Scheduling §C1 and the Billing cancellation settlement, with
 * the replay and refusal semantics the providers implement. Returns true when
 * the request was one of them.
 */
function changeRoutes(
  state: OwnerDoubles,
  req: IncomingMessage,
  path: string,
  body: Record<string, unknown>,
  res: ServerResponse,
  service: (req: IncomingMessage, owner: keyof OwnerDoubles['tokens']) => boolean,
): boolean {
  const dispatch =
    /^\/internal\/v1\/dispatch\/bookings\/([^/]+)\/(cancellation|rebinding|rebinding\/confirm|rebinding\/revert)$/.exec(
      path,
    );
  if (dispatch && req.method === 'POST') {
    if (!service(req, 'dispatch')) {
      err(res, 403, 'AUTH_FORBIDDEN');
      return true;
    }
    const action = dispatch[2] ?? '';
    dispatchChange(
      state,
      dispatch[1] ?? '',
      action,
      String(body.changeId),
      lossy(state, `dispatch.${action}`, res),
    );
    return true;
  }
  const scheduling =
    /^\/internal\/v1\/scheduling\/bookings\/([^/]+)\/commitment\/(release|replace)$/.exec(path);
  if (scheduling && req.method === 'POST') {
    if (!service(req, 'scheduling')) {
      err(res, 403, 'AUTH_FORBIDDEN');
      return true;
    }
    const target = lossy(state, `scheduling.${scheduling[2] ?? ''}`, res);
    if (scheduling[2] === 'release') release(state, scheduling[1] ?? '', body, target);
    else replace(state, scheduling[1] ?? '', body, target);
    return true;
  }
  const billing = /^\/internal\/v1\/billing\/bookings\/([^/]+)\/cancellation-settlement$/.exec(
    path,
  );
  if (billing && req.method === 'POST') {
    if (!state.settlementAvailable) {
      err(res, 404, 'NOT_FOUND');
      return true;
    }
    if (!service(req, 'billing')) {
      err(res, 403, 'AUTH_FORBIDDEN');
      return true;
    }
    const bookingId = billing[1] ?? '';
    const outcome =
      state.settlements.get(bookingId) ?? (state.paid.has(bookingId) ? 'REFUND_PENDING' : 'VOIDED');
    state.settlements.set(bookingId, outcome);
    send(lossy(state, 'billing.settle', res), 200, { bookingId, outcome });
    return true;
  }
  return false;
}

/** The real response, or (while a loss is scheduled) a sink followed by a 503. */
function lossy(state: OwnerDoubles, fault: string, res: ServerResponse): ServerResponse {
  const left = state.loseAfterApply.get(fault) ?? 0;
  if (left <= 0) return res;
  state.loseAfterApply.set(fault, left - 1);
  err(res, 503, 'DEPENDENCY_UNAVAILABLE');
  const sink = { writeHead: () => sink, end: () => sink };
  return sink as unknown as ServerResponse;
}

function dispatchChange(
  state: OwnerDoubles,
  bookingId: string,
  action: string,
  changeId: string,
  res: ServerResponse,
): void {
  const job = state.jobs.get(bookingId) ?? { work: 'NOT_STARTED' as const, cancelled: false };
  state.jobs.set(bookingId, job);
  const answer = (outcome: string) =>
    send(res, 200, { bookingId, changeId, outcome, assignmentRevision: 2 });
  const known = state.jobChanges.get(changeId);
  const workRefusal = () =>
    err(
      res,
      422,
      'BUSINESS_RULE_VIOLATION',
      job.work === 'STARTED' ? 'WORK_STARTED' : 'WORK_COMPLETED',
    );
  if (action === 'cancellation') {
    if (job.cancelled || known) return answer('CANCELLED');
    if (job.work !== 'NOT_STARTED') return workRefusal();
    job.cancelled = true;
    state.jobChanges.set(changeId, { bookingId, state: 'CANCELLED' });
    return answer('CANCELLED');
  }
  if (action === 'rebinding') {
    if (known?.state === 'REVERTED') return err(res, 409, 'CONFLICT', 'CHANGE_REVERTED');
    if (known) return answer(known.state);
    if (job.cancelled) return err(res, 422, 'BUSINESS_RULE_VIOLATION', 'BOOKING_CANCELLED');
    if (job.work !== 'NOT_STARTED') return workRefusal();
    state.jobChanges.set(changeId, { bookingId, state: 'REBOUND' });
    return answer('REBOUND');
  }
  if (action === 'rebinding/confirm') {
    if (!known) return err(res, 404, 'NOT_FOUND', 'CHANGE_NOT_FOUND');
    if (known.state === 'REVERTED') return err(res, 409, 'CONFLICT', 'CHANGE_REVERTED');
    known.state = 'CONFIRMED';
    return answer('CONFIRMED');
  }
  if (known?.state === 'CONFIRMED') return err(res, 409, 'CONFLICT', 'CHANGE_CONFIRMED');
  state.jobChanges.set(changeId, { bookingId, state: 'REVERTED' });
  return answer(known === undefined ? 'NOTHING_TO_REVERT' : 'REVERTED');
}

function release(
  state: OwnerDoubles,
  bookingId: string,
  body: Record<string, unknown>,
  res: ServerResponse,
): void {
  const released = releasedFor.get(state) ?? new Map<string, string>();
  releasedFor.set(state, released);
  const hold = state.holds.get(String(body.holdId));
  if (hold && hold.state === 'RELEASED' && released.get(hold.holdId) === bookingId) {
    return send(res, 200, stripOwner(hold));
  }
  if (!hold || hold.state !== 'COMMITTED' || hold.bookingId !== bookingId) {
    return err(res, 409, 'CONFLICT', 'COMMITMENT_NOT_FOUND');
  }
  const next = {
    ...hold,
    state: 'RELEASED' as const,
    bookingId: null,
    revision: hold.revision + 1,
  };
  state.holds.set(hold.holdId, next);
  released.set(hold.holdId, bookingId);
  return send(res, 200, stripOwner(next));
}

function replace(
  state: OwnerDoubles,
  bookingId: string,
  body: Record<string, unknown>,
  res: ServerResponse,
): void {
  const from = state.holds.get(String(body.fromHoldId));
  const to = state.holds.get(String(body.toHoldId));
  if (!from || !to) return err(res, 404, 'NOT_FOUND');
  if (to.state === 'COMMITTED' && to.bookingId === bookingId) {
    return send(res, 200, { bookingId, released: stripOwner(from), committed: stripOwner(to) });
  }
  if (from.state !== 'COMMITTED' || from.bookingId !== bookingId) {
    return err(res, 409, 'CONFLICT', 'COMMITMENT_NOT_FOUND');
  }
  if (to.state !== 'HELD') return err(res, 422, 'BUSINESS_RULE_VIOLATION', 'HOLD_NOT_ACTIVE');
  if (Date.parse(to.expiresAt) <= Date.now()) {
    return err(res, 422, 'BUSINESS_RULE_VIOLATION', 'HOLD_EXPIRED');
  }
  if (to.revision !== body.toExpectedRevision) return err(res, 412, 'REVISION_CONFLICT');
  const freed = {
    ...from,
    state: 'RELEASED' as const,
    bookingId: null,
    revision: from.revision + 1,
  };
  const committed = { ...to, state: 'COMMITTED' as const, bookingId, revision: to.revision + 1 };
  state.holds.set(from.holdId, freed);
  state.holds.set(to.holdId, committed);
  return send(res, 200, {
    bookingId,
    released: stripOwner(freed),
    committed: stripOwner(committed),
  });
}

/** BOOKING_DISPATCH_* for a Booking process wired to the doubles (P03-C3 / P04-C3). */
export function dispatchEnv(doubles: OwnerDoubles): Record<string, string> {
  return {
    BOOKING_DISPATCH_URL: doubles.url,
    BOOKING_DISPATCH_CLIENT_ID: 'booking',
    BOOKING_DISPATCH_CLIENT_TOKEN: doubles.tokens.dispatch,
  };
}
