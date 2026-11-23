import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import {
  CHANNELS,
  NotificationRuleError,
  DELIVERY_STATES,
  afterLeaseExpiry,
  afterReceipt,
  providerIdempotencyKey,
  type Channel,
  type DeliveryState,
} from '../../domain/notification';
import type {
  ClaimedDelivery,
  EnqueueResult,
  Hasher,
  NotificationIntake,
  NotificationReader,
  NotificationRepository,
  NotificationView,
  StaffNotificationDetail,
  StaffNotificationPage,
  StaffNotificationView,
} from '../../ports/notification.ports';

export const sha256Hex: Hasher = (canonical) =>
  createHash('sha256').update(canonical, 'utf8').digest('hex');

type Db = PrismaClient | Prisma.TransactionClient;

function asState(value: string): DeliveryState {
  const state = DELIVERY_STATES.find((candidate) => candidate === value);
  if (!state) throw new Error('UNKNOWN_PERSISTED_STATE');
  return state;
}

function asChannel(value: string): Channel {
  const channel = CHANNELS.find((candidate) => candidate === value);
  if (!channel) throw new Error('UNKNOWN_PERSISTED_CHANNEL');
  return channel;
}

function asParameters(value: Prisma.JsonValue): Readonly<Record<string, string>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('CORRUPT_PERSISTED_PARAMETERS');
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') throw new Error('CORRUPT_PERSISTED_PARAMETERS');
    out[key] = entry;
  }
  return out;
}

/**
 * Intake only. Constructed with a transaction client it joins the caller's
 * transaction, which is how an inbox effect records an intent atomically with
 * the inbox row.
 */
export class PrismaNotificationIntake implements NotificationIntake {
  constructor(protected readonly db: Db) {}

  async enqueue(input: Parameters<NotificationIntake['enqueue']>[0]): Promise<EnqueueResult> {
    const { request, requestHash, notificationId, now } = input;
    // ON CONFLICT DO NOTHING on the business identity: a concurrent duplicate
    // waits on the unique index and then sees zero inserted rows.
    const inserted = await this.db.notification.createMany({
      data: [
        {
          id: notificationId,
          sourceService: request.sourceService,
          idempotencyKey: request.idempotencyKey,
          requestHash,
          recipientRef: request.recipientRef,
          channel: request.channel,
          templateKey: request.templateKey,
          templateVersion: request.templateVersion,
          parameters: request.parameters,
          state: 'QUEUED',
          nextAttemptAt: now,
          expiresAt: request.expiresAt,
          subjectType: request.subject?.type ?? null,
          subjectRef: request.subject?.ref ?? null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 1) return { kind: 'CREATED', notificationId };
    const existing = await this.db.notification.findUnique({
      where: {
        sourceService_idempotencyKey: {
          sourceService: request.sourceService,
          idempotencyKey: request.idempotencyKey,
        },
      },
      select: { id: true, requestHash: true },
    });
    if (!existing) throw new Error('NOTIFICATION_ENQUEUE_INCONSISTENT');
    return existing.requestHash === requestHash
      ? { kind: 'REPLAYED', notificationId: existing.id }
      : { kind: 'CONFLICT' };
  }
}

export class PrismaNotificationRepository
  extends PrismaNotificationIntake
  implements NotificationRepository
{
  constructor(private readonly client: PrismaClient) {
    super(client);
  }

  async claimDue(
    input: Parameters<NotificationRepository['claimDue']>[0],
  ): Promise<readonly ClaimedDelivery[]> {
    const { now, workerId, limit, leaseMs, idempotentProvider, maxAttempts } = input;
    // Never-sent intents past their expiry are settled without a provider call.
    await this.client.notification.updateMany({
      where: { state: { in: ['QUEUED', 'RETRY_WAIT'] }, expiresAt: { lte: now } },
      data: {
        state: 'EXPIRED',
        nextAttemptAt: null,
        lastErrorCode: 'EXPIRED_BEFORE_SEND',
        updatedAt: now,
      },
    });
    const candidates = await this.client.notification.findMany({
      where: {
        OR: [
          { state: { in: ['QUEUED', 'RETRY_WAIT'] }, nextAttemptAt: { lte: now } },
          { state: 'SENDING', leaseUntil: { lt: now } },
        ],
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
    });

    const claimed: ClaimedDelivery[] = [];
    for (const candidate of candidates) {
      if (candidate.state === 'SENDING') {
        const decision =
          candidate.expiresAt.getTime() <= now.getTime()
            ? 'UNKNOWN'
            : afterLeaseExpiry({
                idempotentProvider,
                attempt: candidate.attemptCount,
                maxAttempts,
              });
        if (decision === 'UNKNOWN') {
          await this.client.$transaction(async (tx) => {
            const moved = await tx.notification.updateMany({
              where: { id: candidate.id, fence: candidate.fence, state: 'SENDING' },
              data: {
                state: 'UNKNOWN',
                leaseOwner: null,
                leaseUntil: null,
                lastErrorCode: 'LEASE_EXPIRED_DURING_SUBMISSION',
                updatedAt: now,
              },
            });
            if (moved.count === 1)
              await this.closeOpenAttempt(tx, candidate.id, candidate.attemptCount, now);
          });
          continue;
        }
      }
      const fence = candidate.fence + 1;
      const attempt = candidate.attemptCount + 1;
      const won = await this.client.$transaction(async (tx) => {
        // Compare-and-set on (fence, state). PostgreSQL re-checks the WHERE
        // after the row lock, so exactly one of two racing workers moves it.
        const moved = await tx.notification.updateMany({
          where: { id: candidate.id, fence: candidate.fence, state: candidate.state },
          data: {
            state: 'SENDING',
            fence,
            attemptCount: attempt,
            leaseOwner: workerId,
            leaseUntil: new Date(now.getTime() + leaseMs),
            nextAttemptAt: null,
            updatedAt: now,
          },
        });
        if (moved.count === 0) return false;
        if (candidate.state === 'SENDING')
          await this.closeOpenAttempt(tx, candidate.id, candidate.attemptCount, now);
        await tx.deliveryAttempt.create({
          data: {
            notificationId: candidate.id,
            attemptNo: attempt,
            fence,
            workerId,
            startedAt: now,
          },
        });
        return true;
      });
      if (!won) continue;
      claimed.push({
        notificationId: candidate.id,
        fence,
        attempt,
        expiresAt: candidate.expiresAt,
        submission: {
          idempotencyKey: providerIdempotencyKey(candidate.id),
          channel: asChannel(candidate.channel),
          recipientRef: candidate.recipientRef,
          templateKey: candidate.templateKey,
          templateVersion: candidate.templateVersion,
          parameters: asParameters(candidate.parameters),
        },
      });
    }
    return claimed;
  }

  private async closeOpenAttempt(
    tx: Prisma.TransactionClient,
    notificationId: string,
    attemptNo: number,
    now: Date,
  ): Promise<void> {
    await tx.deliveryAttempt.updateMany({
      where: { notificationId, attemptNo, finishedAt: null },
      data: { finishedAt: now, outcome: 'LEASE_EXPIRED' },
    });
  }

  async complete(input: Parameters<NotificationRepository['complete']>[0]): Promise<boolean> {
    const { notificationId, fence, attempt, outcome, transition, now } = input;
    return this.client.$transaction(async (tx) => {
      // Lock the notification before its attempt, exactly as lease expiry and
      // reclaim do. The reverse order deadlocks with a concurrent sweeper.
      // Same fence and still SENDING, or UNKNOWN because this very claim's
      // lease lapsed with no newer claim since: then this claim's answer is
      // the best fact available. A receipt or a newer claim always wins.
      const moved = await tx.notification.updateMany({
        where: { id: notificationId, fence, state: { in: ['SENDING', 'UNKNOWN'] } },
        data: {
          state: transition.state,
          nextAttemptAt: transition.nextAttemptAt,
          providerMessageId: transition.providerMessageId,
          lastErrorCode: transition.errorCode,
          leaseOwner: null,
          leaseUntil: null,
          updatedAt: now,
        },
      });
      // The attempt row always records what this claim actually observed, even
      // when it lost: a late ACCEPTED is evidence reconciliation needs.
      await tx.deliveryAttempt.updateMany({
        where: { notificationId, attemptNo: attempt, fence },
        data: {
          finishedAt: now,
          outcome,
          providerMessageId: transition.providerMessageId,
          errorCode: transition.errorCode,
        },
      });
      return moved.count === 1;
    });
  }

  async applyReceipt(
    input: Parameters<NotificationRepository['applyReceipt']>[0],
  ): Promise<'APPLIED' | 'IGNORED' | 'NOT_FOUND'> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.client.notification.findUnique({
        where: { id: input.notificationId },
        select: { state: true, fence: true },
      });
      if (!current) return 'NOT_FOUND';
      const next = afterReceipt(asState(current.state), input.receipt);
      if (!next) return 'IGNORED';
      const moved = await this.client.notification.updateMany({
        where: { id: input.notificationId, state: current.state, fence: current.fence },
        data: {
          state: next,
          leaseOwner: null,
          leaseUntil: null,
          nextAttemptAt: null,
          updatedAt: input.now,
        },
      });
      if (moved.count === 1) return 'APPLIED';
    }
    throw new Error('RECEIPT_CONTENDED');
  }

  async cancel(
    notificationId: string,
    now: Date,
  ): Promise<'CANCELLED' | 'NOT_CANCELLABLE' | 'NOT_FOUND'> {
    const moved = await this.client.notification.updateMany({
      where: { id: notificationId, state: { in: ['QUEUED', 'RETRY_WAIT'] } },
      data: { state: 'CANCELLED', nextAttemptAt: null, updatedAt: now },
    });
    if (moved.count === 1) return 'CANCELLED';
    const exists = await this.client.notification.count({ where: { id: notificationId } });
    return exists === 0 ? 'NOT_FOUND' : 'NOT_CANCELLABLE';
  }

  async find(notificationId: string): Promise<NotificationView | null> {
    const row = await this.client.notification.findUnique({ where: { id: notificationId } });
    if (!row) return null;
    return {
      id: row.id,
      state: asState(row.state),
      attemptCount: row.attemptCount,
      channel: asChannel(row.channel),
      templateKey: row.templateKey,
      templateVersion: row.templateVersion,
      nextAttemptAt: row.nextAttemptAt,
      expiresAt: row.expiresAt,
      lastErrorCode: row.lastErrorCode,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

const CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Opaque keyset cursor over (created_at DESC, id DESC): `<iso>|<uuid>` in base64url. */
function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | null): { at: Date; id: string } | null {
  if (cursor === null) return null;
  const [iso, id, extra] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const at = new Date(iso ?? '');
  if (extra !== undefined || !id || !CURSOR_ID.test(id) || !Number.isFinite(at.getTime()))
    throw new NotificationRuleError('INVALID_CURSOR');
  return { at, id };
}

type NotificationRecord = Prisma.NotificationGetPayload<object>;

function staffView(row: NotificationRecord): StaffNotificationView {
  return {
    id: row.id,
    sourceService: row.sourceService,
    subject:
      row.subjectType !== null && row.subjectRef !== null
        ? { type: row.subjectType, ref: row.subjectRef }
        : null,
    channel: asChannel(row.channel),
    templateKey: row.templateKey,
    templateVersion: row.templateVersion,
    state: asState(row.state),
    attemptCount: row.attemptCount,
    nextAttemptAt: row.nextAttemptAt,
    expiresAt: row.expiresAt,
    lastErrorCode: row.lastErrorCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Read-only staff view. It never returns the recipient reference, the
 * template parameters or provider message ids: staff see whether and how a
 * notification was delivered, not to whom or with what content.
 */
export class PrismaNotificationReader implements NotificationReader {
  constructor(private readonly client: PrismaClient) {}

  async list(input: Parameters<NotificationReader['list']>[0]): Promise<StaffNotificationPage> {
    const after = decodeCursor(input.cursor);
    const rows = await this.client.notification.findMany({
      where: {
        AND: [
          input.subject ? { subjectType: input.subject.type, subjectRef: input.subject.ref } : {},
          input.state ? { state: input.state } : {},
          after
            ? {
                OR: [
                  { createdAt: { lt: after.at } },
                  { createdAt: after.at, id: { lt: after.id } },
                ],
              }
            : {},
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
    });
    const items = rows.slice(0, input.limit).map(staffView);
    const last = rows.length > input.limit ? rows[input.limit - 1] : undefined;
    return { items, nextCursor: last ? encodeCursor(last.createdAt, last.id) : null };
  }

  async detail(id: string): Promise<StaffNotificationDetail | null> {
    const row = await this.client.notification.findUnique({
      where: { id },
      include: { attempts: { orderBy: { attemptNo: 'asc' }, take: 50 } },
    });
    if (!row) return null;
    return {
      ...staffView(row),
      attempts: row.attempts.map((a) => ({
        attemptNo: a.attemptNo,
        startedAt: a.startedAt,
        finishedAt: a.finishedAt,
        outcome: a.outcome,
        errorCode: a.errorCode,
      })),
    };
  }
}
