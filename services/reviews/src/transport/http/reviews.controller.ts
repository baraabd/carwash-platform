import type { IncomingMessage } from 'node:http';
import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { closed } from '@carwash/contracts';
import { createLogger } from '@carwash/service-kit';
import { ReviewsService } from '../../application/reviews.service';
import type { IdentityAuthority, RequestContext } from '../../ports/reviews.ports';
import { credential, failure, requestIds, type HttpResponse } from './http-support';

export const REVIEWS_SERVICE = 'REVIEWS_SERVICE';
export const REVIEWS_IDENTITY = 'REVIEWS_IDENTITY';

@Controller('/internal/v1/reviews')
export class ReviewsController {
  private readonly logger = createLogger({
    service: 'reviews',
    base: { component: 'reviews-http' },
  });
  constructor(
    @Inject(REVIEWS_SERVICE) private readonly reviews: ReviewsService,
    @Inject(REVIEWS_IDENTITY) private readonly identity: IdentityAuthority,
  ) {}

  private async reply(
    request: IncomingMessage,
    response: HttpResponse,
    operation: 'submit' | 'read' | 'queue' | 'moderate',
    work: (
      context: RequestContext,
    ) => Promise<{ status: number; body: unknown; replayed?: boolean }>,
  ): Promise<void> {
    const ids = requestIds(request);
    response.setHeader('x-request-id', ids.requestId);
    response.setHeader('x-correlation-id', ids.correlationId);
    response.setHeader('cache-control', 'no-store');
    try {
      const token = credential(request);
      const actor = await this.identity.verify(token, ids.correlationId);
      const result = await work({
        actor,
        credential: token ?? '',
        correlationId: ids.correlationId,
      });
      if (result.replayed !== undefined)
        response.setHeader('idempotent-replayed', String(result.replayed));
      this.logger.info('reviews_request', {
        operation,
        status: result.status,
        correlationId: ids.correlationId,
      });
      response.status(result.status).json(result.body);
    } catch (error) {
      const result = failure(error, ids);
      this.logger.info('reviews_request', {
        operation,
        status: result.status,
        correlationId: ids.correlationId,
      });
      response.status(result.status).json(result.body);
    }
  }

  @Post('reviews')
  submit(
    @Req() request: IncomingMessage,
    @Body() body: unknown,
    @Query() query: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    return this.reply(request, response, 'submit', async (context) => {
      closed(query, 'query', []);
      const result = await this.reviews.submit(context, request.headers['idempotency-key'], body);
      return { status: 201, body: result.view, replayed: result.replayed };
    });
  }

  @Get('bookings/:bookingId/review')
  get(
    @Req() request: IncomingMessage,
    @Param('bookingId') bookingId: string,
    @Query() query: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    return this.reply(request, response, 'read', async (context) => {
      closed(query, 'query', []);
      return { status: 200, body: await this.reviews.getBooking(context, bookingId) };
    });
  }

  @Get('moderation/reviews')
  queue(
    @Req() request: IncomingMessage,
    @Query() query: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    return this.reply(request, response, 'queue', async (context) => ({
      status: 200,
      body: await this.reviews.queue(context, query),
    }));
  }

  @Post('moderation/reviews/:reviewId/decision')
  decide(
    @Req() request: IncomingMessage,
    @Param('reviewId') reviewId: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    return this.reply(request, response, 'moderate', async (context) => {
      closed(query, 'query', []);
      const result = await this.reviews.decide(
        context,
        reviewId,
        request.headers['idempotency-key'],
        body,
      );
      return { status: 200, body: result.view, replayed: result.replayed };
    });
  }
}
