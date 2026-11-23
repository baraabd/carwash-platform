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
import { invalid, isDeclineReason, noteText, type AssignmentStatus } from '../../domain';
import { ActorResolver, type HeaderBag } from './actor-resolver';
import { DispatchHttpFilter } from './http-errors';
import { idempotencyKey, instant, int, objectBody, str } from './http-input';
import { assignmentView, operationsView, technicianView } from './views';

export { operationsView, technicianView } from './views';

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
    return { items: items.map(({ offer, assignment }) => technicianView(offer, assignment, null)) };
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
    const input = objectBody(body, ['reason', 'note'], ['reason']);
    if (!isDeclineReason(input.reason)) throw invalid('Unknown decline reason.');
    const note = input.note === undefined ? null : noteText(input.note, 'note');
    const { value } = await this.dispatch.declineOffer(
      meta,
      id,
      input.reason,
      note,
      idempotencyKey(req),
    );
    return technicianOf(value);
  }
}

function technicianOf(view: AssignmentView) {
  if (!view.offer) throw new Error('TECHNICIAN_RESULT_WITHOUT_OFFER');
  return technicianView(view.offer, view.assignment, view.task?.id ?? null);
}
