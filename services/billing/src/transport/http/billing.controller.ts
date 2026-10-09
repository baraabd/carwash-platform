import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Res,
  UseFilters,
} from '@nestjs/common';
import {
  AppError,
  AppExceptionFilter,
  CORRELATION_HEADER,
  createLogger,
  resolveCorrelationId,
} from '@carwash/service-kit';
import {
  BillingApplicationError,
  BillingService,
  type CommandResult,
  type RequestContext,
} from '../../application';

export const BILLING_SERVICE = 'BILLING_SERVICE';
export const BILLING_V1 = 'internal/v1/billing';

/** Fixed public messages. Internal exception text is never reflected. */
const MESSAGES: Readonly<Record<string, string>> = {
  REQUEST_INVALID: 'The request is invalid.',
  IDEMPOTENCY_KEY_INVALID: 'A valid Idempotency-Key header is required.',
  AUTH_REQUIRED: 'Authentication is required.',
  AUTH_FORBIDDEN: 'The operation is not allowed.',
  AUTH_UNAVAILABLE: 'Authorization is temporarily unavailable.',
  NOT_FOUND: 'The requested resource was not found.',
  IDEMPOTENCY_CONFLICT: 'The Idempotency-Key was already used for a different request.',
  OBLIGATION_ALREADY_EXISTS: 'This quote already has a financial obligation.',
  QUOTE_NOT_USABLE: 'The quote is no longer usable; request a new quote.',
  AMOUNT_INVALID: 'The amount is not billable.',
  CURRENCY_UNSUPPORTED: 'The currency or scale is not supported.',
  PROVIDER_REFERENCE_TAKEN: 'This transaction reference was already reported.',
  REVISION_CONFLICT: 'The obligation changed; refetch it and retry with a new command.',
  UPSTREAM_UNAVAILABLE: 'A required upstream service is unavailable.',
  OBLIGATION_SETTLED: 'The obligation is already paid.',
  OBLIGATION_VOIDED: 'The obligation was voided.',
  VOID_NOT_ALLOWED: 'A payment was already reported; the obligation cannot be voided.',
  METHOD_UNCHANGED: 'This payment method is already selected.',
  PAYMENT_IN_REVIEW: 'A payment is under review; the method cannot change.',
  NO_ACTIVE_INTENT: 'Choose a payment method first.',
  INTENT_NOT_ACCEPTING_ATTEMPTS: 'The selected method does not accept a transaction reference now.',
  ATTEMPT_NOT_OPEN: 'The payment attempt is already reconciled.',
  ALREADY_UNKNOWN: 'The payment attempt is already marked unknown.',
  ATTEMPT_LIMIT_REACHED: 'Too many transaction references were reported for this obligation.',
  AMOUNT_NOT_EQUAL_OUTSTANDING: 'The observed amount does not equal the outstanding amount.',
  OBSERVED_AMOUNT_REQUIRED: 'A matched payment requires the observed amount.',
  OBSERVED_AMOUNT_NOT_ALLOWED: 'An unknown outcome must not carry an observed amount.',
};

interface HttpResponse {
  status(code: number): HttpResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): unknown;
}

type RequestHeaders = Record<string, string | undefined>;

/**
 * Billing owner API. Extracts credential/correlation/key, renders results and
 * maps application failures to fixed public errors. No business logic here.
 * Logs carry status codes only: never amounts, references or subjects.
 */
@Controller(BILLING_V1)
@UseFilters(new AppExceptionFilter(createLogger({ service: 'billing' })))
export class BillingController {
  private readonly logger = createLogger({
    service: 'billing',
    base: { component: 'billing-http' },
  });

  constructor(@Inject(BILLING_SERVICE) private readonly billing: BillingService) {}

  private context(headers: RequestHeaders): RequestContext {
    return {
      credential: headers.authorization,
      correlationId: resolveCorrelationId(headers[CORRELATION_HEADER]),
    };
  }

  private async run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error: unknown) {
      if (error instanceof BillingApplicationError)
        throw new AppError({
          status: error.status,
          code: error.code,
          message: MESSAGES[error.code] ?? 'The request could not be completed.',
          ...(error.details ? { details: error.details } : {}),
        });
      throw error;
    }
  }

  private async command(
    event: string,
    headers: RequestHeaders,
    response: HttpResponse,
    work: (context: RequestContext, key: string | undefined) => Promise<CommandResult>,
  ): Promise<void> {
    const context = this.context(headers);
    const result = await this.run(() => work(context, headers['idempotency-key']));
    this.logger.info(event, {
      correlationId: context.correlationId,
      status: result.status,
      replayed: result.replayed,
    });
    response.setHeader(CORRELATION_HEADER, context.correlationId);
    response.setHeader('idempotency-replayed', String(result.replayed));
    response.status(result.status).json(result.body);
  }

  @Post('obligations')
  async create(
    @Headers() headers: RequestHeaders,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await this.command('billing_obligation_create', headers, response, (context, key) =>
      this.billing.createObligation(context, key, body),
    );
  }

  @Get('obligations/:id')
  obligation(@Headers() headers: RequestHeaders, @Param('id') id: string) {
    return this.run(() => this.billing.getObligation(this.context(headers), id));
  }

  @Get('obligations/:id/financial-status')
  status(@Headers() headers: RequestHeaders, @Param('id') id: string) {
    return this.run(() => this.billing.getFinancialStatus(this.context(headers), id));
  }

  @Post('obligations/:id/payment-intents')
  async initialize(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await this.command('billing_intent_initialize', headers, response, (context, key) =>
      this.billing.initializePayment(context, id, key, body),
    );
  }

  @Post('obligations/:id/payment-attempts')
  async submit(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await this.command('billing_attempt_submit', headers, response, (context, key) =>
      this.billing.submitAttempt(context, id, key, body),
    );
  }

  @Post('obligations/:id/void')
  async void(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await this.command('billing_obligation_void', headers, response, (context, key) =>
      this.billing.voidObligation(context, id, key, body),
    );
  }

  @Post('payment-attempts/:id/reconciliation')
  async reconcile(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: HttpResponse,
  ): Promise<void> {
    await this.command('billing_attempt_reconcile', headers, response, (context, key) =>
      this.billing.reconcileAttempt(context, id, key, body),
    );
  }
}
