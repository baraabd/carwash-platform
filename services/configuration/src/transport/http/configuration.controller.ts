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
} from '@nestjs/common';
import { AppError, resolveCorrelationId } from '@carwash/service-kit';
import {
  CONFIGURATION_PERMISSIONS,
  requirePermission,
  type ConfigurationPermission,
} from '../../application/access';
import {
  ConfigurationCommands,
  ConfigurationQueries,
} from '../../application/configuration.service';
import { ConfigurationRuleError } from '../../domain/configuration';
import type { RevisionRecord } from '../../ports/configuration.ports';
import { AccessFault, type SessionAuthority } from '../../ports/identity.ports';

export const SESSION_AUTHORITY = 'CONFIGURATION_SESSION_AUTHORITY';
export const CONFIGURATION_V1 = '/internal/v1/configuration';

type RequestHeaders = Record<string, string | undefined>;

const ACCESS_STATUS = { AUTH_REQUIRED: 401, AUTH_FORBIDDEN: 403, AUTH_UNAVAILABLE: 503 } as const;
const CONFLICT_CODES = new Set([
  'REVISION_NOT_APPROVED',
  'REVISION_NOT_NEWER_THAN_ACTIVE',
  'ACTIVE_REVISION_NOT_APPROVED',
]);

/** Domain and access failures become stable public error codes at the edge. */
function translate(error: unknown): never {
  if (error instanceof AccessFault)
    throw new AppError({
      status: ACCESS_STATUS[error.code],
      code: error.code,
      message: error.code,
    });
  if (error instanceof ConfigurationRuleError)
    throw new AppError({
      status: CONFLICT_CODES.has(error.code) ? 409 : 422,
      code: error.code,
      message: error.code,
    });
  throw error;
}

function object(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body))
    throw new AppError({ status: 400, code: 'REQUEST_INVALID', message: 'REQUEST_INVALID' });
  return body as Record<string, unknown>;
}

/** Public projection of a revision: identifiers, value and review state, no idempotency internals. */
function revisionView(record: RevisionRecord) {
  return {
    id: record.id,
    namespace: record.scope.namespace,
    key: record.scope.key,
    environment: record.scope.environment,
    tenantId: record.scope.tenantScope === '*' ? null : record.scope.tenantScope,
    revision: record.revision,
    value: record.value,
    valueHash: record.valueHash,
    authorSubject: record.authorSubject,
    reason: record.reason,
    proposedAt: record.proposedAt.toISOString(),
    review: record.review && {
      decision: record.review.decision,
      reviewerSubject: record.review.reviewerSubject,
      reviewedAt: record.review.reviewedAt.toISOString(),
    },
  };
}

@Controller(CONFIGURATION_V1)
export class ConfigurationController {
  constructor(
    private readonly commands: ConfigurationCommands,
    private readonly queries: ConfigurationQueries,
    @Inject(SESSION_AUTHORITY) private readonly authority: SessionAuthority,
  ) {}

  private async actor(headers: RequestHeaders, permission: ConfigurationPermission) {
    const session = await this.authority.verify({
      authorization: headers.authorization,
      forwardedSubject: headers['x-auth-subject'],
    });
    requirePermission(session, permission);
    return {
      subject: session.subject,
      correlationId: resolveCorrelationId(headers['x-correlation-id']),
    };
  }

  @Get('values/:namespace/:key')
  async effective(
    @Headers() headers: RequestHeaders,
    @Param('namespace') namespace: string,
    @Param('key') key: string,
    @Query('environment') environment: string | undefined,
    @Query('tenantId') tenantId: string | undefined,
  ) {
    try {
      await this.actor(headers, CONFIGURATION_PERMISSIONS.read);
      const resolution = await this.queries.effective({ namespace, key, environment, tenantId });
      if (resolution.status === 'NOT_CONFIGURED') return { status: 'NOT_CONFIGURED' };
      return {
        status: 'CONFIGURED',
        source: resolution.source,
        revision: resolution.revision,
        value: resolution.value,
      };
    } catch (error) {
      return translate(error);
    }
  }

  @Get('values/:namespace/:key/revisions')
  async history(
    @Headers() headers: RequestHeaders,
    @Param('namespace') namespace: string,
    @Param('key') key: string,
    @Query('environment') environment: string | undefined,
    @Query('tenantId') tenantId: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    try {
      await this.actor(headers, CONFIGURATION_PERMISSIONS.read);
      const rows = await this.queries.history({ namespace, key, environment, tenantId, limit });
      return { revisions: rows.map(revisionView) };
    } catch (error) {
      return translate(error);
    }
  }

  @Post('revisions')
  @HttpCode(201)
  async propose(@Headers() headers: RequestHeaders, @Body() body: unknown) {
    try {
      const actor = await this.actor(headers, CONFIGURATION_PERMISSIONS.write);
      const input = object(body);
      const result = await this.commands.propose(actor, headers['idempotency-key'], {
        namespace: input.namespace,
        key: input.key,
        environment: input.environment,
        tenantId: input.tenantId,
        type: input.type,
        value: input.value,
        reason: input.reason,
      });
      if (result.kind === 'IDEMPOTENCY_CONFLICT')
        throw new AppError({
          status: 409,
          code: 'IDEMPOTENCY_CONFLICT',
          message: 'IDEMPOTENCY_CONFLICT',
        });
      return { replayed: result.kind === 'REPLAYED', revision: revisionView(result.revision) };
    } catch (error) {
      return translate(error);
    }
  }

  @Post('revisions/:id/review')
  @HttpCode(200)
  async review(@Headers() headers: RequestHeaders, @Param('id') id: string, @Body() body: unknown) {
    try {
      const actor = await this.actor(headers, CONFIGURATION_PERMISSIONS.write);
      const input = object(body);
      const outcome = await this.commands.review(actor, id, {
        decision: input.decision,
        note: input.note,
      });
      if (outcome === 'NOT_FOUND')
        throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'NOT_FOUND' });
      if (outcome === 'SELF_REVIEW')
        throw new AppError({
          status: 403,
          code: 'SELF_REVIEW_FORBIDDEN',
          message: 'SELF_REVIEW_FORBIDDEN',
        });
      if (outcome === 'ALREADY_REVIEWED')
        throw new AppError({ status: 409, code: 'ALREADY_REVIEWED', message: 'ALREADY_REVIEWED' });
      return { recorded: true };
    } catch (error) {
      return translate(error);
    }
  }

  @Post('revisions/:id/activate')
  @HttpCode(200)
  async activate(
    @Headers() headers: RequestHeaders,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    try {
      const actor = await this.actor(headers, CONFIGURATION_PERMISSIONS.write);
      const input = object(body);
      const result = await this.commands.activate(actor, id, input.expectedVersion);
      if (result === 'NOT_FOUND')
        throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'NOT_FOUND' });
      if (result.kind === 'VERSION_CONFLICT')
        throw new AppError({
          status: 409,
          code: 'POINTER_VERSION_CONFLICT',
          message: 'POINTER_VERSION_CONFLICT',
          details: { currentVersion: result.current?.version ?? 0 },
        });
      return { activeRevision: result.pointer.activeRevision, version: result.pointer.version };
    } catch (error) {
      return translate(error);
    }
  }
}
