import {
  BookingError,
  createBooking,
  inlineVehicleSnapshot,
  newSaga,
  type Booking,
  type PrincipalRef,
  type RequestedSlot,
  type SagaState,
  type VehicleSnapshot,
} from '../domain';
import type {
  AddressSnapshots,
  BookingStore,
  Clock,
  HoldReader,
  IdGenerator,
  Observer,
  QuoteReader,
  ReadResult,
  RequestKey,
  RequestMeta,
  UserCredential,
  VehicleSnapshots,
} from '../ports';
import { CREATE_PERMISSION, assertCanRead, requirePrincipal } from './authorization';
import { fingerprint } from './canonical-json';
import { idempotencyKey, parseCreateBooking, type CreateBookingCommand } from './commands';
import type { BookingProcessManager, DriveResult } from './process-manager';

export interface BookingServiceDeps {
  readonly store: BookingStore;
  readonly quotes: QuoteReader;
  readonly holds: HoldReader;
  readonly vehicles: VehicleSnapshots;
  readonly addresses: AddressSnapshots;
  readonly saga: BookingProcessManager;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly observer: Observer;
  /** Owner of the in-request saga lease, e.g. `api-<instance>`. */
  readonly instanceId: string;
  /** Time the API spends driving the saga inline before handing it to the worker. */
  readonly inlineBudgetMs: number;
  /** How long a capture claim protects an Idempotency-Key from a concurrent duplicate. */
  readonly claimLeaseMs: number;
}

export interface BookingView {
  readonly booking: Booking;
  readonly saga: SagaState;
}

export interface CreateResult {
  readonly view: BookingView;
  readonly replayed: boolean;
}

/**
 * Commands and queries of the Booking service.
 *
 * Create = (1) claim the Idempotency-Key, (2) capture immutable snapshots from
 * the owners, (3) persist booking + saga atomically, (4) drive the saga
 * inline for a bounded time. A crash at any point leaves either nothing, a
 * claim that a retry takes over, or a persisted saga the worker resumes; it
 * never leaves two bookings for one key, hold or quote.
 */
export class BookingService {
  constructor(private readonly deps: BookingServiceDeps) {}

  async create(meta: RequestMeta, rawKey: unknown, body: unknown): Promise<CreateResult> {
    const beneficiary = requirePrincipal(meta.actor, CREATE_PERMISSION);
    if (rawKey === undefined || rawKey === null || rawKey === '') {
      throw new BookingError('IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header is required.');
    }
    const key = idempotencyKey(rawKey);
    const command = parseCreateBooking(body);
    const credential = meta.credential;
    if (credential === null) throw new BookingError('FORBIDDEN', 'The operation is not allowed.');

    const requestKey: RequestKey = {
      principalKind: beneficiary.kind,
      subject: beneficiary.subjectId,
      key,
      fingerprint: fingerprint(command),
    };
    const now = this.deps.clock.now();
    const claim = await this.deps.store.claimRequest(
      requestKey,
      this.deps.ids.next(),
      now,
      this.deps.claimLeaseMs,
    );
    if (claim.kind === 'CONFLICT') {
      throw new BookingError(
        'IDEMPOTENCY_CONFLICT',
        'The Idempotency-Key was used for another request.',
      );
    }
    if (claim.kind === 'IN_PROGRESS') {
      throw new BookingError(
        'IDEMPOTENCY_IN_PROGRESS',
        'The same request is still being processed.',
      );
    }
    if (claim.kind === 'BOUND') return { view: await this.replay(claim.bookingId), replayed: true };

    let booking: Booking;
    try {
      booking = await this.capture(
        command,
        beneficiary,
        credential,
        claim.bookingId,
        meta.correlationId,
      );
    } catch (error) {
      // Nothing was persisted. Failures are not cached: the claim is dropped so
      // a retry (or a corrected request after re-quoting) can use the same key.
      await this.deps.store.abandonRequest(requestKey, claim.fence);
      throw error;
    }

    const saga = newSaga(booking.id, this.deps.clock.now());
    const inserted = await this.deps.store.insertBooking(
      booking,
      saga,
      { key: requestKey, fence: claim.fence },
      {
        action: 'booking.created',
        actor: meta.actor,
        bookingId: booking.id,
        correlationId: meta.correlationId,
        details: {
          status: booking.status,
          holdId: booking.requestedSlot.holdId,
          quoteId: booking.quote.quoteId,
          vehicleSource: booking.vehicle.source,
          paymentMethod: booking.paymentMethod,
        },
      },
    );
    if (inserted === 'HOLD_TAKEN') {
      await this.deps.store.abandonRequest(requestKey, claim.fence);
      throw new BookingError(
        'HOLD_ALREADY_BOOKED',
        'This time slot is already used by another booking.',
        'HOLD_NOT_ACTIVE',
      );
    }
    if (inserted === 'QUOTE_TAKEN') {
      await this.deps.store.abandonRequest(requestKey, claim.fence);
      throw new BookingError(
        'QUOTE_ALREADY_BOOKED',
        'This quote is already used by another booking.',
      );
    }
    if (inserted === 'CLAIM_LOST') {
      throw new BookingError(
        'IDEMPOTENCY_IN_PROGRESS',
        'The same request is still being processed.',
      );
    }
    this.deps.observer.record('booking_created', { bookingId: booking.id, claim: claim.kind });

    await this.driveInline(booking.id);
    return { view: await this.replay(booking.id), replayed: false };
  }

  async get(meta: RequestMeta, bookingId: string): Promise<BookingView> {
    const record = await this.deps.store.find(bookingId);
    if (!record) throw new BookingError('BOOKING_NOT_FOUND', 'Booking not found.');
    assertCanRead(meta.actor, record.booking);
    return { booking: record.booking, saga: record.saga };
  }

  private async driveInline(bookingId: string): Promise<DriveResult> {
    try {
      return await this.deps.saga.drive(bookingId, this.deps.instanceId, this.deps.inlineBudgetMs);
    } catch (error) {
      // The booking is persisted and its saga is durable; the worker resumes it.
      this.deps.observer.record('booking_saga_inline_failed', {
        bookingId,
        error: error instanceof Error ? error.name : 'UNKNOWN',
      });
      return 'WAITING';
    }
  }

  private async replay(bookingId: string): Promise<BookingView> {
    const record = await this.deps.store.find(bookingId);
    if (!record) throw new Error('BOUND_BOOKING_MISSING');
    return { booking: record.booking, saga: record.saga };
  }

  private async capture(
    command: CreateBookingCommand,
    beneficiary: PrincipalRef,
    credential: UserCredential,
    bookingId: string,
    correlationId: string,
  ): Promise<Booking> {
    const [quote, hold, vehicle, address] = await Promise.all([
      this.deps.quotes.read(command.quote.quoteId, credential, correlationId),
      this.deps.holds.read(command.hold.holdId, credential, correlationId),
      command.vehicle.source === 'saved'
        ? this.deps.vehicles.resolve(
            {
              owner: beneficiary,
              id: command.vehicle.vehicleId,
              expectedRevision: command.vehicle.revision,
            },
            correlationId,
          )
        : Promise.resolve<ReadResult<VehicleSnapshot>>({
            kind: 'OK',
            value: inlineVehicleSnapshot(command.vehicle.inline, this.deps.clock.now()),
          }),
      this.deps.addresses.resolve(
        {
          owner: beneficiary,
          id: command.address.addressId,
          expectedRevision: command.address.revision,
        },
        correlationId,
      ),
    ]);

    const { snapshot: quoteSnapshot, status: quoteStatus } = usable(
      quote,
      'QUOTE_NOT_USABLE',
      'quote',
    );
    if (quoteStatus !== 'USABLE') {
      throw new BookingError(
        'QUOTE_NOT_USABLE',
        'The quote can no longer be used.',
        `QUOTE_${quoteStatus}`,
      );
    }
    if (quoteSnapshot.revision !== command.quote.revision) {
      throw new BookingError(
        'QUOTE_NOT_USABLE',
        'The quote changed; request a new quote.',
        'REVISION_MISMATCH',
      );
    }
    const holdValue = usable(hold, 'HOLD_ALREADY_BOOKED', 'hold');
    if (holdValue.state !== 'HELD' || holdValue.revision !== command.hold.revision) {
      throw new BookingError(
        'HOLD_ALREADY_BOOKED',
        'The selected time is no longer held.',
        'HOLD_NOT_ACTIVE',
      );
    }
    if (
      holdValue.beneficiary.kind !== beneficiary.kind ||
      holdValue.beneficiary.subjectId !== beneficiary.subjectId
    ) {
      // The owner served another principal's hold: refuse, never adopt it.
      throw new BookingError(
        'HOLD_ALREADY_BOOKED',
        'The selected time is no longer held.',
        'HOLD_NOT_ACTIVE',
      );
    }
    const requestedSlot: RequestedSlot = {
      holdId: holdValue.holdId,
      holdRevision: holdValue.revision,
      zoneId: holdValue.zoneId,
      startsAt: holdValue.startsAt,
      endsAt: holdValue.endsAt,
    };

    return createBooking({
      id: bookingId,
      beneficiary,
      paymentMethod: command.paymentMethod,
      contact: command.contact,
      vehicle: usable(vehicle, 'VEHICLE_NOT_USABLE', 'vehicle'),
      address: usable(address, 'ADDRESS_NOT_USABLE', 'address'),
      quote: quoteSnapshot,
      requestedSlot,
      now: this.deps.clock.now(),
    });
  }
}

function usable<T>(
  result: ReadResult<T>,
  code: 'QUOTE_NOT_USABLE' | 'HOLD_ALREADY_BOOKED' | 'VEHICLE_NOT_USABLE' | 'ADDRESS_NOT_USABLE',
  what: string,
): T {
  if (result.kind === 'OK') return result.value;
  if (result.kind === 'NOT_USABLE') {
    throw new BookingError(code, `The selected ${what} cannot be used.`, result.reason);
  }
  throw new BookingError('DEPENDENCY_UNAVAILABLE', `The ${what} owner is unavailable; retry.`);
}
