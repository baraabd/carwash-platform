import { ASSIGNMENT_STATUSES, type AssignmentStatus, type OfferDraft } from '../domain/assignment';
import type { MoneyWire } from '../domain/finance';
import {
  INSTANT,
  UUID,
  idempotencyKey,
  integer,
  list,
  nullableText,
  object,
  oneOf,
  request,
  text,
  type Result,
} from './http';
import { money } from './kpis';

/**
 * Authoritative owner reads and commands for one booking, through the Gateway
 * routes requested in CR-D-P03-02 / CR-D-P03-06. Booking owns the booking,
 * Dispatch the assignment, Communications its delivery state. Strict local
 * readers of each owner's documented wire shape; anything else is MALFORMED.
 */

/* --------------------------------- Booking -------------------------------- */

export interface OwnedBooking {
  readonly bookingId: string;
  readonly revision: number;
  readonly status: string;
  readonly confirmation: string;
  readonly paymentMethod: string;
  readonly total: MoneyWire;
  readonly slotStartsAt: string;
  readonly slotEndsAt: string;
  readonly slotCommitted: boolean;
  readonly confirmedAt: string | null;
}

/**
 * Only what operations needs to run the job is read. The owner's contact and
 * address fields are deliberately not kept by the console (data minimisation):
 * they stay with Booking and are never rendered or logged here.
 */
export function ownedBooking(bookingId: string): Promise<Result<OwnedBooking>> {
  return request(`/admin/bookings/${encodeURIComponent(bookingId)}`, {
    read: (raw) => {
      const b = object(raw, '$');
      const slot = object(b.slot, 'slot');
      if (typeof slot.committed !== 'boolean') throw new Error('slot.committed');
      return {
        bookingId: text(b.bookingId, 'bookingId', UUID),
        revision: integer(b.revision, 'revision'),
        status: text(b.status, 'status', /^[A-Z_]{2,32}$/),
        confirmation: text(b.confirmation, 'confirmation', /^[A-Z_]{2,32}$/),
        paymentMethod: text(b.paymentMethod, 'paymentMethod', /^[A-Z_]{2,32}$/),
        total: money(b.total, 'total'),
        slotStartsAt: text(slot.startsAt, 'slot.startsAt', INSTANT),
        slotEndsAt: text(slot.endsAt, 'slot.endsAt', INSTANT),
        slotCommitted: slot.committed,
        confirmedAt: nullableText(b.confirmedAt, 'confirmedAt', INSTANT),
      };
    },
  });
}

/* -------------------------------- Dispatch -------------------------------- */

export interface LiveOffer {
  readonly offerId: string;
  readonly status: string;
  readonly resourceId: string;
  readonly technicianSubjectId: string;
  readonly expiresAt: string;
}

export interface LiveAssignment {
  readonly assignmentId: string;
  readonly revision: number;
  readonly bookingId: string;
  readonly status: AssignmentStatus;
  readonly resourceId: string | null;
  readonly technicianSubjectId: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly cancelReason: string | null;
  readonly updatedAt: string;
  readonly offer: LiveOffer | null;
}

function assignment(raw: unknown): LiveAssignment {
  const a = object(raw, '$');
  const offer = a.offer === null ? null : object(a.offer, 'offer');
  return {
    assignmentId: text(a.assignmentId, 'assignmentId', UUID),
    revision: integer(a.revision, 'revision'),
    bookingId: text(a.bookingId, 'bookingId', UUID),
    status: oneOf(a.status, ASSIGNMENT_STATUSES, 'status'),
    resourceId: nullableText(a.resourceId, 'resourceId', UUID),
    technicianSubjectId: nullableText(a.technicianSubjectId, 'technicianSubjectId', UUID),
    startsAt: text(a.startsAt, 'startsAt', INSTANT),
    endsAt: text(a.endsAt, 'endsAt', INSTANT),
    cancelReason: nullableText(a.cancelReason, 'cancelReason', /^[A-Z_]{2,48}$/),
    updatedAt: text(a.updatedAt, 'updatedAt', INSTANT),
    offer: offer && {
      offerId: text(offer.offerId, 'offer.offerId', UUID),
      status: text(offer.status, 'offer.status', /^[A-Z_]{2,32}$/),
      resourceId: text(offer.resourceId, 'offer.resourceId', UUID),
      technicianSubjectId: text(offer.technicianSubjectId, 'offer.technicianSubjectId', UUID),
      expiresAt: text(offer.expiresAt, 'offer.expiresAt', INSTANT),
    },
  };
}

export function bookingAssignment(bookingId: string): Promise<Result<LiveAssignment>> {
  return request(`/admin/bookings/${encodeURIComponent(bookingId)}/assignment`, {
    read: assignment,
  });
}

/**
 * One Dispatch command. The key is created once per intended change and kept
 * by the caller, so "resend the same command" after an UNKNOWN outcome reaches
 * Dispatch with the same Idempotency-Key and cannot act twice.
 */
export interface AssignmentCommandInput {
  readonly assignmentId: string;
  readonly expectedRevision: number;
  readonly key: string;
}

export function offerJob(
  input: AssignmentCommandInput & { readonly offer: OfferDraft },
): Promise<Result<LiveAssignment>> {
  return command('offers', input, {
    expectedRevision: input.expectedRevision,
    resourceId: input.offer.resourceId,
    technicianSubjectId: input.offer.technicianSubjectId,
  });
}

export function reassignJob(
  input: AssignmentCommandInput & { readonly offer: OfferDraft },
): Promise<Result<LiveAssignment>> {
  return command('reassign', input, {
    expectedRevision: input.expectedRevision,
    resourceId: input.offer.resourceId,
    technicianSubjectId: input.offer.technicianSubjectId,
  });
}

export function unassignJob(input: AssignmentCommandInput): Promise<Result<LiveAssignment>> {
  return command('unassign', input, { expectedRevision: input.expectedRevision });
}

function command(
  action: 'offers' | 'reassign' | 'unassign',
  input: AssignmentCommandInput,
  body: Record<string, unknown>,
): Promise<Result<LiveAssignment>> {
  return request(`/admin/assignments/${encodeURIComponent(input.assignmentId)}/${action}`, {
    method: 'POST',
    body,
    idempotencyKey: input.key,
    read: assignment,
  });
}

export { idempotencyKey as newCommandKey };

/* ----------------------------- Communications ----------------------------- */

export interface DeliveryState {
  readonly id: string;
  readonly channel: string;
  readonly templateKey: string;
  readonly state: string;
  readonly attemptCount: number;
  readonly lastErrorCode: string | null;
  readonly updatedAt: string;
}

export function bookingNotifications(bookingId: string): Promise<Result<readonly DeliveryState[]>> {
  return request('/admin/notifications', {
    query: { subjectType: 'booking', subjectRef: bookingId, limit: '20' },
    read: (raw) =>
      list(object(raw, '$').items, 'items', (v, p) => {
        const n = object(v, p);
        return {
          id: text(n.id, `${p}.id`, UUID),
          channel: text(n.channel, `${p}.channel`, /^[A-Z]{2,8}$/),
          templateKey: text(n.templateKey, `${p}.templateKey`, /^[a-z][a-z0-9.-]{1,63}$/),
          state: text(n.state, `${p}.state`, /^[A-Z_]{2,24}$/),
          attemptCount: integer(n.attemptCount, `${p}.attemptCount`),
          lastErrorCode: nullableText(n.lastErrorCode, `${p}.lastErrorCode`),
          updatedAt: text(n.updatedAt, `${p}.updatedAt`, INSTANT),
        };
      }),
  });
}

/**
 * Dispatch's authoritative assignments of one zone whose job starts in
 * [from, to): one request per zone on a page instead of one per row.
 */
export function zoneAssignments(input: {
  readonly zoneId: string;
  readonly from: string;
  readonly to: string;
}): Promise<Result<readonly LiveAssignment[]>> {
  return request('/admin/assignments', {
    query: { zoneId: input.zoneId, from: input.from, to: input.to },
    read: (raw) =>
      list(object(raw, '$').items, 'items', (v) =>
        assignment({ ...object(v, 'item'), offer: null }),
      ),
  });
}
