import { Controller, Get, Headers, Inject, Param, UseFilters } from '@nestjs/common';
import {
  AppError,
  AppExceptionFilter,
  CORRELATION_HEADER,
  createLogger,
  resolveCorrelationId,
} from '@carwash/service-kit';
import {
  CustodyQueries,
  WALLET_MESSAGES,
  WalletApplicationError,
  type RequestContext,
} from '../../application';

export const CUSTODY_QUERIES = 'CUSTODY_QUERIES';
export const WALLET_V1 = 'internal/v1/wallet';

type Headers_ = Record<string, string | undefined>;

/**
 * Wallet owner API: read-only technician custody (B-08). There is deliberately
 * no customer wallet, top-up, transfer or withdrawal route. No business logic here.
 */
@Controller(WALLET_V1)
@UseFilters(new AppExceptionFilter(createLogger({ service: 'wallet' })))
export class WalletController {
  constructor(@Inject(CUSTODY_QUERIES) private readonly queries: CustodyQueries) {}

  private context(headers: Headers_): RequestContext {
    return {
      credential: headers.authorization,
      correlationId: resolveCorrelationId(headers[CORRELATION_HEADER]),
    };
  }

  private async run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error: unknown) {
      if (error instanceof WalletApplicationError)
        throw new AppError({
          status: error.status,
          code: error.code,
          message: WALLET_MESSAGES[error.code],
        });
      throw error;
    }
  }

  @Get('custody/me')
  mine(@Headers() headers: Headers_) {
    return this.run(() => this.queries.myCustody(this.context(headers)));
  }

  @Get('custody/me/movements')
  myMovements(@Headers() headers: Headers_) {
    return this.run(() => this.queries.myMovements(this.context(headers)));
  }

  @Get('custody/holders/:holder')
  holder(@Headers() headers: Headers_, @Param('holder') holder: string) {
    return this.run(() => this.queries.staffCustody(this.context(headers), holder));
  }

  @Get('custody/holders/:holder/movements')
  holderMovements(@Headers() headers: Headers_, @Param('holder') holder: string) {
    return this.run(() => this.queries.staffMovements(this.context(headers), holder));
  }
}
