import { createHash } from 'node:crypto';
import {
  ContractViolation,
  closed,
  idempotencyMaterial,
  parseIdempotencyKey,
  parsePage,
  parsePageRequest,
  parseUtc,
  reviewsV1,
  uuid,
  type Page,
} from '@carwash/contracts';
import { moderate, samePrincipal, type Review } from '../domain/review';
import type {
  CommandIdentity,
  CommandReceipt,
  QueueCursor,
  RequestContext,
  ReviewRecord,
  ReviewsDependencies,
} from '../ports/reviews.ports';
import { reviewChangedEvent } from './events';
import { ReviewsError } from './errors';

export interface CommandResult {
  readonly view: Review;
  readonly replayed: boolean;
}

function commandOf(context: RequestContext, operation: CommandIdentity['operation'], key: unknown) {
  if (key === undefined) throw new ReviewsError('IDEMPOTENCY_KEY_REQUIRED');
  return { actor: context.actor.principal, operation, key: parseIdempotencyKey(key) };
}

function fingerprint(command: CommandIdentity, target: string, body: unknown): string {
  return createHash('sha256')
    .update(
      idempotencyMaterial({
        contract: reviewsV1.REVIEWS_V1.id,
        operation: command.operation,
        actor: `${command.actor.kind}:${command.actor.subjectId}`,
        target,
        body,
      }),
    )
    .digest('hex');
}

function replay(receipt: CommandReceipt, expected: string): CommandResult {
  if (receipt.fingerprint !== expected) throw new ReviewsError('IDEMPOTENCY_CONFLICT');
  return { view: receipt.view, replayed: true };
}

function requireModerator(context: RequestContext): void {
  if (
    context.actor.principal.kind !== 'account' ||
    !context.actor.permissions.includes('reviews.moderate')
  )
    throw new ReviewsError('AUTH_FORBIDDEN');
}

function decodeCursor(raw: string | null): QueueCursor | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    const v = closed(value, 'query.cursor', ['version', 'asOf', 'submittedAt', 'reviewId']);
    if (v.version !== 1) throw new Error('CURSOR_VERSION');
    const result = {
      asOf: parseUtc(v.asOf, 'query.cursor.asOf'),
      submittedAt: parseUtc(v.submittedAt, 'query.cursor.submittedAt'),
      reviewId: uuid(v.reviewId, 'query.cursor.reviewId'),
    };
    if (result.submittedAt > result.asOf) throw new Error('CURSOR_TIME');
    // No hidden suffix or alternate base64 representation is accepted.
    if (encodeCursor(result) !== raw) throw new Error('CURSOR_ENCODING');
    return result;
  } catch {
    throw new ContractViolation('INVALID_CURSOR', 'query.cursor');
  }
}

function encodeCursor(cursor: QueueCursor): string {
  return Buffer.from(JSON.stringify({ version: 1, ...cursor })).toString('base64url');
}

export class ReviewsService {
  constructor(private readonly deps: ReviewsDependencies) {}

  async submit(context: RequestContext, key: unknown, raw: unknown): Promise<CommandResult> {
    const command = commandOf(context, 'SUBMIT', key);
    const request = reviewsV1.parseSubmitReviewRequestV1(raw);
    // The common protocol defines sorted keys and NFC strings. Fingerprint the
    // accepted original body through that protocol, without additional owner coercion.
    const digest = fingerprint(command, request.bookingId, raw);
    const prior = await this.deps.store.receipt(command);
    if (prior) return replay(prior, digest);

    // A bounded owner read happens outside the database transaction. COMPLETED is a
    // terminal Booking fact; no local event/projection or caller field can substitute.
    const booking = await this.deps.booking.read(context, request.bookingId);
    if (
      !booking ||
      booking.bookingId !== request.bookingId ||
      booking.status !== 'COMPLETED' ||
      !samePrincipal(booking.beneficiary, context.actor.principal)
    )
      throw new ReviewsError('BUSINESS_RULE_VIOLATION', 'NOT_REVIEWABLE');
    const verifiedAt = this.deps.now().toISOString();

    return this.deps.store.transaction(async (tx) => {
      if (!(await tx.lockCommand(command))) throw new ReviewsError('IDEMPOTENCY_IN_PROGRESS');
      const concurrent = await tx.receipt(command);
      if (concurrent) return replay(concurrent, digest);
      await tx.lockBooking(request.bookingId);
      if (await tx.byBooking(request.bookingId))
        throw new ReviewsError('CONFLICT', 'REVIEW_ALREADY_SUBMITTED');
      const at = this.deps.now().toISOString();
      const view = reviewsV1.parseReviewV1({
        reviewId: this.deps.uuid(),
        revision: 1,
        bookingId: request.bookingId,
        author: context.actor.principal,
        rating: request.rating,
        comment: request.comment,
        publicationConsent: request.publicationConsent,
        status: request.publicationConsent ? 'PENDING_MODERATION' : 'PRIVATE',
        moderationReason: null,
        submittedAt: at,
        updatedAt: at,
      });
      const eventId = this.deps.uuid();
      await tx.apply({
        next: { view, bookingRevision: booking.revision, bookingVerifiedAt: verifiedAt },
        previous: null,
        actor: command.actor,
        action: 'SUBMIT',
        correlationId: context.correlationId,
        eventId,
        payload: reviewChangedEvent(null, view, command.actor, eventId, context.correlationId),
        command,
        fingerprint: digest,
      });
      return { view, replayed: false };
    });
  }

  async getBooking(context: RequestContext, rawId: unknown): Promise<Review> {
    const bookingId = uuid(rawId, 'path.bookingId');
    const record = await this.deps.store.byBooking(bookingId);
    const moderator =
      context.actor.principal.kind === 'account' &&
      context.actor.permissions.includes('reviews.moderate');
    if (!record || (!moderator && !samePrincipal(record.view.author, context.actor.principal)))
      throw new ReviewsError('NOT_FOUND');
    return record.view;
  }

  async queue(context: RequestContext, raw: unknown): Promise<Page<Review>> {
    requireModerator(context);
    const query = closed(raw, 'query', [], ['limit', 'cursor']);
    const page = parsePageRequest(query);
    const after = decodeCursor(page.cursor);
    const now = this.deps.now().toISOString();
    if (after && after.asOf > now) throw new ContractViolation('INVALID_CURSOR', 'query.cursor');
    const asOf = after?.asOf ?? now;
    const records = await this.deps.store.pending(asOf, after, page.limit + 1);
    const items = records.slice(0, page.limit).map((record) => record.view);
    const last = items.at(-1);
    return parsePage(
      {
        items,
        asOf,
        nextCursor:
          records.length > page.limit && last
            ? encodeCursor({ asOf, submittedAt: last.submittedAt, reviewId: last.reviewId })
            : null,
      },
      '$',
      reviewsV1.parseReviewV1,
    );
  }

  async decide(
    context: RequestContext,
    rawId: unknown,
    key: unknown,
    raw: unknown,
  ): Promise<CommandResult> {
    requireModerator(context);
    const reviewId = uuid(rawId, 'path.reviewId');
    const command = commandOf(context, 'MODERATE', key);
    const request = reviewsV1.parseModerateReviewRequestV1(raw);
    const digest = fingerprint(command, reviewId, raw);
    return this.deps.store.transaction(async (tx) => {
      if (!(await tx.lockCommand(command))) throw new ReviewsError('IDEMPOTENCY_IN_PROGRESS');
      const prior = await tx.receipt(command);
      if (prior) return replay(prior, digest);
      const record = await tx.lockReview(reviewId);
      if (!record) throw new ReviewsError('NOT_FOUND');
      const previous = record.view;
      if (previous.revision !== request.expectedRevision)
        throw new ReviewsError('REVISION_CONFLICT');
      if (!previous.publicationConsent)
        throw new ReviewsError('BUSINESS_RULE_VIOLATION', 'CONSENT_REQUIRED');
      const status = moderate(previous, request);
      if (!status) throw new ReviewsError('CONFLICT', 'REVIEW_NOT_PENDING');
      const now = this.deps.now().toISOString();
      const view = reviewsV1.parseReviewV1({
        ...previous,
        revision: previous.revision + 1,
        status,
        moderationReason: request.reason,
        updatedAt: now < previous.updatedAt ? previous.updatedAt : now,
      });
      const next: ReviewRecord = { ...record, view };
      const eventId = this.deps.uuid();
      await tx.apply({
        next,
        previous,
        actor: command.actor,
        action: request.decision,
        correlationId: context.correlationId,
        eventId,
        payload: reviewChangedEvent(previous, view, command.actor, eventId, context.correlationId),
        command,
        fingerprint: digest,
      });
      return { view, replayed: false };
    });
  }
}
