import { WorkforceError, invalid } from './errors';

/**
 * Technician availability ("ready" / "break"), owned by Workforce.
 *
 * It is the technician's own declaration for new work. It is NOT an input of
 * eligibility or capacity: changing it never moves the operator's version or
 * eligibility revision and never emits an event.
 */
export const AVAILABILITY_STATUSES = ['AVAILABLE', 'ON_BREAK'] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

/** Largest revision the INTEGER column can hold. */
export const MAX_AVAILABILITY_REVISION = 2_147_483_647;

export interface AvailabilityState {
  readonly operatorId: string;
  readonly status: AvailabilityStatus;
  /** 0 while never set (no stored row); +1 per committed change. */
  readonly revision: number;
  readonly updatedAt: Date | null;
}

export function isAvailabilityStatus(value: unknown): value is AvailabilityStatus {
  return AVAILABILITY_STATUSES.some((status) => status === value);
}

/** The view of an operator who never declared availability. */
export function initialAvailability(operatorId: string): AvailabilityState {
  return { operatorId, status: 'ON_BREAK', revision: 0, updatedAt: null };
}

export interface AvailabilityCommand {
  readonly status: AvailabilityStatus;
  readonly expectedRevision: number;
}

/**
 * Closed body {status, expectedRevision}: unknown or missing fields are refused.
 * Validated before any store access.
 */
export function parseAvailabilityCommand(body: unknown): AvailabilityCommand {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    invalid('Body must be a JSON object.');
  }
  const keys = Object.keys(body).sort();
  if (keys.length !== 2 || keys[0] !== 'expectedRevision' || keys[1] !== 'status') {
    invalid('Body must be exactly {status, expectedRevision}.');
  }
  const status: unknown = Reflect.get(body, 'status');
  const expectedRevision: unknown = Reflect.get(body, 'expectedRevision');
  if (!isAvailabilityStatus(status)) invalid('status must be AVAILABLE or ON_BREAK.');
  if (
    typeof expectedRevision !== 'number' ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0 ||
    expectedRevision > MAX_AVAILABILITY_REVISION
  ) {
    invalid('expectedRevision must be a non-negative integer.');
  }
  return { status, expectedRevision };
}

export interface AvailabilityChange {
  readonly next: AvailabilityState;
  readonly changed: boolean;
}

/**
 * Optimistic change. The revision is checked first, so a stale view is always
 * refused, even when it asks for the status already in place; a current view
 * asking for the current status is a no-op that returns the current state.
 */
export function changeAvailability(
  current: AvailabilityState,
  command: AvailabilityCommand,
  now: Date,
): AvailabilityChange {
  if (command.expectedRevision !== current.revision) {
    throw new WorkforceError('REVISION_CONFLICT', 'Availability changed; refetch and retry.');
  }
  if (command.status === current.status) return { next: current, changed: false };
  if (current.revision >= MAX_AVAILABILITY_REVISION) invalid('Availability revision exhausted.');
  return {
    next: { ...current, status: command.status, revision: current.revision + 1, updatedAt: now },
    changed: true,
  };
}
