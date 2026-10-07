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
import { SchedulingService } from '../../application';
import { invalid, isReleaseReason, type CapacityWindowState, type HoldState } from '../../domain';
import { ActorResolver, type HeaderBag } from './actor-resolver';
import { SchedulingHttpFilter } from './http-errors';

export const SCHEDULING_V1 = '/internal/v1/scheduling';

interface StatusResponse {
  status(code: number): StatusResponse;
}

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

/** Client id, fingerprint and idempotency key are internal and never returned. */
export function holdView(hold: HoldState) {
  return {
    holdId: hold.id,
    windowId: hold.windowId,
    holderRef: hold.holderRef,
    units: hold.units,
    status: hold.status,
    expiresAt: hold.expiresAt.toISOString(),
    releaseReason: hold.releaseReason,
    version: hold.version,
  };
}

@Controller(SCHEDULING_V1)
@UseFilters(SchedulingHttpFilter)
export class SchedulingController {
  constructor(
    @Inject(SchedulingService) private readonly scheduling: SchedulingService,
    @Inject(ActorResolver) private readonly actors: ActorResolver,
  ) {}

  @Post('windows')
  async defineWindow(
    @Req() req: HeaderBag,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: StatusResponse,
  ) {
    const meta = await this.actors.resolve(req);
    const input = objectBody(
      body,
      ['zoneId', 'startsAt', 'endsAt', 'capacity'],
      ['zoneId', 'startsAt', 'endsAt', 'capacity'],
    );
    const result = await this.scheduling.defineWindow(meta, {
      zoneId: str(input.zoneId, 'zoneId'),
      startsAt: instant(input.startsAt, 'startsAt'),
      endsAt: instant(input.endsAt, 'endsAt'),
      capacity: int(input.capacity, 'capacity'),
    });
    res.status(result.replayed ? 200 : 201);
    return windowView(result.value);
  }

  @Patch('windows/:id/capacity')
  async changeCapacity(@Req() req: HeaderBag, @Param('id') id: string, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    const input = objectBody(
      body,
      ['capacity', 'expectedVersion'],
      ['capacity', 'expectedVersion'],
    );
    return windowView(
      await this.scheduling.changeCapacity(meta, id, {
        capacity: int(input.capacity, 'capacity'),
        expectedVersion: int(input.expectedVersion, 'expectedVersion'),
      }),
    );
  }

  @Post('windows/:id/close')
  @HttpCode(200)
  async closeWindow(@Req() req: HeaderBag, @Param('id') id: string, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    const input = objectBody(body, ['expectedVersion'], ['expectedVersion']);
    return windowView(
      await this.scheduling.closeWindow(meta, id, int(input.expectedVersion, 'expectedVersion')),
    );
  }

  @Get('availability')
  async availability(
    @Req() req: HeaderBag,
    @Query('zoneId') zoneId: unknown,
    @Query('from') from: unknown,
    @Query('to') to: unknown,
  ) {
    const meta = await this.actors.resolve(req);
    const slots = await this.scheduling.availability(meta, {
      zoneId: str(zoneId, 'zoneId'),
      from: instant(from, 'from'),
      to: instant(to, 'to'),
    });
    return { slots };
  }

  @Post('holds')
  async acquireHold(
    @Req() req: HeaderBag,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: StatusResponse,
  ) {
    const meta = await this.actors.resolve(req);
    const input = objectBody(
      body,
      ['windowId', 'holderRef', 'units', 'ttlSeconds'],
      ['windowId', 'holderRef', 'units'],
    );
    const key = req.headers['idempotency-key'];
    const result = await this.scheduling.acquireHold(meta, {
      windowId: str(input.windowId, 'windowId'),
      holderRef: str(input.holderRef, 'holderRef'),
      units: int(input.units, 'units'),
      ...(input.ttlSeconds === undefined
        ? {}
        : { ttlSeconds: int(input.ttlSeconds, 'ttlSeconds') }),
      idempotencyKey: typeof key === 'string' ? key : '',
    });
    res.status(result.replayed ? 200 : 201);
    return holdView(result.value);
  }

  @Get('holds/:id')
  async getHold(@Req() req: HeaderBag, @Param('id') id: string) {
    const meta = await this.actors.resolve(req);
    return holdView(await this.scheduling.getHold(meta, id));
  }

  @Post('holds/:id/confirm')
  @HttpCode(200)
  async confirmHold(@Req() req: HeaderBag, @Param('id') id: string, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    objectBody(body ?? {}, [], []);
    return holdView((await this.scheduling.confirmHold(meta, id)).value);
  }

  @Post('holds/:id/release')
  @HttpCode(200)
  async releaseHold(@Req() req: HeaderBag, @Param('id') id: string, @Body() body: unknown) {
    const meta = await this.actors.resolve(req);
    const input = objectBody(body, ['reason'], ['reason']);
    if (!isReleaseReason(input.reason)) throw invalid('Unknown release reason.');
    return holdView(await this.scheduling.releaseHold(meta, id, input.reason));
  }
}
