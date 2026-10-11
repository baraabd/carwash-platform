import { Body, Controller, HttpCode, Inject, Param, Post, Req, UseFilters } from '@nestjs/common';
import { BookingChangeService } from '../../application';
import { ActorResolver, type HeaderBag } from './actor-resolver';
import { DISPATCH_V1 } from './dispatch.controller';
import { DispatchHttpFilter } from './http-errors';
import { idempotencyKey, instant, objectBody, str } from './http-input';

function changeOnly(body: unknown): { readonly changeId: string } {
  const input = objectBody(body, ['changeId'], ['changeId']);
  return { changeId: str(input.changeId, 'changeId') };
}

/**
 * Booking's changes to a booking's job (REQUESTED, P04-C-interfaces §C2).
 * Service scope `dispatch.booking.change` only; every command needs an
 * Idempotency-Key and is replay-safe by Booking's change id.
 */
@Controller(DISPATCH_V1)
@UseFilters(DispatchHttpFilter)
export class BookingChangeController {
  constructor(
    @Inject(BookingChangeService) private readonly changes: BookingChangeService,
    @Inject(ActorResolver) private readonly actors: ActorResolver,
  ) {}

  @Post('bookings/:bookingId/cancellation')
  @HttpCode(200)
  async cancel(
    @Req() req: HeaderBag,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ) {
    const meta = await this.actors.resolve(req);
    return this.changes.cancel(meta, bookingId, changeOnly(body), idempotencyKey(req));
  }

  @Post('bookings/:bookingId/rebinding')
  @HttpCode(200)
  async rebind(
    @Req() req: HeaderBag,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ) {
    const meta = await this.actors.resolve(req);
    const keys = ['changeId', 'holdId', 'zoneId', 'startsAt', 'endsAt'];
    const input = objectBody(body, keys, keys);
    return this.changes.rebind(
      meta,
      bookingId,
      {
        changeId: str(input.changeId, 'changeId'),
        holdId: str(input.holdId, 'holdId'),
        zoneId: str(input.zoneId, 'zoneId'),
        startsAt: instant(input.startsAt, 'startsAt'),
        endsAt: instant(input.endsAt, 'endsAt'),
      },
      idempotencyKey(req),
    );
  }

  @Post('bookings/:bookingId/rebinding/confirm')
  @HttpCode(200)
  async confirm(
    @Req() req: HeaderBag,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ) {
    const meta = await this.actors.resolve(req);
    return this.changes.confirm(meta, bookingId, changeOnly(body), idempotencyKey(req));
  }

  @Post('bookings/:bookingId/rebinding/revert')
  @HttpCode(200)
  async revert(
    @Req() req: HeaderBag,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ) {
    const meta = await this.actors.resolve(req);
    return this.changes.revert(meta, bookingId, changeOnly(body), idempotencyKey(req));
  }
}
