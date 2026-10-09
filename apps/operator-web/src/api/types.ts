/**
 * Wire shapes consumed by operator-web, copied from
 * docs/production/C/P03-C-interfaces.md (C1-C5). Shapes the interface file
 * leaves open are marked ASSUMED and listed in
 * docs/production/C/contract-requests/CR-P03-C5-operator-gateway.md.
 */

export interface Money {
  readonly currency: 'SYP' | 'USD';
  readonly amountMinor: string;
  readonly scale: number;
}

export interface SessionView {
  readonly subject: string;
  readonly sessionId: string;
  readonly authVersion: number;
  readonly principalKind: 'account' | 'guest';
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

/** C1 workforce `/me/availability`. */
export interface AvailabilityView {
  readonly status: 'AVAILABLE' | 'ON_BREAK';
  readonly revision: number;
  /** null while the technician never set readiness (Workforce default ON_BREAK, revision 0). */
  readonly updatedAt: string | null;
}

export const OFFER_STATUSES = ['OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/** Existing dispatch technician offer view (`technicianView`). */
export interface OfferView {
  readonly offerId: string;
  readonly revision: number;
  readonly status: OfferStatus;
  readonly expiresAt: string;
  /** Set once the offer is accepted (provider fact, P03-C4). */
  readonly taskId: string | null;
  readonly job: {
    readonly assignmentId: string;
    readonly bookingId: string;
    readonly zoneId: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly status: string;
  };
}

export const TASK_STAGES = [
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_SERVICE',
  'DOCUMENTING',
  'FINISHED',
  'CLOSED',
  'RELEASED',
  'WITHDRAWN',
  'CANCELLED',
] as const;
export type TaskStage = (typeof TASK_STAGES)[number];

export const CHECK_CODES = ['exterior', 'wheels', 'interior', 'quality'] as const;
export type CheckCode = (typeof CHECK_CODES)[number];

export type EvidencePhase = 'BEFORE' | 'AFTER';

export interface EvidenceLink {
  readonly mediaObjectId: string;
  readonly attachedAt: string;
}

export const COLLECTION_OUTCOMES = ['CASH_COLLECTED', 'CASH_NOT_COLLECTED', 'NOT_CASH'] as const;
export type CollectionOutcome = (typeof COLLECTION_OUTCOMES)[number];

export interface CollectionView {
  readonly outcome: CollectionOutcome;
  readonly amount: Money | null;
  readonly reason: string | null;
  readonly declaredAt: string;
  readonly lateAmount: Money | null;
  readonly lateDeclaredAt: string | null;
}

export const NOTE_KINDS = ['HELP', 'CASH_ISSUE', 'PAYMENT_FOLLOW_UP'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

/** C4 task view. */
export interface TaskView {
  readonly taskId: string;
  readonly revision: number;
  readonly stage: TaskStage;
  readonly assignmentId: string;
  readonly bookingId: string;
  readonly zoneId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly acceptedAt: string;
  readonly departedAt: string | null;
  readonly arrivedAt: string | null;
  readonly arrivalMethod: 'MANUAL_CONFIRMATION' | null;
  readonly startedAt: string | null;
  readonly documentedAt: string | null;
  readonly finishedAt: string | null;
  readonly closedAt: string | null;
  readonly conditionNote: string | null;
  readonly checklist: {
    readonly version: string;
    readonly items: readonly {
      readonly code: CheckCode;
      readonly required: boolean;
      readonly checked: boolean;
    }[];
  };
  readonly evidence: {
    readonly BEFORE: readonly [EvidenceLink | null, EvidenceLink | null];
    readonly AFTER: readonly [EvidenceLink | null, EvidenceLink | null];
  };
  readonly collection: CollectionView | null;
  readonly notes: readonly {
    readonly noteId: string;
    readonly kind: NoteKind;
    readonly text: string;
    readonly createdAt: string;
  }[];
  readonly history: readonly { readonly at: string; readonly action: string }[];
  readonly releaseReason: string | null;
}

/** C4 `GET /me/jobs` task summary (provider fact, P03-C4); details come from `/me/tasks/:id`. */
export interface TaskSummary {
  readonly taskId: string;
  readonly revision: number;
  readonly stage: TaskStage;
  readonly assignmentId: string;
  readonly bookingId: string;
  readonly acceptedAt: string;
  readonly closedAt: string | null;
  readonly endedAt: string | null;
  readonly endReason: string | null;
  readonly attentionReason: string | null;
  readonly collection: CollectionView | null;
  readonly updatedAt: string;
  readonly zoneId: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

/** C4 `GET /me/jobs`. */
export interface JobsView {
  readonly offers: readonly OfferView[];
  readonly tasks: readonly TaskSummary[];
}

export type VehicleType = 'sedan' | 'suv' | 'large' | 'pickup';

export type PaymentMethod = 'CASH_ON_COMPLETION' | 'SHAM_CASH' | 'SYRIATEL_CASH';

/** C3 booking technician view. */
export interface BookingTechView {
  readonly bookingId: string;
  readonly revision: number;
  readonly status: string;
  readonly slot: { readonly zoneId: string; readonly startsAt: string; readonly endsAt: string };
  readonly vehicle: {
    readonly type: VehicleType;
    readonly make: string | null;
    readonly model: string | null;
    readonly color: string | null;
    readonly plate: { readonly text: string; readonly region: string | null } | null;
  };
  readonly address: {
    readonly location:
      | { readonly mode: 'manual'; readonly description: string }
      | {
          readonly mode: 'coordinates';
          readonly point: { readonly latitude: string; readonly longitude: string };
          readonly description: string | null;
        };
    readonly details: string | null;
  };
  readonly contact: {
    readonly name: string;
    readonly phone: string;
    readonly notes: string | null;
  };
  readonly lines: readonly {
    readonly lineId: string;
    readonly kind: string;
    readonly definitionId: string | null;
    readonly quantity: number;
    readonly amount: Money;
  }[];
  readonly total: Money;
  readonly paymentMethod: PaymentMethod;
}

export const OBJECT_STATUSES = ['RESERVED', 'AVAILABLE', 'REJECTED', 'EXPIRED', 'PURGED'] as const;

/** C2 media object view. */
export interface ObjectView {
  readonly objectId: string;
  readonly revision: number;
  readonly status: (typeof OBJECT_STATUSES)[number];
  readonly purpose: 'WORK_EVIDENCE';
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly byteLength: number;
  readonly sha256: string;
  readonly ownerSubjectId: string;
  readonly rejectReason: string | null;
  readonly claimed: boolean;
  readonly createdAt: string;
  readonly finalizedAt: string | null;
  readonly expiresAt: string | null;
}

export interface PresignedUpload {
  readonly method: 'PUT';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: string;
}

export interface ReservedObject extends ObjectView {
  readonly upload: PresignedUpload;
}

/** ASSUMED shape of C2 `read-url` (presigned GET). */
export interface PresignedRead {
  readonly method: 'GET';
  readonly url: string;
  readonly expiresAt: string;
}

/** Shared API error envelope (`@carwash/contracts` common/errors). */
export interface ApiErrorBody {
  readonly code: string;
  readonly reason: string | null;
  readonly retryable: boolean;
}
