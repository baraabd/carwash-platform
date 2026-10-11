import { call, type Result } from './client';
import type { MutationRequest } from './operator-api';
import { parseCustody, parseProfile } from './profile-parse';
import type {
  CustodyView,
  EquipmentIssue,
  EquipmentKind,
  EquipmentStatus,
  ExceptionReason,
  ProfileView,
  WeeklyWindow,
} from './types';

/**
 * P05-C2 browser routes, requested from Lane E (CR-P05-C1 §3): the technician's
 * own Workforce profile and the published Billing custody position. Mutations
 * are plain request descriptions so the controller's intent machinery can
 * resend them byte for byte with the same Idempotency-Key after an UNKNOWN.
 */
const enc = encodeURIComponent;

export const readProfile = (): Promise<Result<ProfileView>> =>
  call({ method: 'GET', path: '/api/operator/profile', parse: parseProfile });

export const readCustody = (): Promise<Result<CustodyView>> =>
  call({ method: 'GET', path: '/api/operator/custody', parse: parseCustody });

export const P = {
  schedule: (
    timeZone: string,
    windows: readonly WeeklyWindow[],
    expectedRevision: number,
  ): MutationRequest => ({
    method: 'PUT',
    path: '/api/operator/schedule',
    body: {
      timeZone,
      windows: windows.map((w) => ({
        weekday: w.weekday,
        startMinute: w.startMinute,
        endMinute: w.endMinute,
        zoneId: w.zoneId,
      })),
      expectedRevision,
    },
  }),
  apply: (startDate: string, expectedRevision: number): MutationRequest => ({
    method: 'POST',
    path: '/api/operator/schedule/apply',
    body: { startDate, expectedRevision },
  }),
  exception: (startsAt: string, endsAt: string, reason: ExceptionReason): MutationRequest => ({
    method: 'POST',
    path: '/api/operator/availability-exceptions',
    body: { startsAt, endsAt, reason },
  }),
  cancelException: (exceptionId: string): MutationRequest => ({
    method: 'POST',
    path: `/api/operator/availability-exceptions/${enc(exceptionId)}/cancel`,
    body: {},
  }),
  equipment: (
    kind: EquipmentKind,
    status: EquipmentStatus,
    issue: EquipmentIssue | null,
    expectedRevision: number,
  ): MutationRequest => ({
    method: 'PUT',
    path: `/api/operator/equipment/${enc(kind)}/status`,
    body: { status, issue, expectedRevision },
  }),
};
