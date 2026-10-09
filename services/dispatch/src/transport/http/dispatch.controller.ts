import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import { DispatchService, type AssignmentView, type OfferInput } from '../../application';
import {
  invalid,
  isDeclineReason,
  type AssignmentState,
  type AssignmentStatus,
  type OfferState,
} from '../../domain';
import { ActorResolver, type HeaderBag } from './actor-resolver';
import { DispatchHttpFilter } from './http-errors';

export const DISPATCH_V1 = '/internal/v1/dispatch';

interface StatusResponse {
  status(code: number): StatusResponse;
}

const ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = [
  'UNASSIGNED',
  'OFFERED',
  'ASSIGNED',
  'CANCELLED',
];

/** Closed body: unknown fields are refused, never ignored. */
function objectBody(
  body: unknown,
  allowed: readonly string[],
  required: readonly string[],
): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw invalid('Body must be a JSON object.');
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw invalid(`Unexpected field: ${key.slice(0, 40)}.`);
  }
  for (const key of required) if (!(key in record)) throw invalid(`Missing field: ${key}.`);
  return record;
}

function str(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > 200) throw invalid(`${field} must be a string.`);
  return value;
}

function int(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw invalid(`${field} must be an integer.`);
  return value;
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** UTC instants only; an offset-less or local time is rejected, never guessed. */
function instant(value: unknown, field: string): Date {
  const text = str(value, field);
  if (!INSTANT.test(text)) throw invalid(`${field} must be a UTC ISO-8601 instant.`);
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) throw invalid(`${field} is not a valid instant.`);
  return date;
}

function idempotencyKey(req: HeaderBag): string | undefined {
  const value = req.headers['idempotency-key'];
  return typeof value === 'string' ? value : undefined;
}

function offerInput(body: unknown): OfferInput {
  const input = objectBody(
    body,
    ['expectedRevision', 'resourceId', 'technicianSubjectId', 'ttlSeconds'],
    ['expectedRevision', 'resourceId', 'technicianSubjectId'],
  );
  return {
    expectedRevision: int(input.expectedRevision, 'expectedRevision'),
    resourceId: str(input.resourceId, 'resourceId'),
    technicianSubject: str(input.technicianSubjectId, 'technicianSubjectId'),
    ...(input.ttlSeconds === undefined ? {} : { ttlSeconds: int(input.ttlSeconds, 'ttlSeconds') }),
  };
}

function offerView(offer: OfferState) {
  return {
    offerId: offer.id,
    revision: offer.version,
    status: offer.status,
    resourceId: offer.resourceId,
    technicianSubjectId: offer.technicianSubject,
    expiresAt: offer.expiresAt.toISOString(),
    declineReason: offer.declineReason,
    withdrawReason: offer.withdrawReason,
    createdAt: offer.createdAt.toISOString(),
    updatedAt: offer.updatedAt.toISOString(),
  };
}

function assignmentView(assignment: AssignmentState) {
  return {
    assignmentId: assignment.id,
    revision: assignment.version,
    bookingId: assignment.bookingId,
    holdId: assignment.holdId,
    zoneId: assignment.zoneId,
    startsAt: assignment.startsAt.toISOString(),
    endsAt: assignment.endsAt.toISOString(),
    status: assignment.status,
    resourceId: assignment.resourceId,
    technicianSubjectId: assignment.technicianSubject,
    cancelReason: assignment.cancelReason,
    createdAt: assignment.createdAt.toISOString(),
    updatedAt: assignment.updatedAt.toISOString(),
  };
}

/** Operations view: the job plus its current offer. */
export function operationsView(view: AssignmentView) {
  return {
    ...assignmentView(view.assignment),
    offer: view.offer ? offerView(view.offer) : null,
  };
}

/**
 * Technician view: their own offer and the job window only. No booking
 * revision, no other technician, no resource of another offer.
 */
export function technicianView(offer: OfferState, assignment: AssignmentState) {
  return {
    offerId: offer.id,
    revision: offer.version,
    status: offer.status,
    expiresAt: offer.expiresAt.toISOString(),
    job: {
      assignmentId: assignment.id,
      bookingId: assignment.bookingId,
      zoneId: assignment.zoneId,
      startsAt: assignment.startsAt.toISOString(),
      endsAt: assignment.endsAt.toISOString(),
      status: assignment.status,
    },
  };
}

@Controller(DISPATCH_V1)
@UseFilters(DispatchHttpFilter)
export class DispatchController {
  constructor(
    @Inject(DispatchService) private readonly dispatch: DispatchService,
    @Inject(ActorResolver) private readonly actors: ActorResolver,
  ) {}

  @Get('assignments')
  async list(
    @Req() req: HeaderBag,
    @Query('zoneId') zoneId: unknown,
    @Query('from') from: unknown,
    @Query('to') to: unknown,
    @Query('status') status: unknown,
  ) {
    const meta = await this.actors.resolve(req);
    let wanted: AssignmentStatus | null = null;
    if (status !== undefined) {
      const text = str(status, 'status');
      const match = ASSIGNMENT_STATUSES.find((candidate) => candidate === text);
      if (!match) throw invalid('Unknown status.');
      wanted = match;
    }
    const items = await this.dispatch.listAssignments(meta, {
      zoneId: str(zoneId, 'zoneId'),
      from: instant(from, 'from'),
      to: instant(to, 'to'),
      status: wanted,
    });
    return { items: items.map(assignmentView) };
  }

  @Get('assignments/:id')
  async get(@Req() req: HeaderBag, @Param('id') id: string) {
    const meta = await this.actors.resolve(req);
    return operationsView(await this.dispatch.getAssignment(meta, id));
  }

  @Get('bookings/:bookingId/assignment')
  async byBooking(@Req() req: HeaderBag, @Param('bookingId') bookingId: string) {
    const meta = await this.actors.resolve(req);
    return operationsView(await this.dispatch.getAssignmentByBooking(meta, bookingId));
  }

  @Post('assignments/:id/offers')
  async offer(
    @Req() req: HeaderBag,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: StatusResponse,
  ) {
    const meta = await this.actors.resolve(req);
    const result = await this.dispatch.offer(meta, id, offerInput(body), idempotencyKey(req));
    res.status(result.replayed ? 200 : 201);
    return operationsView(result.value);
  }

  @Post('assignments/:id/reassign')
  @HttpCode(200)
  async reassign(@Req() req: HeaderBag, @Param('id') id: string, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    const result = await this.dispatch.reassign(meta, id, offerInput(body), idempotencyKey(req));
    return operationsView(result.value);
  }

  @Post('assignments/:id/unassign')
  @HttpCode(200)
  async unassign(@Req() req: HeaderBag, @Param('id') id: string, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    const input = objectBody(body, ['expectedRevision'], ['expectedRevision']);
    const result = await this.dispatch.unassign(
      meta,
      id,
      { expectedRevision: int(input.expectedRevision, 'expectedRevision') },
      idempotencyKey(req),
    );
    return operationsView(result.value);
  }

  @Get('me/offers')
  async myOffers(@Req() req: HeaderBag) {
    const meta = await this.actors.resolve(req);
    const items = await this.dispatch.listMyOffers(meta);
    return { items: items.map(({ offer, assignment }) => technicianView(offer, assignment)) };
  }

  @Post('offers/:id/accept')
  @HttpCode(200)
  async accept(@Req() req: HeaderBag, @Param('id') id: string, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    objectBody(body ?? {}, [], []);
    const { value } = await this.dispatch.acceptOffer(meta, id, idempotencyKey(req));
    return technicianOf(value);
  }

  @Post('offers/:id/decline')
  @HttpCode(200)
  async decline(@Req() req: HeaderBag, @Param('id') id: string, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    const input = objectBody(body, ['reason'], ['reason']);
    if (!isDeclineReason(input.reason)) throw invalid('Unknown decline reason.');
    const { value } = await this.dispatch.declineOffer(meta, id, input.reason, idempotencyKey(req));
    return technicianOf(value);
  }
}

function technicianOf(view: AssignmentView) {
  if (!view.offer) throw new Error('TECHNICIAN_RESULT_WITHOUT_OFFER');
  return technicianView(view.offer, view.assignment);
}
