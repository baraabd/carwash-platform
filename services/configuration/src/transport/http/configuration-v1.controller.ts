import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { AppError, resolveCorrelationId } from '@carwash/service-kit';
import {
  CONFIGURATION_PERMISSIONS,
  requirePermission,
  type ConfigurationPermission,
} from '../../application/access';
import {
  ConfigurationV1Commands,
  ConfigurationV1Queries,
  type RequestMeta,
} from '../../application/configuration-v1.service';
import {
  ConfigurationContractViolation,
  ConfigurationV1RuleError,
  type ConfigurationV1RuleCode,
} from '../../domain/configuration-v1';
import type { CommandResult, ServiceCallerAuthenticator } from '../../ports/configuration-v1.ports';
import { AccessFault, type SessionAuthority } from '../../ports/identity.ports';
import { SESSION_AUTHORITY } from './configuration.controller';
import type { ConfigurationRateLimits } from './rate-limit';

export const SERVICE_CALLERS = 'CONFIGURATION_SERVICE_CALLERS';
export const RATE_LIMITS = 'CONFIGURATION_RATE_LIMITS';

type RequestHeaders = Record<string, string | undefined>;

interface HttpResponse {
  status(code: number): HttpResponse;
  setHeader(name: string, value: string): void;
}

const ACCESS_STATUS = { AUTH_REQUIRED: 401, AUTH_FORBIDDEN: 403, AUTH_UNAVAILABLE: 503 } as const;

/**
 * Status per owner rule. Business rejections use 409/412/422 so the Gateway
 * forwards the published configuration.v1 reasons (SELF_APPROVAL_FORBIDDEN,
 * DRAFT_NOT_APPROVED); POLICY_UNAVAILABLE is a 404 on the service-only read.
 */
const RULE_STATUS: Readonly<Record<ConfigurationV1RuleCode, number>> = {
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_INVALID: 400,
  SECRET_NOT_CONFIGURATION: 422,
  VERSION_CONFLICT: 412,
  REVISION_CONFLICT: 412,
  DRAFT_ALREADY_OPEN: 409,
  DRAFT_CLOSED: 409,
  DRAFT_ALREADY_APPROVED: 409,
  DRAFT_BASE_STALE: 409,
  SELF_APPROVAL_FORBIDDEN: 422,
  DRAFT_NOT_APPROVED: 409,
  POLICY_UNAVAILABLE: 404,
};

function fail(status: number, code: string, message = code): never {
  throw new AppError({ status, code, message });
}

/** Domain, wire and access failures become stable public error codes at the edge. */
function translate(error: unknown): never {
  if (error instanceof AccessFault) fail(ACCESS_STATUS[error.code], error.code);
  if (error instanceof ConfigurationV1RuleError) fail(RULE_STATUS[error.code], error.code);
  // The path is a field pointer such as $.content.holdTtlSeconds: never a value.
  if (error instanceof ConfigurationContractViolation)
    fail(422, 'VALIDATION_FAILED', `${error.code} at ${error.path}`);
  throw error;
}

/**
 * configuration.v1 (owner routes, prefix /internal/v1/configuration).
 *
 * Contract routes:
 *   GET  /scopes/:marketId/:namespace/current   service:configuration.read
 *   POST /scopes/:marketId/:namespace/drafts    configuration.write   (Idempotency-Key)
 *   POST /drafts/:draftId/approve               configuration.approve (Idempotency-Key)
 *   POST /drafts/:draftId/publish               configuration.publish (Idempotency-Key)
 * Owner-local staff routes (admin settings, CR-D-P05-D5-07 for the Gateway):
 *   GET  /scopes/:marketId/:namespace           configuration.read  overview
 *   GET  /scopes/:marketId/:namespace/versions  configuration.read
 *   GET  /scopes/:marketId/:namespace/history   configuration.read
 *   GET  /scopes/:marketId/:namespace/diff      configuration.read
 *   GET  /drafts/:draftId                       configuration.read
 *   POST /drafts/:draftId/withdraw              configuration.write (Idempotency-Key)
 */
@Controller('/internal/v1/configuration')
export class ConfigurationV1Controller {
  constructor(
    private readonly commands: ConfigurationV1Commands,
    private readonly queries: ConfigurationV1Queries,
    @Inject(SESSION_AUTHORITY) private readonly authority: SessionAuthority,
    @Inject(SERVICE_CALLERS) private readonly services: ServiceCallerAuthenticator,
    @Inject(RATE_LIMITS) private readonly limits: ConfigurationRateLimits,
  ) {}

  private async staff(
    headers: RequestHeaders,
    permission: ConfigurationPermission,
    budget: 'commands' | 'reads',
  ): Promise<RequestMeta> {
    const session = await this.authority.verify({
      authorization: headers.authorization,
      forwardedSubject: headers['x-auth-subject'],
    });
    requirePermission(session, permission);
    if (!this.limits[budget].take(session.subject)) fail(429, 'RATE_LIMITED');
    return {
      actor: {
        subject: session.subject,
        correlationId: resolveCorrelationId(headers['x-correlation-id']),
      },
      idempotencyKey: headers['idempotency-key'],
      traceParent: headers.traceparent ?? null,
    };
  }

  private send(response: HttpResponse, result: CommandResult | 'NOT_FOUND'): unknown {
    if (result === 'NOT_FOUND') fail(404, 'NOT_FOUND');
    if (result.kind === 'IDEMPOTENCY_CONFLICT') fail(409, 'IDEMPOTENCY_CONFLICT');
    response.setHeader('cache-control', 'no-store');
    response.setHeader('idempotency-replayed', String(result.kind === 'REPLAYED'));
    response.status(result.outcome.status);
    return result.outcome.body;
  }

  /* ---------------------------- contract routes --------------------------- */

  @Get('scopes/:marketId/:namespace/current')
  async current(
    @Headers() headers: RequestHeaders,
    @Param('marketId') marketId: string,
    @Param('namespace') namespace: string,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    try {
      const caller = this.services.authorize({
        clientId: headers['x-service-client'],
        token: headers['x-service-token'],
        scope: 'configuration.read',
      });
      if (!this.limits.service.take(caller.clientId)) fail(429, 'RATE_LIMITED');
      response.setHeader('cache-control', 'no-store');
      return await this.queries.current(marketId, namespace);
    } catch (error) {
      return translate(error);
    }
  }

  @Post('scopes/:marketId/:namespace/drafts')
  async createDraft(
    @Headers() headers: RequestHeaders,
    @Param('marketId') marketId: string,
    @Param('namespace') namespace: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    try {
      const meta = await this.staff(headers, CONFIGURATION_PERMISSIONS.write, 'commands');
      return this.send(response, await this.commands.createDraft(meta, marketId, namespace, body));
    } catch (error) {
      return translate(error);
    }
  }

  @Post('drafts/:draftId/approve')
  async approve(
    @Headers() headers: RequestHeaders,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    try {
      const meta = await this.staff(headers, CONFIGURATION_PERMISSIONS.approve, 'commands');
      return this.send(response, await this.commands.approve(meta, draftId, body));
    } catch (error) {
      return translate(error);
    }
  }

  @Post('drafts/:draftId/publish')
  async publish(
    @Headers() headers: RequestHeaders,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    try {
      const meta = await this.staff(headers, CONFIGURATION_PERMISSIONS.publish, 'commands');
      return this.send(response, await this.commands.publish(meta, draftId, body));
    } catch (error) {
      return translate(error);
    }
  }

  /* --------------------------- owner staff routes ------------------------- */

  @Post('drafts/:draftId/withdraw')
  async withdraw(
    @Headers() headers: RequestHeaders,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    try {
      const meta = await this.staff(headers, CONFIGURATION_PERMISSIONS.write, 'commands');
      return this.send(response, await this.commands.withdraw(meta, draftId, body));
    } catch (error) {
      return translate(error);
    }
  }

  @Get('drafts/:draftId')
  @HttpCode(200)
  async draft(@Headers() headers: RequestHeaders, @Param('draftId') draftId: string) {
    try {
      await this.staff(headers, CONFIGURATION_PERMISSIONS.read, 'reads');
      const found = await this.queries.draft(draftId);
      if (found === 'NOT_FOUND') fail(404, 'NOT_FOUND');
      return found;
    } catch (error) {
      return translate(error);
    }
  }

  @Get('scopes/:marketId/:namespace')
  async overview(
    @Headers() headers: RequestHeaders,
    @Param('marketId') marketId: string,
    @Param('namespace') namespace: string,
  ) {
    try {
      await this.staff(headers, CONFIGURATION_PERMISSIONS.read, 'reads');
      return await this.queries.overview(marketId, namespace);
    } catch (error) {
      return translate(error);
    }
  }

  @Get('scopes/:marketId/:namespace/versions')
  async versions(
    @Headers() headers: RequestHeaders,
    @Param('marketId') marketId: string,
    @Param('namespace') namespace: string,
    @Query('limit') limit: string | undefined,
    @Query('beforeVersion') beforeVersion: string | undefined,
  ) {
    try {
      await this.staff(headers, CONFIGURATION_PERMISSIONS.read, 'reads');
      return await this.queries.versions(marketId, namespace, { limit, beforeVersion });
    } catch (error) {
      return translate(error);
    }
  }

  @Get('scopes/:marketId/:namespace/history')
  async history(
    @Headers() headers: RequestHeaders,
    @Param('marketId') marketId: string,
    @Param('namespace') namespace: string,
    @Query('limit') limit: string | undefined,
    @Query('beforeSeq') beforeSeq: string | undefined,
  ) {
    try {
      await this.staff(headers, CONFIGURATION_PERMISSIONS.read, 'reads');
      return await this.queries.history(marketId, namespace, { limit, beforeSeq });
    } catch (error) {
      return translate(error);
    }
  }

  @Get('scopes/:marketId/:namespace/diff')
  async diff(
    @Headers() headers: RequestHeaders,
    @Param('marketId') marketId: string,
    @Param('namespace') namespace: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
  ) {
    try {
      await this.staff(headers, CONFIGURATION_PERMISSIONS.read, 'reads');
      const result = await this.queries.diff(marketId, namespace, { from, to });
      if (result === 'NOT_FOUND') fail(404, 'NOT_FOUND');
      return result;
    } catch (error) {
      return translate(error);
    }
  }
}
