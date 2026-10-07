import {
  CatalogDefinitionError,
  normalizeDefinitions,
  planPublication,
  type CatalogDefinitions,
  type PublicationRejection,
} from '../domain';
import {
  AccessDenied,
  type AccessAuthority,
  type CatalogRepository,
  type Clock,
  type Hasher,
  type IdGenerator,
  type PublishedRevision,
  type RecordedOutcome,
  type RevisionSummary,
  type VerifiedPrincipal,
} from '../ports';
import { canonicalJson } from './canonical-json';
import { CatalogApplicationError } from './catalog-errors';

/** Requested from Lane E/Identity; until granted, publishing is denied to everyone. */
export const CATALOG_PUBLISH_PERMISSION = 'catalog.publish';
export const PUBLISH_OPERATION = 'catalog.revision.publish.v1';
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_REVISION = 2_147_483_647;

export interface RevisionView {
  readonly revision: number;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
  readonly publishedAt: string;
  readonly definitionsFingerprint: string;
  readonly definitions: CatalogDefinitions;
}

export interface RevisionSummaryView {
  readonly revision: number;
  readonly effectiveFrom: string;
  readonly publishedAt: string;
  readonly definitionsFingerprint: string;
}

export interface CommandResult {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
  readonly replayed: boolean;
}

export interface RequestContext {
  readonly credential: string | undefined;
  readonly correlationId: string;
}

const REJECTION_STATUS: Readonly<Record<PublicationRejection, number>> = {
  REVISION_CONFLICT: 409,
  EFFECTIVE_FROM_IN_PAST: 422,
  EFFECTIVE_FROM_NOT_AFTER_PREVIOUS: 422,
  EFFECTIVE_FROM_TOO_FAR: 422,
};

interface PublishCommand {
  readonly expectedRevision: number;
  readonly effectiveFrom: Date | null;
  readonly definitions: CatalogDefinitions;
}

function parseTimestamp(value: unknown): Date | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !UTC_MILLIS.test(value))
    throw new CatalogApplicationError('REQUEST_INVALID', { field: 'effectiveFrom' });
  const date = new Date(value);
  // Round-tripping rejects calendar-invalid values such as 2026-02-30.
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value)
    throw new CatalogApplicationError('REQUEST_INVALID', { field: 'effectiveFrom' });
  return date;
}

function parsePublishCommand(body: unknown): PublishCommand {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw new CatalogApplicationError('REQUEST_INVALID');
  const input = body as Record<string, unknown>;
  const keys = Object.keys(input).sort().join(',');
  if (keys !== 'definitions,effectiveFrom,expectedRevision')
    throw new CatalogApplicationError('REQUEST_INVALID');
  const expected = input.expectedRevision;
  if (
    typeof expected !== 'number' ||
    !Number.isInteger(expected) ||
    expected < 0 ||
    expected >= MAX_REVISION
  )
    throw new CatalogApplicationError('REQUEST_INVALID', { field: 'expectedRevision' });
  const effectiveFrom = parseTimestamp(input.effectiveFrom);
  try {
    return {
      expectedRevision: expected,
      effectiveFrom,
      definitions: normalizeDefinitions(input.definitions),
    };
  } catch (error: unknown) {
    if (!(error instanceof CatalogDefinitionError)) throw error;
    if (error.code === 'DEFINITIONS_MALFORMED')
      throw new CatalogApplicationError('REQUEST_INVALID', { field: error.path });
    throw new CatalogApplicationError('DEFINITIONS_INVALID', {
      reason: error.code,
      field: error.path,
    });
  }
}

function summaryView(summary: RevisionSummary): RevisionSummaryView {
  return {
    revision: summary.revision,
    effectiveFrom: summary.effectiveFrom.toISOString(),
    publishedAt: summary.publishedAt.toISOString(),
    definitionsFingerprint: summary.definitionsFingerprint,
  };
}

function revisionView(revision: PublishedRevision, effectiveUntil: Date | null): RevisionView {
  return {
    ...summaryView(revision),
    effectiveUntil: effectiveUntil?.toISOString() ?? null,
    definitions: revision.definitions,
  };
}

export class CatalogService {
  constructor(
    private readonly deps: {
      readonly repository: CatalogRepository;
      readonly authority: AccessAuthority;
      readonly clock: Clock;
      readonly ids: IdGenerator;
      readonly hasher: Hasher;
    },
  ) {}

  private async principal(
    context: RequestContext,
    permission?: string,
  ): Promise<VerifiedPrincipal> {
    let principal: VerifiedPrincipal;
    try {
      principal = await this.deps.authority.verify(context.credential, context.correlationId);
    } catch (error: unknown) {
      if (error instanceof AccessDenied) throw new CatalogApplicationError(error.reason);
      throw new CatalogApplicationError('AUTH_UNAVAILABLE');
    }
    if (permission && !principal.permissions.includes(permission))
      throw new CatalogApplicationError('AUTH_FORBIDDEN');
    return principal;
  }

  private async withWindow(revision: PublishedRevision): Promise<RevisionView> {
    const next = await this.deps.repository.revision(revision.revision + 1);
    return revisionView(revision, next?.effectiveFrom ?? null);
  }

  /** The catalog in force now. Any verified session may read definitions. */
  async inForce(context: RequestContext): Promise<RevisionView> {
    await this.principal(context);
    const revision = await this.deps.repository.revisionInForce(this.deps.clock.now());
    if (!revision) throw new CatalogApplicationError('CATALOG_NOT_PUBLISHED');
    return this.withWindow(revision);
  }

  /** An exact immutable revision, e.g. the one a quote or booking pinned. */
  async revision(context: RequestContext, rawRevision: string): Promise<RevisionView> {
    await this.principal(context);
    if (!/^[1-9][0-9]{0,9}$/.test(rawRevision) || Number(rawRevision) >= MAX_REVISION)
      throw new CatalogApplicationError('NOT_FOUND');
    const revision = await this.deps.repository.revision(Number(rawRevision));
    if (!revision) throw new CatalogApplicationError('NOT_FOUND');
    return this.withWindow(revision);
  }

  async listRevisions(context: RequestContext): Promise<{ revisions: RevisionSummaryView[] }> {
    await this.principal(context, CATALOG_PUBLISH_PERMISSION);
    const revisions = await this.deps.repository.listRevisions(50);
    return { revisions: revisions.map(summaryView) };
  }

  /**
   * Publishes the next revision. Receipt, revision and audit commit in one
   * transaction, so a lost response can always be recovered by replaying the
   * same key, and a reused key with a different payload never has an effect.
   */
  async publish(
    context: RequestContext,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = await this.principal(context, CATALOG_PUBLISH_PERMISSION);
    if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(idempotencyKey))
      throw new CatalogApplicationError('IDEMPOTENCY_KEY_INVALID');
    const command = parsePublishCommand(body);
    const definitionsFingerprint = this.deps.hasher.sha256Hex(canonicalJson(command.definitions));
    const requestFingerprint = this.deps.hasher.sha256Hex(
      canonicalJson({
        operation: PUBLISH_OPERATION,
        actor: principal.subject,
        expectedRevision: command.expectedRevision,
        effectiveFrom: command.effectiveFrom?.toISOString() ?? null,
        definitionsFingerprint,
      }),
    );

    return this.deps.repository.transaction(async (uow) => {
      const head = await uow.lockHead();
      const receipt = await uow.findReceipt(principal.subject, PUBLISH_OPERATION, idempotencyKey);
      if (receipt) {
        if (receipt.requestFingerprint !== requestFingerprint)
          throw new CatalogApplicationError('IDEMPOTENCY_CONFLICT');
        return { ...receipt.outcome, replayed: true };
      }
      const now = this.deps.clock.now();
      const plan = planPublication({
        head,
        expectedRevision: command.expectedRevision,
        effectiveFrom: command.effectiveFrom,
        now,
      });
      let outcome: RecordedOutcome;
      if (plan.accepted) {
        await uow.insertRevision({
          revision: plan.revision,
          effectiveFrom: plan.effectiveFrom,
          publishedAt: now,
          publishedBy: principal.subject,
          correlationId: context.correlationId,
          definitionsFingerprint,
          definitions: command.definitions,
        });
        const view = revisionView(
          {
            revision: plan.revision,
            effectiveFrom: plan.effectiveFrom,
            publishedAt: now,
            definitionsFingerprint,
            definitions: command.definitions,
          },
          null,
        );
        outcome = { status: 201, body: { ...view } };
      } else {
        outcome = { status: REJECTION_STATUS[plan.reason], body: { code: plan.reason } };
      }
      await uow.saveReceipt(
        {
          actorSubject: principal.subject,
          operation: PUBLISH_OPERATION,
          idempotencyKey,
          requestFingerprint,
          outcome,
        },
        now,
      );
      await uow.appendAudit({
        id: this.deps.ids.uuid(),
        occurredAt: now,
        actorSubject: principal.subject,
        action: plan.accepted ? 'catalog.revision.published' : 'catalog.revision.publish-rejected',
        revision: plan.accepted ? plan.revision : null,
        outcome: plan.accepted ? 'PUBLISHED' : plan.reason,
        correlationId: context.correlationId,
      });
      return { ...outcome, replayed: false };
    });
  }
}
