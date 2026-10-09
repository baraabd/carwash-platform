import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import { CapacityService, HoldsV1Service, holdView } from '../../application';
import type { CapacityWindowState } from '../../domain';
import type { StoredResponse } from '../../ports';
import { ActorResolver, type HeaderBag } from './actor-resolver';
import { RequestInvalid, SchedulingHttpFilter } from './http-errors';
import {
  closed,
  commitRequest,
  holdRequest,
  integer,
  localDate,
  queryInteger,
  releaseRequest,
  utc,
  uuid,
} from './wire';

export const SCHEDULING_V1 = '/internal/v1/scheduling';

interface StatusResponse {
  status(code: number): StatusResponse;
}

/** Owner-only staff surface (not part of scheduling.v1); kept for operations. */
export function windowView(window: CapacityWindowState) {
  return {
    windowId: window.id,
    zoneId: window.zoneId,
    startsAt: window.startsAt.toISOString(),
    endsAt: window.endsAt.toISOString(),
    capacity: window.capacity,
    held: window.held,
    reserved: window.reserved,
    status: window.status,
    version: window.version,
  };
}

function key(req: HeaderBag): string | undefined {
  const value = req.headers['idempotency-key'];
  if (Array.isArray(value)) throw new RequestInvalid('header.idempotency-key');
  return value;
}

function send(res: StatusResponse, stored: StoredResponse): unknown {
  res.status(stored.status);
  return stored.body;
}

@Controller(SCHEDULING_V1)
@UseFilters(SchedulingHttpFilter)
export class SchedulingController {
  constructor(
    @Inject(HoldsV1Service) private readonly holds: HoldsV1Service,
    @Inject(CapacityService) private readonly capacity: CapacityService,
    @Inject(ActorResolver) private readonly actors: ActorResolver,
  ) {}

  // ------------------------------------------------- scheduling.v1 (public)

  @Get('availability')
  async availability(
    @Req() req: HeaderBag,
    @Query() query: Record<string, unknown>,
  ): Promise<unknown> {
    this.actors.takePublic(req);
    const q = closed(query, 'query', ['zoneId', 'date', 'durationMinutes']);
    return this.holds.availability({
      zoneId: uuid(q.zoneId, 'query.zoneId'),
      date: localDate(q.date, 'query.date'),
      durationMinutes: queryInteger(q.durationMinutes, 'query.durationMinutes', 5, 480),
    });
  }

  @Get('availability/earliest')
  async earliest(@Req() req: HeaderBag, @Query() query: Record<string, unknown>): Promise<unknown> {
    this.actors.takePublic(req);
    const q = closed(query, 'query', ['zoneId', 'durationMinutes']);
    return this.holds.earliest({
      zoneId: uuid(q.zoneId, 'query.zoneId'),
      durationMinutes: queryInteger(q.durationMinutes, 'query.durationMinutes', 5, 480),
    });
  }

  // ---------------------------------------------- scheduling.v1 (holds)

  @Post('holds')
  async createHold(
    @Req() req: HeaderBag,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: StatusResponse,
  ): Promise<unknown> {
    const meta = await this.actors.resolve(req);
    return send(res, await this.holds.createHold(meta, holdRequest(body), key(req)));
  }

  @Get('holds/:holdId')
  async getHold(@Req() req: HeaderBag, @Param('holdId') holdId: string): Promise<unknown> {
    const meta = await this.actors.resolve(req);
    return this.holds.getHold(meta, uuid(holdId, 'path.holdId'));
  }

  @Post('holds/:holdId/commit')
  async commitHold(
    @Req() req: HeaderBag,
    @Param('holdId') holdId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: StatusResponse,
  ): Promise<unknown> {
    const meta = await this.actors.resolve(req);
    return send(
      res,
      await this.holds.commitHold(meta, uuid(holdId, 'path.holdId'), commitRequest(body), key(req)),
    );
  }

  @Post('holds/:holdId/release')
  async releaseHold(
    @Req() req: HeaderBag,
    @Param('holdId') holdId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: StatusResponse,
  ): Promise<unknown> {
    const meta = await this.actors.resolve(req);
    return send(
      res,
      await this.holds.releaseHold(
        meta,
        uuid(holdId, 'path.holdId'),
        releaseRequest(body),
        key(req),
      ),
    );
  }

  // ------------------------------------------- owner staff surface (ops)

  @Post('windows')
  async defineWindow(
    @Req() req: HeaderBag,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: StatusResponse,
  ): Promise<unknown> {
    const meta = await this.actors.resolve(req);
    const input = closed(body, '$', ['zoneId', 'startsAt', 'endsAt', 'capacity']);
    const result = await this.capacity.defineWindow(meta, {
      zoneId: uuid(input.zoneId, '$.zoneId'),
      startsAt: utc(input.startsAt, '$.startsAt'),
      endsAt: utc(input.endsAt, '$.endsAt'),
      capacity: integer(input.capacity, '$.capacity', 0, 500),
    });
    res.status(result.replayed ? 200 : 201);
    return windowView(result.value);
  }

  @Patch('windows/:id/capacity')
  async changeCapacity(
    @Req() req: HeaderBag,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const meta = await this.actors.resolve(req);
    const input = closed(body, '$', ['capacity', 'expectedVersion']);
    return windowView(
      await this.capacity.changeCapacity(meta, uuid(id, 'path.id'), {
        capacity: integer(input.capacity, '$.capacity', 0, 500),
        expectedVersion: integer(input.expectedVersion, '$.expectedVersion', 1, 2_147_483_647),
      }),
    );
  }

  @Post('windows/:id/close')
  @HttpCode(200)
  async closeWindow(
    @Req() req: HeaderBag,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const meta = await this.actors.resolve(req);
    const input = closed(body, '$', ['expectedVersion']);
    return windowView(
      await this.capacity.closeWindow(
        meta,
        uuid(id, 'path.id'),
        integer(input.expectedVersion, '$.expectedVersion', 1, 2_147_483_647),
      ),
    );
  }

  /** Staff override of a held or committed hold (audited). */
  @Post('holds/:holdId/override-release')
  @HttpCode(200)
  async overrideRelease(
    @Req() req: HeaderBag,
    @Param('holdId') holdId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const meta = await this.actors.resolve(req);
    closed(body ?? {}, '$', []);
    return holdView(await this.capacity.overrideRelease(meta, uuid(holdId, 'path.holdId')));
  }
}
