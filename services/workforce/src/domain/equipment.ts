import { WorkforceError, invalid } from './errors';
import { assertUuid } from './operator';

/**
 * Technician operational equipment and service vehicle (P05-C1).
 *
 * There is no fleet owner in the service catalog, so the operational
 * readiness of the equipment a technician works with is a Workforce fact
 * (approved Workforce model). It records readiness only: no plate, VIN,
 * serial number, location or free text is stored.
 *
 * One item per kind per operator. Operations register an item and decide
 * whether it is REQUIRED for work; the technician (or operations) reports its
 * status. A REQUIRED item that is UNAVAILABLE blocks the operator: that block
 * is an eligibility input, mirrored on the operator row in the same
 * transaction (`operator.equipmentBlocked`).
 */
export const EQUIPMENT_KINDS = [
  'SERVICE_VEHICLE',
  'PRESSURE_WASHER',
  'WATER_SUPPLY',
  'POWER_SUPPLY',
  'VACUUM',
  'CLEANING_KIT',
] as const;
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number];

export const EQUIPMENT_STATUSES = ['READY', 'DEGRADED', 'UNAVAILABLE'] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export const EQUIPMENT_ISSUES = [
  'BREAKDOWN',
  'MAINTENANCE',
  'MISSING',
  'SUPPLIES_EMPTY',
  'OTHER',
] as const;
export type EquipmentIssue = (typeof EQUIPMENT_ISSUES)[number];

export const MAX_EQUIPMENT_REVISION = 2_147_483_647;

export interface EquipmentState {
  readonly id: string;
  readonly operatorId: string;
  readonly kind: EquipmentKind;
  readonly required: boolean;
  readonly status: EquipmentStatus;
  /** Null exactly when READY. */
  readonly issue: EquipmentIssue | null;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function member<T extends string>(values: readonly T[], value: unknown): value is T {
  return values.some((candidate) => candidate === value);
}

export function parseEquipmentKind(value: unknown): EquipmentKind {
  if (!member(EQUIPMENT_KINDS, value)) invalid('Unknown equipment kind.');
  return value;
}

export function registerEquipment(input: {
  readonly id: string;
  readonly operatorId: string;
  readonly kind: EquipmentKind;
  readonly required: boolean;
  readonly now: Date;
}): EquipmentState {
  assertUuid(input.id);
  assertUuid(input.operatorId, 'operatorId');
  if (typeof input.required !== 'boolean') invalid('required must be a boolean.');
  return {
    id: input.id.toLowerCase(),
    operatorId: input.operatorId.toLowerCase(),
    kind: parseEquipmentKind(input.kind),
    required: input.required,
    status: 'READY',
    issue: null,
    revision: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export interface EquipmentStatusCommand {
  readonly status: EquipmentStatus;
  readonly issue: EquipmentIssue | null;
  readonly expectedRevision: number;
}

function revisionOf(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_EQUIPMENT_REVISION
  ) {
    invalid('expectedRevision must be a positive integer.');
  }
  return value;
}

function closedKeys(body: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    invalid('Body must be a JSON object.');
  }
  const present = Object.keys(body).sort();
  const wanted = [...keys].sort();
  if (present.length !== wanted.length || present.some((key, i) => key !== wanted[i])) {
    invalid(`Body must be exactly {${keys.join(', ')}}.`);
  }
  return Object.fromEntries(Object.entries(body));
}

/** Closed body {status, issue, expectedRevision}; issue is null exactly when READY. */
export function parseEquipmentStatusCommand(body: unknown): EquipmentStatusCommand {
  const record = closedKeys(body, ['status', 'issue', 'expectedRevision']);
  const { status, issue } = record;
  if (!member(EQUIPMENT_STATUSES, status)) invalid('Unknown equipment status.');
  if (status === 'READY') {
    if (issue !== null) invalid('A READY item carries no issue.');
    return { status, issue: null, expectedRevision: revisionOf(record.expectedRevision) };
  }
  if (!member(EQUIPMENT_ISSUES, issue)) invalid('A DEGRADED or UNAVAILABLE item needs an issue.');
  return { status, issue, expectedRevision: revisionOf(record.expectedRevision) };
}

/** Closed body {required, expectedRevision}. */
export function parseEquipmentRequirementCommand(body: unknown): {
  readonly required: boolean;
  readonly expectedRevision: number;
} {
  const record = closedKeys(body, ['required', 'expectedRevision']);
  if (typeof record.required !== 'boolean') invalid('required must be a boolean.');
  return { required: record.required, expectedRevision: revisionOf(record.expectedRevision) };
}

function bump(current: EquipmentState, next: Partial<EquipmentState>, now: Date): EquipmentState {
  if (current.revision >= MAX_EQUIPMENT_REVISION) invalid('Equipment revision exhausted.');
  return { ...current, ...next, revision: current.revision + 1, updatedAt: now };
}

function checkRevision(current: EquipmentState, expected: number): void {
  if (expected !== current.revision) {
    throw new WorkforceError('REVISION_CONFLICT', 'Equipment changed; refetch and retry.');
  }
}

export function reportEquipmentStatus(
  current: EquipmentState,
  command: EquipmentStatusCommand,
  now: Date,
): { readonly next: EquipmentState; readonly changed: boolean } {
  checkRevision(current, command.expectedRevision);
  if (current.status === command.status && current.issue === command.issue) {
    return { next: current, changed: false };
  }
  return {
    next: bump(current, { status: command.status, issue: command.issue }, now),
    changed: true,
  };
}

export function setEquipmentRequirement(
  current: EquipmentState,
  command: { readonly required: boolean; readonly expectedRevision: number },
  now: Date,
): { readonly next: EquipmentState; readonly changed: boolean } {
  checkRevision(current, command.expectedRevision);
  if (current.required === command.required) return { next: current, changed: false };
  return { next: bump(current, { required: command.required }, now), changed: true };
}

/** The operator is blocked when any REQUIRED item is UNAVAILABLE. */
export function equipmentBlocks(items: readonly EquipmentState[]): boolean {
  return items.some((item) => item.required && item.status === 'UNAVAILABLE');
}
