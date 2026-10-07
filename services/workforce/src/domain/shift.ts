import { WorkforceError, invalid } from './errors';
import { assertUuid } from './operator';

export type ShiftStatus = 'ACTIVE' | 'CANCELLED';

export interface ShiftState {
  readonly id: string;
  readonly operatorId: string;
  readonly zoneId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly status: ShiftStatus;
  readonly requester: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function assertShiftDefinition(startsAt: Date, endsAt: Date): void {
  if (
    !Number.isFinite(startsAt.getTime()) ||
    !Number.isFinite(endsAt.getTime()) ||
    endsAt.getTime() <= startsAt.getTime()
  ) {
    invalid('Shift end must be after start.');
  }
  if (endsAt.getTime() - startsAt.getTime() > 24 * 60 * 60 * 1000) {
    invalid('A shift may not exceed 24 hours.');
  }
}

export function createShift(input: {
  id: string;
  operatorId: string;
  zoneId: string;
  startsAt: Date;
  endsAt: Date;
  requester: string;
  idempotencyKey: string;
  requestFingerprint: string;
  now: Date;
}): ShiftState {
  assertUuid(input.id);
  assertUuid(input.operatorId, 'operatorId');
  assertUuid(input.zoneId, 'zoneId');
  assertShiftDefinition(input.startsAt, input.endsAt);
  return {
    ...input,
    id: input.id.toLowerCase(),
    operatorId: input.operatorId.toLowerCase(),
    zoneId: input.zoneId.toLowerCase(),
    status: 'ACTIVE',
    version: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function cancelShift(state: ShiftState, now: Date): ShiftState {
  if (state.status !== 'ACTIVE') {
    throw new WorkforceError('SHIFT_NOT_ACTIVE', 'Shift is already inactive.');
  }
  return { ...state, status: 'CANCELLED', version: state.version + 1, updatedAt: now };
}
