import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseFilters } from '@nestjs/common';
import { BookingService, ChangeService, TechnicianViewQuery } from '../../application';
import { BookingError, isUuid } from '../../domain';
import { ActorResolver, type HeaderBag } from './actor-resolver';
import { bookingView } from './booking-view';
import { changeView } from './change-view';
import { BookingHttpFilter } from './http-errors';
import { technicianBookingView } from './technician-view';

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
    @Inject(TechnicianViewQuery) private readonly technician: TechnicianViewQuery,
    @Inject(ChangeService) private readonly changes: ChangeService,
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
    return bookingView(view.booking, view.saga, await this.changes.openChange(view.booking.id));
  }

  /** P04-C3: cancel a confirmed booking (customer: own booking; staff: any). */
  @Post('bookings/:bookingId/cancellation')
  async cancel(
    @Req() req: HeaderBag,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: StatusResponse,
  ) {
    const meta = await this.actors.resolve(req);
    const key = req.headers['idempotency-key'];
    const result = await this.changes.cancel(
      meta,
      bookingId,
      Array.isArray(key) ? undefined : key,
      body,
    );
    res.status(result.replayed ? 200 : 202);
    return changeView(result.change);
  }

  /** P04-C3: move a confirmed booking to a slot the customer holds. */
  @Post('bookings/:bookingId/reschedule')
  async reschedule(
    @Req() req: HeaderBag,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: StatusResponse,
  ) {
    const meta = await this.actors.resolve(req);
    const key = req.headers['idempotency-key'];
    const result = await this.changes.reschedule(
      meta,
      bookingId,
      Array.isArray(key) ? undefined : key,
      body,
    );
    res.status(result.replayed ? 200 : 202);
    return changeView(result.change);
  }

  /** P04-C3: the booking's change history, newest first. */
  @Get('bookings/:bookingId/changes')
  async changeHistory(@Req() req: HeaderBag, @Param('bookingId') bookingId: string) {
    const meta = await this.actors.resolve(req);
    return { items: (await this.changes.list(meta, bookingId)).map(changeView) };
  }

  /** Assigned technician's purpose-limited view; Dispatch authorizes every call (P03-C3). */
  @Get('bookings/:bookingId/technician-view')
  async technicianView(@Req() req: HeaderBag, @Param('bookingId') bookingId: string) {
    const meta = await this.actors.resolve(req);
    return technicianBookingView(await this.technician.read(meta, bookingId));
  }
}
