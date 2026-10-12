import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BillingService, BookingObligationService } from '../../src/application';
import type { BillingRepository, Clock } from '../../src/ports';
import { IdentitySessionAuthority } from '../../src/infrastructure/identity/identity-session.authority';
import { PricingQuoteReader } from '../../src/infrastructure/pricing/pricing-quote.reader';
import { PricingQuoteValidator } from '../../src/infrastructure/pricing/pricing-quote.validator';
import { ServiceClientCallerAuthority } from '../../src/infrastructure/security/service-callers';
import { RandomIds, Sha256Hasher } from '../../src/infrastructure/system/system.adapters';
import { BILLING_SERVICE, BillingController } from '../../src/transport/http/billing.controller';
import {
  BOOKING_OBLIGATION_SERVICE,
  BookingObligationController,
} from '../../src/transport/http/booking-obligation.controller';
import type { HttpReply } from './billing-http-harness';
import type { PricingStub, Stub } from './upstream-stubs';

/** Workload credentials used by the tests (never real secrets). */
export const WORKLOADS = {
  booking: { clientId: 'booking', token: 'booking-workload-token-'.padEnd(48, 'b') },
  /** Holds the same scope but did not create the obligation under test. */
  other: { clientId: 'booking-replica-b', token: 'other-workload-token-'.padEnd(48, 'o') },
  /** Billing's own credential towards Pricing. */
  billing: { clientId: 'billing', token: 'billing-to-pricing-token-'.padEnd(48, 'p') },
} as const;

const digest = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

export const SERVICE_CLIENTS = JSON.stringify([
  {
    id: WORKLOADS.booking.clientId,
    tokenSha256: digest(WORKLOADS.booking.token),
    scopes: ['billing.obligation.write'],
  },
  {
    id: WORKLOADS.other.clientId,
    tokenSha256: digest(WORKLOADS.other.token),
    scopes: ['billing.obligation.write'],
  },
]);

export interface ValidateQuote {
  readonly beneficiary: { readonly kind: 'account' | 'guest'; readonly subjectId: string };
  readonly status: 'USABLE' | 'EXPIRED' | 'REVOKED';
  readonly revision: number;
  readonly currency: 'SYP' | 'USD';
  readonly totalMinor: string;
}

export interface ValidateStub {
  readonly origin: string;
  readonly quotes: Map<string, ValidateQuote>;
  readonly calls: {
    path: string;
    client: string | undefined;
    authorization: string | undefined;
    body: Record<string, unknown>;
  }[];
  mode: 'normal' | 'error-500' | 'refuse-401' | 'hang' | 'garbage' | 'status-422';
  close(): Promise<void>;
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

/**
 * TEST DOUBLE of Pricing's pricing.v1 `validateQuote`
 * (`POST /internal/v1/pricing/quotes/:quoteId/validate`, service scope) over a
 * real local HTTP listener, so Billing's production adapter (headers, body,
 * timeouts, strict parsing) runs end to end. It is not Pricing.
 */
export async function startValidateStub(): Promise<ValidateStub> {
  const quotes = new Map<string, ValidateQuote>();
  const calls: ValidateStub['calls'] = [];
  const state = { mode: 'normal' as ValidateStub['mode'] };
  const hanging = new Set<ServerResponse>();
  const server: Server = createServer((request, response) => {
    void (async () => {
      const body = await readBody(request);
      const client = request.headers['x-service-client'];
      calls.push({
        path: request.url ?? '',
        client: typeof client === 'string' ? client : undefined,
        authorization: request.headers.authorization,
        body,
      });
      const json = (status: number, value: unknown) =>
        response
          .writeHead(status, { 'content-type': 'application/json' })
          .end(JSON.stringify(value));
      if (state.mode === 'hang') {
        hanging.add(response);
        return;
      }
      if (state.mode === 'error-500') return json(500, {});
      if (state.mode === 'refuse-401') return json(401, { error: { code: 'AUTH_REQUIRED' } });
      if (state.mode === 'status-422') return json(422, { error: { code: 'SELECTION_INVALID' } });
      if (state.mode === 'garbage') return json(200, { quoteId: 'x' });
      const match = /^\/internal\/v1\/pricing\/quotes\/([0-9a-f-]{36})\/validate$/.exec(
        request.url ?? '',
      );
      if (
        request.method !== 'POST' ||
        !match ||
        client !== WORKLOADS.billing.clientId ||
        request.headers['x-service-token'] !== WORKLOADS.billing.token
      )
        return json(match ? 401 : 404, { error: { code: 'AUTH_REQUIRED' } });
      const quoteId = match[1] ?? '';
      const quote = quotes.get(quoteId);
      if (!quote || body.purpose !== 'booking-create')
        return json(404, { error: { code: 'NOT_FOUND' } });
      const beneficiary = body.beneficiary as { kind?: unknown; subjectId?: unknown } | undefined;
      const reason =
        beneficiary?.kind !== quote.beneficiary.kind ||
        beneficiary?.subjectId !== quote.beneficiary.subjectId
          ? 'BENEFICIARY_MISMATCH'
          : body.expectedRevision !== quote.revision
            ? 'REVISION_MISMATCH'
            : quote.status === 'EXPIRED'
              ? 'QUOTE_EXPIRED'
              : quote.status === 'REVOKED'
                ? 'QUOTE_REVOKED'
                : null;
      return json(200, {
        quoteId,
        revision: quote.revision,
        valid: reason === null,
        reason,
        total: { currency: quote.currency, amountMinor: quote.totalMinor, scale: 2 },
      });
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}/`,
    quotes,
    calls,
    get mode() {
      return state.mode;
    },
    set mode(value) {
      state.mode = value;
    },
    async close() {
      for (const response of hanging) response.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export interface BookingSagaHttp {
  request(
    method: 'GET' | 'POST',
    path: string,
    options?: {
      workload?: { clientId: string; token: string };
      token?: string;
      key?: string;
      body?: unknown;
    },
  ): Promise<HttpReply>;
  close(): Promise<void>;
}

/**
 * Real Nest transport with the customer routes (BillingController) and the
 * booking-saga routes, real services and real Identity/Pricing adapters over
 * HTTP. The repository and clock come from the caller.
 */
export async function startBookingSagaHttp(input: {
  repository: BillingRepository;
  clock: Clock;
  identity: Stub;
  pricing: PricingStub;
  validate: ValidateStub;
  serviceClients?: string;
}): Promise<BookingSagaHttp> {
  const pricingConfig = { origin: new URL(input.validate.origin), timeoutMs: 1_000 };
  const bookings = new BookingObligationService({
    repository: input.repository,
    services: new ServiceClientCallerAuthority(input.serviceClients ?? SERVICE_CLIENTS),
    quotes: new PricingQuoteValidator(pricingConfig, WORKLOADS.billing),
    clock: input.clock,
    ids: new RandomIds(),
    hasher: new Sha256Hasher(),
  });
  const billing = new BillingService({
    repository: input.repository,
    authority: new IdentitySessionAuthority({
      origin: new URL(input.identity.origin),
      timeoutMs: 1_000,
    }),
    quotes: new PricingQuoteReader({ origin: new URL(input.pricing.origin), timeoutMs: 1_000 }),
    clock: input.clock,
    ids: new RandomIds(),
    hasher: new Sha256Hasher(),
  });
  const moduleRef = await Test.createTestingModule({
    controllers: [BillingController, BookingObligationController],
    providers: [
      { provide: BILLING_SERVICE, useValue: billing },
      { provide: BOOKING_OBLIGATION_SERVICE, useValue: bookings },
    ],
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  return {
    async request(method, path, options = {}) {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (options.workload) {
        headers['x-service-client'] = options.workload.clientId;
        headers['x-service-token'] = options.workload.token;
      }
      if (options.token) headers.authorization = `Bearer ${options.token}`;
      if (options.key) headers['idempotency-key'] = options.key;
      if (options.body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(url + path, {
        method,
        headers,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
        headers: response.headers,
      };
    },
    async close() {
      await app.close();
    },
  };
}
