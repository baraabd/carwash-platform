import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseFilters } from '@nestjs/common';
import { BookingService } from '../../application';
import { BookingError, isUuid } from '../../domain';
import { ActorResolver, type HeaderBag } from './actor-resolver';
import { bookingView } from './booking-view';
import { BookingHttpFilter } from './http-errors';

export const BOOKING_V1 = '/internal/v1/booking';

interface StatusResponse {
  status(code: number): StatusResponse;
}

/**
 * HTTP edge of the booking service (REQUESTED booking.v1). It only resolves
 * the caller and reads headers; parsing, authorization and all rules live in
 * the application layer.
 */
@Controller(BOOKING_V1)
@UseFilters(BookingHttpFilter)
export class BookingController {
  constructor(
    @Inject(BookingService) private readonly bookings: BookingService,
    @Inject(ActorResolver) private readonly actors: ActorResolver,
  ) {}

  @Post('bookings')
  async create(
    @Req() req: HeaderBag,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: StatusResponse,
  ) {
    const meta = await this.actors.resolve(req);
    const key = req.headers['idempotency-key'];
    const result = await this.bookings.create(meta, Array.isArray(key) ? undefined : key, body);
    res.status(result.replayed ? 200 : 201);
    return bookingView(result.view.booking, result.view.saga);
  }

  @Get('bookings/:bookingId')
  async get(@Req() req: HeaderBag, @Param('bookingId') bookingId: string) {
    const meta = await this.actors.resolve(req);
    if (!isUuid(bookingId)) throw new BookingError('BOOKING_NOT_FOUND', 'Booking not found.');
    const view = await this.bookings.get(meta, bookingId.toLowerCase());
    return bookingView(view.booking, view.saga);
  }
}
