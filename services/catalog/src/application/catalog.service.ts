import { planPublication, type PublicationRejection } from '../domain';
import {
  AccessDenied,
  type AccessAuthority,
  type CatalogRepository,
  type Clock,
  type Hasher,
  type IdGenerator,
  type RecordedOutcome,
  type VerifiedPrincipal,
} from '../ports';
import { canonicalJson } from './canonical-json';
import {
  CATALOG_ERROR_STATUS,
  CATALOG_REASONS,
  CatalogApplicationError,
  type CatalogErrorCode,
  type CatalogReason,
  type FieldIssue,
} from './catalog-errors';
import {
  WireViolation,
  catalogView,
  definitionView,
  parseDefinitionId,
  parsePublishRequest,
  type CatalogView,
  type DefinitionView,
  type PublishRequest,
} from './catalog-v1-wire';
import { definitionsPublishedEvent } from './events';

/** Granted by Identity (catalog.v1 publish access); every other caller is denied. */
export const CATALOG_PUBLISH_PERMISSION = 'catalog.publish';
export const CONTRACT_ID = 'catalog.v1';
export const PUBLISH_OPERATION = 'catalog.v1.publish';
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;

/** A committed publication (201 + CatalogV1) or a recorded rule rejection. */
export type CommandResult =
  | {
      readonly status: number;
      readonly replayed: boolean;
      readonly published: Readonly<Record<string, unknown>>;
    }
  | { readonly status: number; readonly replayed: boolean; readonly rejection: RejectionBody };

export interface RequestContext {
  readonly credential: string | undefined;
  readonly correlationId: string;
  /** Validated W3C traceparent of the request, or null. */
  readonly traceParent: string | null;
}

/** The stored body of a rejected command; replay re-renders the same error. */
export interface RejectionBody {
  readonly code: CatalogErrorCode;
  readonly reason: CatalogReason | null;
  readonly issues: readonly FieldIssue[];
}

const ERROR_CODES = Object.keys(CATALOG_ERROR_STATUS) as CatalogErrorCode[];

/**
 * Reads a stored receipt body back. Receipts are written only by this service,
 * so a body that does not parse is corruption and fails loudly.
 */
function readRejection(body: Readonly<Record<string, unknown>>): RejectionBody {
  const code = ERROR_CODES.find((candidate) => candidate === body.code);
  const reason =
    body.reason === null ? null : CATALOG_REASONS.find((candidate) => candidate === body.reason);
  const issues = Array.isArray(body.issues) ? body.issues : null;
  if (!code || reason === undefined || !issues) throw new Error('CATALOG_RECEIPT_CORRUPT');
  return {
    code,
    reason,
    issues: issues.map((issue: unknown) => {
      if (typeof issue !== 'object' || issue === null) throw new Error('CATALOG_RECEIPT_CORRUPT');
      const { field, code: issueCode } = issue as Record<string, unknown>;
      if (typeof field !== 'string' || typeof issueCode !== 'string')
        throw new Error('CATALOG_RECEIPT_CORRUPT');
      return { field, code: issueCode };
    }),
  };
}

function toResult(outcome: RecordedOutcome, replayed: boolean): CommandResult {
  return outcome.status < 400
    ? { status: outcome.status, replayed, published: outcome.body }
    : { status: outcome.status, replayed, rejection: readRejection(outcome.body) };
}

function rejectionFor(reason: PublicationRejection, field: string): RejectionBody {
  if (reason === 'REVISION_CONFLICT')
    return { code: 'REVISION_CONFLICT', reason: null, issues: [{ field, code: reason }] };
  const allowlisted = reason === 'DEFINITION_RETIRED' || reason === 'DUPLICATE_CODE';
  return {
    code: 'BUSINESS_RULE_VIOLATION',
    reason: allowlisted ? reason : null,
    issues: [{ field, code: reason }],
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

  private async publisher(context: RequestContext): Promise<VerifiedPrincipal> {
    let principal: VerifiedPrincipal;
    try {
      principal = await this.deps.authority.verify(context.credential, context.correlationId);
    } catch (error: unknown) {
      if (error instanceof AccessDenied && error.reason === 'AUTH_REQUIRED')
        throw new CatalogApplicationError('AUTH_REQUIRED');
      throw new CatalogApplicationError('DEPENDENCY_UNAVAILABLE');
    }
    if (!principal.permissions.includes(CATALOG_PUBLISH_PERMISSION))
      throw new CatalogApplicationError('AUTH_FORBIDDEN');
    return principal;
  }

  /** catalog.v1 getPublished (public): the complete current snapshot. */
  async published(): Promise<CatalogView> {
    const snapshot = await this.deps.repository.current();
    if (!snapshot) throw new CatalogApplicationError('NOT_FOUND');
    return catalogView(snapshot);
  }

  /** catalog.v1 getDefinition (public): a definition of the current snapshot, retired included. */
  async definition(rawId: string): Promise<DefinitionView> {
    const definitionId = parseDefinitionId(rawId);
    if (!definitionId) throw new CatalogApplicationError('NOT_FOUND');
    const snapshot = await this.deps.repository.current();
    const found = snapshot?.items.find((d) => d.definitionId === definitionId);
    if (!found) throw new CatalogApplicationError('NOT_FOUND');
    return definitionView(found);
  }

  /**
   * catalog.v1 publish. Receipt, publication, audit and outbox event commit in
   * one transaction, so a lost response is recovered by replaying the same key
   * and a reused key with a different payload never has an effect.
   */
  async publish(
    context: RequestContext,
    idempotencyKey: string | undefined,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = await this.publisher(context);
    if (idempotencyKey === undefined) throw new CatalogApplicationError('IDEMPOTENCY_KEY_REQUIRED');
    if (!IDEMPOTENCY_KEY.test(idempotencyKey))
      throw new CatalogApplicationError('REQUEST_INVALID', {
        issues: [{ field: 'header.idempotency-key', code: 'INVALID_IDEMPOTENCY_KEY' }],
      });
    let request: PublishRequest;
    try {
      request = parsePublishRequest(body);
    } catch (error: unknown) {
      if (!(error instanceof WireViolation)) throw error;
      throw new CatalogApplicationError('VALIDATION_FAILED', {
        issues: [{ field: error.path, code: error.code }],
      });
    }
    const requestFingerprint = this.deps.hasher.sha256Hex(
      canonicalJson({
        v: 1,
        contract: CONTRACT_ID,
        operation: PUBLISH_OPERATION,
        actor: principal.subject,
        target: null,
        body: request,
      }),
    );

    return this.deps.repository.transaction(async (uow) => {
      const current = await uow.lockCurrent();
      const receipt = await uow.findReceipt(principal.subject, PUBLISH_OPERATION, idempotencyKey);
      if (receipt) {
        if (receipt.requestFingerprint !== requestFingerprint)
          throw new CatalogApplicationError('IDEMPOTENCY_CONFLICT');
        return toResult(receipt.outcome, true);
      }
      const now = this.deps.clock.now();
      const plan = planPublication({
        current,
        expectedCatalogRevision: request.expectedCatalogRevision,
        drafts: request.drafts,
      });
      let outcome: RecordedOutcome;
      if (plan.accepted) {
        const snapshot = {
          catalogRevision: plan.catalogRevision,
          publishedAt: now,
          items: plan.items,
        };
        await uow.insertPublication({
          catalogRevision: plan.catalogRevision,
          publishedAt: now,
          publishedBy: principal.subject,
          correlationId: context.correlationId,
          reasonCode: request.reasonCode,
          snapshotFingerprint: this.deps.hasher.sha256Hex(canonicalJson(plan.items)),
          items: plan.items,
        });
        await uow.enqueue(
          definitionsPublishedEvent(
            {
              eventId: this.deps.ids.uuid(),
              occurredAt: now,
              correlationId: context.correlationId,
              traceParent: context.traceParent,
              actorSubject: principal.subject,
            },
            plan.catalogRevision,
            plan.changedDefinitionIds,
          ),
        );
        outcome = { status: 201, body: { ...catalogView(snapshot) } };
      } else {
        const rejection = rejectionFor(plan.reason, plan.field);
        outcome = { status: CATALOG_ERROR_STATUS[rejection.code], body: { ...rejection } };
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
        action: plan.accepted
          ? 'catalog.definitions.published'
          : 'catalog.definitions.publish-rejected',
        revision: plan.accepted ? plan.catalogRevision : null,
        outcome: plan.accepted ? 'PUBLISHED' : plan.reason,
        reasonCode: request.reasonCode,
        correlationId: context.correlationId,
      });
      return toResult(outcome, false);
    });
  }
}
