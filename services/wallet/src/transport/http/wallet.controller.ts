import { Controller, Get, Headers, Inject, Param, UseFilters } from '@nestjs/common';
import {
  AppError,
  AppExceptionFilter,
  CORRELATION_HEADER,
  createLogger,
  resolveCorrelationId,
} from '@carwash/service-kit';
import {
  CustodyQueryService,
  WalletApplicationError,
  type RequestContext,
} from '../../application';

export const WALLET_V1 = 'internal/v1/wallet';
export const CUSTODY_QUERY_SERVICE = 'CUSTODY_QUERY_SERVICE';

/** Fixed public messages. Internal exception text is never reflected. */
const MESSAGES: Readonly<Record<string, string>> = {
  REQUEST_INVALID: 'The request is invalid.',
  AUTH_REQUIRED: 'Authentication is required.',
  AUTH_FORBIDDEN: 'The operation is not allowed.',
  AUTH_UNAVAILABLE: 'Authorization is temporarily unavailable.',
};

type RequestHeaders = Record<string, string | undefined>;

function contextOf(headers: RequestHeaders): RequestContext {
  return {
    credential: headers.authorization,
    correlationId: resolveCorrelationId(headers[CORRELATION_HEADER]),
  };
}

async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    if (error instanceof WalletApplicationError)
      throw new AppError({
        status: error.status,
        code: error.code,
        message: MESSAGES[error.code] ?? 'The request could not be completed.',
      });
    throw error;
  }
}

/**
 * Wallet owner API: technician custody READ projection. Transport only; every
 * rule lives in CustodyQueryService. There is no write route: Wallet never
 * moves money.
 */
@Controller(WALLET_V1)
@UseFilters(new AppExceptionFilter(createLogger({ service: 'wallet' })))
export class WalletController {
  constructor(@Inject(CUSTODY_QUERY_SERVICE) private readonly custody: CustodyQueryService) {}

  // Declared before `custody/holders/:subject` so "me" is never read as a subject.
  @Get('custody/holders/me')
  mine(@Headers() headers: RequestHeaders) {
    return run(() => this.custody.myCustody(contextOf(headers)));
  }

  @Get('custody/holders/:subject')
  holder(@Headers() headers: RequestHeaders, @Param('subject') subject: string) {
    return run(() => this.custody.holderCustody(contextOf(headers), subject));
  }
}
