import { createLogger, traceHeaders } from '@carwash/service-kit';
import { BookingProcessManager, BookingService, TechnicianViewQuery } from '../../application';
import type { Observer } from '../../ports';
import {
  DispatchAssignmentClient,
  dispatchAssignmentConfig,
} from '../dispatch/dispatch-assignment.client';
import { OwnerHttpClient, type ServiceCredential } from '../http/owner-http.client';
import {
  AddressSnapshotAdapter,
  BillingObligationsAdapter,
  PricingQuoteReader,
  PricingQuoteValidator,
  SchedulingHoldCommitter,
  SchedulingHoldReader,
  VehicleSnapshotAdapter,
} from '../owners/owner-adapters';
import { PrismaBookingStore } from '../persistence/prisma-booking.store';
import type { PrismaService } from '../persistence/prisma.service';
import { systemClock, systemRandom, uuidGenerator } from './system';

/**
 * Builds the application from the environment; shared by the API and the saga
 * worker so both run exactly the same saga code with the same adapters.
 *
 * Owner credentials are per owner (BOOKING_TOKEN_<OWNER>): a credential that
 * leaks from one owner's configuration cannot be replayed against another.
 * A missing URL or token leaves that adapter NOT_CONFIGURED, which fails closed
 * (unavailable), never open.
 */
export function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('INVALID_POSITIVE_INTEGER');
  return value;
}

const CLIENT_ID = /^[a-z][a-z0-9-]{1,63}$/;

function credential(env: NodeJS.ProcessEnv, owner: string): ServiceCredential | null {
  const token = env[`BOOKING_TOKEN_${owner.toUpperCase()}`];
  const clientId = env.BOOKING_SERVICE_CLIENT_ID ?? 'booking';
  if (!CLIENT_ID.test(clientId)) throw new Error('INVALID_BOOKING_SERVICE_CLIENT_ID');
  if (token === undefined || token === '') return null;
  if (token.length < 32 || token.length > 256)
    throw new Error(`INVALID_BOOKING_TOKEN_${owner.toUpperCase()}`);
  return { clientId, token };
}

export function loggingObserver(component: string): Observer {
  const logger = createLogger({ service: 'booking', base: { component } });
  return {
    record(event, fields) {
      logger.info(event, fields);
    },
  };
}

export interface Composition {
  readonly store: PrismaBookingStore;
  readonly saga: BookingProcessManager;
  readonly service: BookingService;
  /** Technician read, authorized by Dispatch on every request (P03-C3). */
  readonly technicianView: TechnicianViewQuery;
}

export function compose(
  prisma: PrismaService,
  env: NodeJS.ProcessEnv,
  options: { readonly instanceId: string; readonly component: string },
): Composition {
  const timeoutMs = positiveInt(env.BOOKING_OWNER_TIMEOUT_MS, 2_500);
  const sagaLeaseMs = positiveInt(env.BOOKING_SAGA_LEASE_MS, 30_000);
  const client = (owner: string, url: string | undefined, service: boolean) =>
    new OwnerHttpClient({
      owner,
      baseUrl: url,
      timeoutMs,
      service: service ? credential(env, owner) : null,
    });

  const observer = loggingObserver(options.component);
  const store = new PrismaBookingStore(prisma, { sagaLeaseMs });
  const saga = new BookingProcessManager({
    store,
    quotes: new PricingQuoteValidator(client('pricing', env.PRICING_URL, true)),
    billing: new BillingObligationsAdapter(client('billing', env.BILLING_URL, true)),
    holds: new SchedulingHoldCommitter(client('scheduling', env.SCHEDULING_URL, true)),
    clock: systemClock,
    ids: uuidGenerator,
    random: systemRandom,
    observer,
    leaseMs: sagaLeaseMs,
    traceparent: () => traceHeaders()['traceparent'] ?? null,
  });
  const service = new BookingService({
    store,
    quotes: new PricingQuoteReader(client('pricing', env.PRICING_URL, false)),
    holds: new SchedulingHoldReader(client('scheduling', env.SCHEDULING_URL, false)),
    vehicles: new VehicleSnapshotAdapter(client('vehicle', env.VEHICLE_URL, true)),
    addresses: new AddressSnapshotAdapter(client('customer', env.CUSTOMER_URL, true)),
    saga,
    clock: systemClock,
    ids: uuidGenerator,
    observer,
    instanceId: options.instanceId,
    inlineBudgetMs: positiveInt(env.BOOKING_INLINE_SAGA_BUDGET_MS, 4_000),
    claimLeaseMs: positiveInt(env.BOOKING_CLAIM_LEASE_MS, 30_000),
  });
  const technicianView = new TechnicianViewQuery({
    store,
    assignments: new DispatchAssignmentClient(dispatchAssignmentConfig(env), systemRandom),
    observer,
  });
  return { store, saga, service, technicianView };
}
