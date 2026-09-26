import { Catch, type ArgumentsHost, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { AuthErrorCode, AuthErrorEnvelope } from '@carwash/contracts';
import { randomUUID } from 'node:crypto';
import { AuthFault } from '../../domain/auth-policy';
import type { AuthRequest, AuthResponse } from './auth-runtime';

const STATUS: Readonly<Record<AuthErrorCode, number>> = {
  AUTH_INVALID: 401,
  AUTH_CHALLENGE_INVALID: 401,
  AUTH_REQUIRED: 401,
  AUTH_FORBIDDEN: 403,
  AUTH_CSRF: 403,
  AUTH_RATE_LIMITED: 429,
  AUTH_UNAVAILABLE: 503,
  AUTH_INVALID_REQUEST: 400,
};
@Catch()
export class IdentityAuthFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<AuthRequest>();
    const response = http.getResponse<AuthResponse>();
    const code =
      error instanceof AuthFault
        ? error.code
        : error instanceof HttpException && error.getStatus() < 500
          ? 'AUTH_INVALID_REQUEST'
          : 'AUTH_UNAVAILABLE';
    const body: AuthErrorEnvelope = {
      error: {
        code,
        message:
          code === 'AUTH_UNAVAILABLE'
            ? 'Authentication is temporarily unavailable.'
            : 'The authentication request could not be completed.',
        requestId: request.authRequestId ?? randomUUID(),
      },
    };
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    if (code === 'AUTH_RATE_LIMITED') response.setHeader('retry-after', '60');
    // Never log the thrown exception: driver/provider errors can contain credentials or identifiers.
    response.status(STATUS[code]).json(body);
  }
}
