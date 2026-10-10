import { ASSIGNMENT_STATUSES, type AssignmentStatus } from '../domain/assignment';
import { DERIVED_STATUSES, type DerivedStatus } from '../domain/bookings';
import type { MoneyWire } from '../domain/finance';
import {
  INSTANT,
  integer,
  list,
  nullableText,
  object,
  oneOf,
  request,
  text,
  type Result,
} from './http';
import { projection, type Projection } from './operations';

/**
 * Reporting KPIs (P03-D1), read through the Gateway routes requested in
 * CR-D-P03-02. Strict local readers of the documented wire shape until Lane E
 * publishes `reporting.operations.v1`.
 */
export interface Durations {
  readonly count: number;
  readonly p50Ms: number | null;
  readonly p90Ms: number | null;
  readonly maxMs: number | null;
}

export interface OperationsKpis extends Projection {
  readonly incompleteSources: readonly string[];
  readonly bookingsByStatus: Readonly<Record<DerivedStatus, number>>;
  readonly assignmentsByStatus: Readonly<Record<AssignmentStatus, number>>;
  readonly reassigned: number;
  readonly assignedAfterStart: number;
  readonly timeToFirstOffer: Durations;
  readonly timeToAssign: Durations;
  readonly offerToAssign: Durations;
  readonly fieldStagesAvailable: boolean;
}

export const CASH_STATES = [
  'UNPAID',
  'AWAITING_CASH',
  'AWAITING_PAYMENT',
  'UNDER_REVIEW',
  'OUTCOME_UNKNOWN',
  'PAID',
  'VOIDED',
] as const;
export type CashState = (typeof CASH_STATES)[number];

export interface CashStateRow {
  readonly cashState: CashState;
  readonly count: number;
  readonly outstanding: readonly MoneyWire[];
  readonly oldestSince: string | null;
}

export interface CashKpis extends Projection {
  readonly incompleteSources: readonly string[];
  readonly asOf: string;
  readonly states: readonly CashStateRow[];
}

const nullableMs = (v: unknown, p: string): number | null => (v === null ? null : integer(v, p));

function durations(value: unknown, path: string): Durations {
  const d = object(value, path);
  return {
    count: integer(d.count, `${path}.count`),
    p50Ms: nullableMs(d.p50Ms, `${path}.p50Ms`),
    p90Ms: nullableMs(d.p90Ms, `${path}.p90Ms`),
    maxMs: nullableMs(d.maxMs, `${path}.maxMs`),
  };
}

function counts<const K extends readonly string[]>(
  value: unknown,
  keys: K,
  path: string,
): Readonly<Record<K[number], number>> {
  const o = object(value, path);
  const out: Partial<Record<K[number], number>> = {};
  for (const key of keys) out[key as K[number]] = integer(o[key], `${path}.${key}`);
  return out as Record<K[number], number>;
}

function sources(value: unknown): readonly string[] {
  return list(value, 'incompleteSources', (v, p) => text(v, p, /^[a-z]{2,32}$/));
}

export function money(value: unknown, path: string): MoneyWire {
  const m = object(value, path);
  return {
    currency: text(m.currency, `${path}.currency`, /^[A-Z]{3}$/),
    amountMinor: text(m.amountMinor, `${path}.amountMinor`, /^(0|[1-9][0-9]*)$/),
    scale: integer(m.scale, `${path}.scale`),
  };
}

export function operationsKpis(input: {
  readonly from: string;
  readonly to: string;
}): Promise<Result<OperationsKpis>> {
  return request('/admin/operations/kpis', {
    query: { from: input.from, to: input.to },
    read: (raw) => {
      const body = object(raw, '$');
      const bookings = object(body.bookings, 'bookings');
      const assignments = object(body.assignments, 'assignments');
      const stages = object(body.fieldStages, 'fieldStages');
      return {
        ...projection(body),
        incompleteSources: sources(body.incompleteSources),
        bookingsByStatus: counts(bookings.byDerivedStatus, DERIVED_STATUSES, 'bookings'),
        assignmentsByStatus: counts(assignments.byStatus, ASSIGNMENT_STATUSES, 'assignments'),
        reassigned: integer(assignments.reassigned, 'assignments.reassigned'),
        assignedAfterStart: integer(assignments.assignedAfterStart, 'assignments.late'),
        timeToFirstOffer: durations(assignments.timeToFirstOffer, 'timeToFirstOffer'),
        timeToAssign: durations(assignments.timeToAssign, 'timeToAssign'),
        offerToAssign: durations(assignments.offerToAssign, 'offerToAssign'),
        fieldStagesAvailable: stages.available === true,
      };
    },
  });
}

export function cashKpis(): Promise<Result<CashKpis>> {
  return request('/admin/finance/cash', {
    read: (raw) => {
      const body = object(raw, '$');
      return {
        ...projection(body),
        incompleteSources: sources(body.incompleteSources),
        asOf: text(body.asOf, 'asOf', INSTANT),
        states: list(body.states, 'states', (v, p) => {
          const s = object(v, p);
          return {
            cashState: oneOf(s.cashState, CASH_STATES, `${p}.cashState`),
            count: integer(s.count, `${p}.count`),
            outstanding: list(s.outstanding, `${p}.outstanding`, money),
            oldestSince: nullableText(s.oldestSince, `${p}.oldestSince`, INSTANT),
          };
        }),
      };
    },
  });
}
