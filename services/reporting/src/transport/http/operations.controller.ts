import { Controller, Get, Headers, Inject, Param, Query } from '@nestjs/common';
import { AppError, createLogger, resolveCorrelationId } from '@carwash/service-kit';
import { RequestBudget, requireRead, type OperationsRead } from '../../application/access';
import { OperationsQueries, type BookingOperationView } from '../../application/operations.service';
import { OperationsRuleError, type Freshness } from '../../domain/operations';
import { AccessFault, type SessionAuthority } from '../../ports/identity.ports';
import type { DurationSummary } from '../../domain/live-operations';
import type {
  AssignmentRow,
  CashStateRow,
  LinkedHoldRow,
  ResourceEligibilityRow,
} from '../../ports/operations.ports';

export const SESSION_AUTHORITY = 'REPORTING_SESSION_AUTHORITY';
export const READ_BUDGET = 'REPORTING_READ_BUDGET';
export const REPORTING_OPERATIONS_V1 = '/internal/v1/reporting/operations';

type RequestHeaders = Record<string, string | undefined>;

const ACCESS_STATUS = {
  AUTH_REQUIRED: 401,
  AUTH_FORBIDDEN: 403,
  AUTH_RATE_LIMITED: 429,
  AUTH_UNAVAILABLE: 503,
} as const;
const audit = createLogger({ service: 'reporting', base: { component: 'operations-read-audit' } });

function translate(error: unknown): never {
  if (error instanceof AccessFault)
    throw new AppError({
      status: ACCESS_STATUS[error.code],
      code: error.code,
      message: error.code,
    });
  if (error instanceof OperationsRuleError)
    throw new AppError({ status: 422, code: error.code, message: error.code });
  throw error;
}

function freshnessView(f: Freshness) {
  return {
    source: f.source,
    status: f.status,
    lastEventOccurredAt: f.lastEventOccurredAt?.toISOString() ?? null,
    lastAppliedAt: f.lastAppliedAt?.toISOString() ?? null,
    ingestionLagMs: f.ingestionLagMs,
    appliedCount: f.appliedCount.toString(),
  };
}

function bookingView(row: BookingOperationView) {
  return {
    bookingId: row.bookingId,
    customerRef: row.customerRef,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    derivedStatus: row.derivedStatus,
    slot: row.slot && {
      holdId: row.slot.holdId,
      state: row.slot.state,
      zoneId: row.slot.zoneId,
      startsAt: row.slot.startsAt.toISOString(),
      endsAt: row.slot.endsAt.toISOString(),
    },
    sourceUpdatedAt: row.updatedAt.toISOString(),
  };
}

function holdView(hold: LinkedHoldRow) {
  return {
    holdId: hold.holdId,
    state: hold.state,
    zoneId: hold.zoneId,
    startsAt: hold.startsAt.toISOString(),
    endsAt: hold.endsAt.toISOString(),
    version: hold.version,
    occurredAt: hold.occurredAt.toISOString(),
  };
}

function assignmentView(a: AssignmentRow) {
  return {
    assignmentId: a.assignmentId,
    status: a.status,
    resourceId: a.resourceId,
    zoneId: a.zoneId,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    version: a.version,
    occurredAt: a.occurredAt.toISOString(),
    firstObservedAt: a.firstObservedAt.toISOString(),
    firstOfferedAt: a.firstOfferedAt?.toISOString() ?? null,
    firstAssignedAt: a.firstAssignedAt?.toISOString() ?? null,
    reassigned: a.assignedResourceCount > 1,
  };
}

function counts<K extends string>(map: ReadonlyMap<K, number>): Record<string, number> {
  return Object.fromEntries(map);
}

function durationView(d: DurationSummary) {
  return { count: d.count, p50Ms: d.p50Ms, p90Ms: d.p90Ms, maxMs: d.maxMs };
}

function cashStateView(row: CashStateRow) {
  return {
    cashState: row.cashState,
    count: row.count,
    outstanding: row.outstanding.map((o) => ({
      currency: o.currency,
      amountMinor: o.amountMinor,
      scale: o.scale,
    })),
    oldestSince: row.oldestSince?.toISOString() ?? null,
  };
}

function resourceView(row: ResourceEligibilityRow) {
  return {
    resourceId: row.resourceId,
    eligibility: row.eligibility,
    version: row.version,
    changedAt: row.changedAt.toISOString(),
  };
}

/**
 * Read-only operations projections. Every response is labelled `derived` with
 * per-source freshness and the owners holding the authoritative record; no
 * endpoint here mutates any owner's state.
 */
@Controller(REPORTING_OPERATIONS_V1)
export class OperationsController {
  constructor(
    private readonly queries: OperationsQueries,
    @Inject(SESSION_AUTHORITY) private readonly authority: SessionAuthority,
    @Inject(READ_BUDGET) private readonly budget: RequestBudget,
  ) {}

  private async authorize(headers: RequestHeaders, read: OperationsRead): Promise<void> {
    const correlationId = resolveCorrelationId(headers['x-correlation-id']);
    const session = await this.authority.verify({
      authorization: headers.authorization,
      forwardedSubject: headers['x-auth-subject'],
    });
    let allowed = false;
    try {
      this.budget.take(session.subject);
      requireRead(session, read);
      allowed = true;
    } finally {
      // Access context only: subject and decision, never the rows returned.
      audit.info('operations_read', { read, subject: session.subject, correlationId, allowed });
    }
  }

  @Get('bookings')
  async bookings(
    @Headers() headers: RequestHeaders,
    @Query() query: Record<string, string | undefined>,
  ) {
    try {
      await this.authorize(headers, 'bookings');
      const page = await this.queries.bookings({
        from: query.from,
        to: query.to,
        zoneId: query.zoneId,
        status: query.status,
        limit: query.limit,
        cursor: query.cursor,
      });
      return {
        derived: page.derived,
        authority: page.authority,
        freshness: page.freshness.map(freshnessView),
        items: page.items.map(bookingView),
        nextCursor: page.nextCursor,
      };
    } catch (error) {
      return translate(error);
    }
  }

  @Get('bookings/:bookingId')
  async booking(@Headers() headers: RequestHeaders, @Param('bookingId') bookingId: string) {
    try {
      await this.authorize(headers, 'bookings');
      const result = await this.queries.booking(bookingId);
      if (!result.item)
        throw new AppError({ status: 404, code: 'NOT_PROJECTED', message: 'NOT_PROJECTED' });
      return {
        derived: result.derived,
        authority: result.authority,
        freshness: result.freshness.map(freshnessView),
        item: bookingView(result.item),
        holds: result.holds.map(holdView),
        assignments: result.assignments.map(assignmentView),
      };
    } catch (error) {
      return translate(error);
    }
  }

  @Get('resources')
  async resources(
    @Headers() headers: RequestHeaders,
    @Query() query: Record<string, string | undefined>,
  ) {
    try {
      await this.authorize(headers, 'resources');
      const page = await this.queries.resources({
        eligibility: query.eligibility,
        limit: query.limit,
        cursor: query.cursor,
      });
      return {
        derived: page.derived,
        authority: page.authority,
        freshness: page.freshness.map(freshnessView),
        summary: page.summary,
        items: page.items.map(resourceView),
        nextCursor: page.nextCursor,
      };
    } catch (error) {
      return translate(error);
    }
  }

  @Get('kpis/operations')
  async operationsKpis(
    @Headers() headers: RequestHeaders,
    @Query() query: Record<string, string | undefined>,
  ) {
    try {
      await this.authorize(headers, 'operationsKpis');
      const k = await this.queries.operationsKpis({
        from: query.from,
        to: query.to,
        zoneId: query.zoneId,
      });
      return {
        derived: k.derived,
        authority: k.authority,
        freshness: k.freshness.map(freshnessView),
        incompleteSources: k.incompleteSources,
        window: { from: k.window.from.toISOString(), to: k.window.to.toISOString() },
        bookings: { byDerivedStatus: counts(k.bookingsByStatus) },
        assignments: {
          byStatus: counts(k.assignmentsByStatus),
          reassigned: k.reassigned,
          assignedAfterStart: k.assignedAfterStart,
          timeToFirstOffer: durationView(k.timeToFirstOffer),
          timeToAssign: durationView(k.timeToAssign),
          offerToAssign: durationView(k.offerToAssign),
        },
        // No owner publishes field progress (en route, arrived, washing,
        // done) yet; the KPI says so instead of inventing stages.
        fieldStages: { available: false, reason: 'NO_PUBLISHED_SOURCE' },
      };
    } catch (error) {
      return translate(error);
    }
  }

  @Get('kpis/cash')
  async cashKpis(@Headers() headers: RequestHeaders) {
    try {
      await this.authorize(headers, 'cashKpis');
      const k = await this.queries.cashKpis();
      return {
        derived: k.derived,
        authority: k.authority,
        freshness: k.freshness.map(freshnessView),
        incompleteSources: k.incompleteSources,
        asOf: k.asOf.toISOString(),
        states: k.states.map(cashStateView),
      };
    } catch (error) {
      return translate(error);
    }
  }

  @Get('freshness')
  async freshness(@Headers() headers: RequestHeaders) {
    try {
      await this.authorize(headers, 'freshness');
      return { derived: true, freshness: (await this.queries.freshness()).map(freshnessView) };
    } catch (error) {
      return translate(error);
    }
  }
}
