import { billingV1 } from '@carwash/contracts';
import {
  sameMoney,
  type AddressSnapshot,
  type ObligationResult,
  type RejectionReason,
  type VehicleSnapshot,
  type VoidResult,
} from '../../domain';
import type {
  AddressSnapshots,
  BillingObligations,
  HoldCommit,
  HoldCommitter,
  HoldReader,
  HoldView,
  ObligationRequest,
  QuoteRead,
  QuoteReader,
  QuoteValidation,
  QuoteValidator,
  ReadResult,
  SnapshotRequest,
  UserCredential,
  VehicleSnapshots,
} from '../../ports';
import { errorOf, type HttpOutcome, type OwnerHttpClient } from '../http/owner-http.client';
import {
  ContractViolation,
  moneyFromWireStrict,
  parseAddressSnapshot,
  parseHold,
  parseQuote,
  parseQuoteValidation,
  parseVehicleSnapshot,
} from './contract-acl';

/**
 * Owner adapters. Each maps the owner's HTTP answer to a closed port outcome:
 *   - a definitive owner refusal (404 / 412 / 422 with a known reason) becomes
 *     NOT_USABLE / INVALID / REFUSED;
 *   - anything else (5xx, timeout, network, circuit open, a body that violates
 *     the contract, an unexpected status) is UNAVAILABLE for reads and for
 *     not-yet-pivotal mutations, and UNKNOWN for the pivot commit. Never success.
 */
const PURPOSE = 'booking-create';

function unavailable(outcome: HttpOutcome): {
  readonly kind: 'UNAVAILABLE';
  readonly error: string;
} {
  if (outcome.kind === 'RESPONSE') return { kind: 'UNAVAILABLE', error: `HTTP_${outcome.status}` };
  return { kind: 'UNAVAILABLE', error: outcome.error };
}

function parsed<T>(parse: () => T): T | ContractViolation {
  try {
    return parse();
  } catch (error) {
    if (error instanceof ContractViolation) return error;
    throw error;
  }
}

function reasonOf(outcome: HttpOutcome, fallback: string): string {
  return (outcome.kind === 'RESPONSE' ? errorOf(outcome.body)?.reason : null) ?? fallback;
}

/** Shared read mapping: 200 parse, 404/412/422 definitive, everything else unavailable. */
function readResult<T>(
  outcome: HttpOutcome,
  parse: (body: unknown) => T,
  notFound: string,
): ReadResult<T> {
  if (outcome.kind !== 'RESPONSE') return unavailable(outcome);
  if (outcome.status === 200) {
    const value = parsed(() => parse(outcome.body));
    return value instanceof ContractViolation
      ? { kind: 'UNAVAILABLE', error: 'UPSTREAM_INVALID' }
      : { kind: 'OK', value };
  }
  if (outcome.status === 404) return { kind: 'NOT_USABLE', reason: notFound };
  if (outcome.status === 412) return { kind: 'NOT_USABLE', reason: 'REVISION_CONFLICT' };
  if (outcome.status === 422)
    return { kind: 'NOT_USABLE', reason: reasonOf(outcome, 'BUSINESS_RULE_VIOLATION') };
  return unavailable(outcome);
}

/** pricing.v1 getQuote, on behalf of the principal. */
export class PricingQuoteReader implements QuoteReader {
  constructor(private readonly http: OwnerHttpClient) {}

  async read(
    quoteId: string,
    credential: UserCredential,
    correlationId: string,
  ): Promise<ReadResult<QuoteRead>> {
    const outcome = await this.http.call({
      method: 'GET',
      path: `/internal/v1/pricing/quotes/${encodeURIComponent(quoteId)}`,
      correlationId,
      credential,
    });
    const result = readResult(outcome, (body) => parseQuote(body), 'QUOTE_NOT_FOUND');
    if (result.kind === 'OK' && result.value.snapshot.quoteId !== quoteId) {
      return { kind: 'UNAVAILABLE', error: 'UPSTREAM_INVALID' };
    }
    return result;
  }
}

const VALIDATION_REASON: Readonly<Record<string, RejectionReason>> = {
  QUOTE_EXPIRED: 'QUOTE_EXPIRED',
  QUOTE_REVOKED: 'QUOTE_REVOKED',
  REVISION_MISMATCH: 'QUOTE_INVALID',
  BENEFICIARY_MISMATCH: 'QUOTE_INVALID',
};

/** pricing.v1 validateQuote (service scope pricing.quote.validate, safe). */
export class PricingQuoteValidator implements QuoteValidator {
  constructor(private readonly http: OwnerHttpClient) {}

  async validate(
    input: {
      readonly quoteId: string;
      readonly revision: number;
      readonly beneficiary: { kind: 'account' | 'guest'; subjectId: string };
    },
    correlationId: string,
  ): Promise<QuoteValidation> {
    const outcome = await this.http.call({
      method: 'POST',
      path: `/internal/v1/pricing/quotes/${encodeURIComponent(input.quoteId)}/validate`,
      correlationId,
      body: { expectedRevision: input.revision, beneficiary: input.beneficiary, purpose: PURPOSE },
    });
    if (outcome.kind !== 'RESPONSE') return unavailable(outcome);
    if (outcome.status === 200) {
      const value = parsed(() => parseQuoteValidation(outcome.body));
      if (value instanceof ContractViolation || value.quoteId !== input.quoteId) {
        return { kind: 'UNAVAILABLE', error: 'UPSTREAM_INVALID' };
      }
      if (value.valid) return { kind: 'VALID', total: value.total };
      return { kind: 'INVALID', reason: VALIDATION_REASON[value.reason ?? ''] ?? 'QUOTE_INVALID' };
    }
    if (outcome.status === 404) return { kind: 'INVALID', reason: 'QUOTE_INVALID' };
    if (outcome.status === 422) {
      return {
        kind: 'INVALID',
        reason: VALIDATION_REASON[reasonOf(outcome, '')] ?? 'QUOTE_INVALID',
      };
    }
    // 401/403 here is OUR credential being refused: an operational fault, not
    // the customer's; keep retrying until the deadline and surface the error.
    return unavailable(outcome);
  }
}

/** scheduling.v1 getHold, on behalf of the principal. */
export class SchedulingHoldReader implements HoldReader {
  constructor(private readonly http: OwnerHttpClient) {}

  async read(
    holdId: string,
    credential: UserCredential,
    correlationId: string,
  ): Promise<ReadResult<HoldView>> {
    const outcome = await this.http.call({
      method: 'GET',
      path: `/internal/v1/scheduling/holds/${encodeURIComponent(holdId)}`,
      correlationId,
      credential,
    });
    const result = readResult(outcome, (body) => parseHold(body), 'HOLD_NOT_FOUND');
    if (result.kind === 'OK' && result.value.holdId !== holdId) {
      return { kind: 'UNAVAILABLE', error: 'UPSTREAM_INVALID' };
    }
    return result;
  }
}

/**
 * scheduling.v1 commitHold (service scope scheduling.hold.commit). Replaying
 * the commit for the same booking returns the committed hold, so the request is
 * repeated verbatim until a definitive answer; only a refusal ends it.
 */
export class SchedulingHoldCommitter implements HoldCommitter {
  constructor(private readonly http: OwnerHttpClient) {}

  async commit(
    input: {
      readonly holdId: string;
      readonly expectedRevision: number;
      readonly bookingId: string;
    },
    correlationId: string,
  ): Promise<HoldCommit> {
    const outcome = await this.http.call({
      method: 'POST',
      path: `/internal/v1/scheduling/holds/${encodeURIComponent(input.holdId)}/commit`,
      correlationId,
      idempotencyKey: `booking-commit-${input.bookingId}`,
      body: { expectedRevision: input.expectedRevision, bookingId: input.bookingId },
    });
    if (outcome.kind !== 'RESPONSE') return { kind: 'UNKNOWN', error: outcome.error };
    if (outcome.status === 200) {
      const hold = parsed(() => parseHold(outcome.body));
      if (hold instanceof ContractViolation || hold.holdId !== input.holdId) {
        return { kind: 'UNKNOWN', error: 'UPSTREAM_INVALID' };
      }
      if (hold.state === 'COMMITTED' && hold.bookingId === input.bookingId) {
        return {
          kind: 'COMMITTED',
          slot: {
            holdId: hold.holdId,
            zoneId: hold.zoneId,
            startsAt: hold.startsAt,
            endsAt: hold.endsAt,
          },
        };
      }
      if (hold.state === 'COMMITTED') return { kind: 'REFUSED', reason: 'HOLD_UNAVAILABLE' };
      return { kind: 'UNKNOWN', error: 'UPSTREAM_INVALID' };
    }
    if (outcome.status === 404 || outcome.status === 412)
      return { kind: 'REFUSED', reason: 'HOLD_UNAVAILABLE' };
    if (outcome.status === 422) {
      return {
        kind: 'REFUSED',
        reason: reasonOf(outcome, '') === 'HOLD_EXPIRED' ? 'HOLD_EXPIRED' : 'HOLD_UNAVAILABLE',
      };
    }
    return { kind: 'UNKNOWN', error: `HTTP_${outcome.status}` };
  }
}

/** vehicle.v1 resolveVehicleSnapshot (service scope vehicle.snapshot.resolve). */
export class VehicleSnapshotAdapter implements VehicleSnapshots {
  constructor(private readonly http: OwnerHttpClient) {}

  async resolve(
    request: SnapshotRequest,
    correlationId: string,
  ): Promise<ReadResult<VehicleSnapshot>> {
    const outcome = await this.http.call({
      method: 'POST',
      path: '/internal/v1/vehicle/vehicle-snapshots/resolve',
      correlationId,
      body: {
        owner: request.owner,
        vehicleId: request.id,
        expectedRevision: request.expectedRevision,
        purpose: PURPOSE,
      },
    });
    const result = readResult(outcome, (body) => parseVehicleSnapshot(body), 'VEHICLE_NOT_FOUND');
    if (
      result.kind === 'OK' &&
      (result.value.source !== 'saved' ||
        result.value.vehicleId !== request.id ||
        result.value.vehicleRevision !== request.expectedRevision)
    ) {
      return { kind: 'UNAVAILABLE', error: 'UPSTREAM_INVALID' };
    }
    return result;
  }
}

/** customer.v1 resolveAddressSnapshot (service scope customer.address-snapshot.resolve). */
export class AddressSnapshotAdapter implements AddressSnapshots {
  constructor(private readonly http: OwnerHttpClient) {}

  async resolve(
    request: SnapshotRequest,
    correlationId: string,
  ): Promise<ReadResult<AddressSnapshot>> {
    const outcome = await this.http.call({
      method: 'POST',
      path: '/internal/v1/customer/address-snapshots/resolve',
      correlationId,
      body: {
        owner: request.owner,
        addressId: request.id,
        expectedRevision: request.expectedRevision,
        purpose: PURPOSE,
      },
    });
    const result = readResult(outcome, (body) => parseAddressSnapshot(body), 'ADDRESS_NOT_FOUND');
    if (
      result.kind === 'OK' &&
      (result.value.addressId !== request.id ||
        result.value.addressRevision !== request.expectedRevision)
    ) {
      return { kind: 'UNAVAILABLE', error: 'UPSTREAM_INVALID' };
    }
    return result;
  }
}

/**
 * Published workload-scoped billing.v1 create and by-booking compensation.
 * Unknown create/compensation outcomes retry the exact stable command. A 404
 * never proves financial absence; only a validated immutable compensation
 * receipt proves a real void or an absent-create fence.
 *
 * Billing prices the obligation from the quote itself; an obligation whose
 * amount differs from the booking's snapshot is never accepted as created (it
 * is UPSTREAM_INVALID, so the saga voids it at the deadline and rejects).
 * The payment method is the customer's later choice on the obligation
 * (initializePayment) and is not sent here.
 */
export class BillingObligationsAdapter implements BillingObligations {
  constructor(private readonly http: OwnerHttpClient) {}

  async create(request: ObligationRequest, correlationId: string): Promise<ObligationResult> {
    const outcome = await this.http.call({
      method: 'POST',
      path: '/internal/v1/billing/booking-obligations',
      correlationId,
      idempotencyKey: `booking-obligation-${request.bookingId}`,
      body: {
        beneficiary: request.beneficiary,
        quoteId: request.quoteId,
        bookingId: request.bookingId,
      },
    });
    if (outcome.kind !== 'RESPONSE') return unavailable(outcome);
    if (outcome.status === 200 || outcome.status === 201) {
      try {
        const body = billingV1.parseObligationV1(outcome.body);
        if (
          body.quoteId !== request.quoteId ||
          !sameMoney(moneyFromWireStrict(body.amount), request.amount)
        )
          return { kind: 'UNAVAILABLE', error: 'UPSTREAM_INVALID' };
        return body.status === 'VOIDED'
          ? { kind: 'REJECTED' }
          : { kind: 'CREATED', obligationId: body.obligationId };
      } catch {
        return { kind: 'UNAVAILABLE', error: 'UPSTREAM_INVALID' };
      }
    }
    if (outcome.status === 409 && errorOf(outcome.body)?.code === 'BOOKING_COMPENSATED')
      return { kind: 'REJECTED' };
    if (outcome.status === 422) return { kind: 'REJECTED' };
    return unavailable(outcome);
  }

  async voidForBooking(
    request: Pick<ObligationRequest, 'bookingId' | 'beneficiary' | 'quoteId'>,
    correlationId: string,
  ): Promise<VoidResult> {
    const outcome = await this.http.call({
      method: 'POST',
      path: '/internal/v1/billing/booking-obligations/compensations',
      correlationId,
      idempotencyKey: `booking-void-${request.bookingId}`,
      body: {
        bookingId: request.bookingId,
        beneficiary: request.beneficiary,
        quoteId: request.quoteId,
        reason: 'BOOKING_FAILED',
      },
    });
    if (outcome.kind === 'RESPONSE' && outcome.status === 200) {
      try {
        const receipt = billingV1.parseBookingCompensationV1(outcome.body);
        if (
          receipt.bookingId !== request.bookingId ||
          receipt.quoteId !== request.quoteId ||
          receipt.beneficiary.kind !== request.beneficiary.kind ||
          receipt.beneficiary.subjectId !== request.beneficiary.subjectId
        )
          return { kind: 'UNAVAILABLE', error: 'UPSTREAM_INVALID' };
        // This saga result means compensation completed, not that absent money existed.
        return { kind: 'VOIDED' };
      } catch {
        return { kind: 'UNAVAILABLE', error: 'UPSTREAM_INVALID' };
      }
    }
    return unavailable(outcome);
  }
}
