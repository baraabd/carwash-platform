import { Body, Controller, Headers, Inject, Param, Post, Res, UseFilters } from '@nestjs/common';
import {
  AppExceptionFilter,
  CORRELATION_HEADER,
  SERVICE_CLIENT_HEADER,
  SERVICE_TOKEN_HEADER,
  createLogger,
  resolveCorrelationId,
} from '@carwash/service-kit';
import {
  BookingObligationService,
  type CommandResult,
  type ServiceRequestContext,
} from '../../application';
import { BILLING_V1, run, type HttpResponse, type RequestHeaders } from './http-support';

export const BOOKING_OBLIGATION_SERVICE = 'BOOKING_OBLIGATION_SERVICE';

/** The workload credential only; a person's bearer token is never accepted here. */
function workloadContext(headers: RequestHeaders): ServiceRequestContext {
  return {
    clientId: headers[SERVICE_CLIENT_HEADER],
    token: headers[SERVICE_TOKEN_HEADER],
    bearerPresent: headers.authorization !== undefined,
    correlationId: resolveCorrelationId(headers[CORRELATION_HEADER]),
  };
}

/**
 * billing.v1 booking-saga routes (access service:billing.obligation.write).
 * Extracts the workload credential, correlation and key, renders results and
 * maps application failures to fixed public errors. No business logic here.
 * Logs carry the workload id, status and replay flag only: never amounts,
 * subjects, quotes or tokens.
 */
@Controller(BILLING_V1)
@UseFilters(new AppExceptionFilter(createLogger({ service: 'billing' })))
export class BookingObligationController {
  private readonly logger = createLogger({
    service: 'billing',
    base: { component: 'billing-booking-saga-http' },
  });

  constructor(
    @Inject(BOOKING_OBLIGATION_SERVICE) private readonly bookings: BookingObligationService,
  ) {}

  private async send(
    event: string,
    headers: RequestHeaders,
    response: HttpResponse,
    work: (context: ServiceRequestContext, key: string | undefined) => Promise<CommandResult>,
  ): Promise<void> {
    const context = workloadContext(headers);
    const result = await run(() => work(context, headers['idempotency-key']));
    this.logger.info(event, {
      correlationId: context.correlationId,
      status: result.status,
      replayed: result.replayed,
    });
    response.setHeader(CORRELATION_HEADER, context.correlationId);
    response.setHeader('idempotency-replayed', String(result.replayed));
    response.status(result.status).json(result.body);
  }

  @Post('booking-obligations')
  async create(
    @Headers() headers: RequestHeaders,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await this.send('billing_booking_obligation_create', headers, response, (context, key) =>
      this.bookings.createForBooking(context, key, body),
    );
  }

  @Post('booking-obligations/:id/void')
  async void(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await this.send('billing_booking_obligation_void', headers, response, (context, key) =>
      this.bookings.voidForBooking(context, id, key, body),
    );
  }
}
