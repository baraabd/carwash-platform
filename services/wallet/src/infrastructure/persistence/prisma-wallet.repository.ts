import { Injectable } from '@nestjs/common';
import {
  CURRENCIES,
  MOVEMENT_KINDS,
  SOURCE_KINDS,
  SOURCE_STATUSES,
  type Currency,
  type SourceKind,
  type SourceState,
} from '../../domain';
import {
  INBOX_OUTCOMES,
  type CustodyAccount,
  type CustodyMovement,
  type InboxRecord,
  type WalletRepository,
  type WalletUnitOfWork,
} from '../../ports';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

type Tx = Prisma.TransactionClient;

/** Stored values are re-checked against the closed vocabularies when read back. */
function member<T extends string>(value: string, allowed: readonly T[]): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw new Error('STORED_VALUE_UNKNOWN');
  return found;
}

function toInbox(row: Prisma.WalletInboxGetPayload<object>): InboxRecord {
  return {
    eventId: row.eventId,
    eventType: row.eventType,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    aggregateVersion: row.aggregateVersion,
    outcome: member(row.outcome, INBOX_OUTCOMES),
    reason: row.reason,
    correlationId: row.correlationId,
    receivedAt: row.receivedAt,
  };
}

function toAccount(row: Prisma.CustodyAccountGetPayload<object>): CustodyAccount {
  return {
    holder: row.holderSubject,
    currency: member(row.currency, CURRENCIES),
    balances: {
      held: row.heldMinor,
      inHandover: row.inHandoverMinor,
      deposited: row.depositedMinor,
      settled: row.settledMinor,
      shortage: row.shortageMinor,
      overage: row.overageMinor,
    },
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

function toMovement(row: Prisma.CustodyMovementGetPayload<object>): CustodyMovement {
  return {
    id: row.id,
    holder: row.holderSubject,
    currency: member(row.currency, CURRENCIES),
    kind: member(row.kind, MOVEMENT_KINDS),
    delta: {
      held: row.heldDelta,
      inHandover: row.inHandoverDelta,
      deposited: row.depositedDelta,
      settled: row.settledDelta,
      shortage: row.shortageDelta,
      overage: row.overageDelta,
    },
    eventId: row.eventId,
    eventType: row.eventType,
    sourceKind: member(row.sourceKind, SOURCE_KINDS),
    sourceId: row.sourceId,
    sourceVersion: row.sourceVersion,
    occurredAt: row.occurredAt,
    recordedAt: row.recordedAt,
  };
}

class PrismaWalletUnitOfWork implements WalletUnitOfWork {
  constructor(private readonly tx: Tx) {}

  async claimEvent(record: InboxRecord): Promise<boolean> {
    const inserted = await this.tx.$executeRaw`
      INSERT INTO app.wallet_inbox (event_id, event_type, aggregate_type, aggregate_id, aggregate_version,
        outcome, reason, correlation_id, received_at)
      VALUES (${record.eventId}::uuid, ${record.eventType}, ${record.aggregateType}, ${record.aggregateId}::uuid,
        ${record.aggregateVersion}, ${record.outcome}, ${record.reason}, ${record.correlationId}::uuid, ${record.receivedAt})
      ON CONFLICT (event_id) DO NOTHING`;
    return inserted === 1;
  }

  async lockSource(kind: SourceKind, aggregateId: string): Promise<SourceState | null> {
    const rows = await this.tx.$queryRaw<{ aggregate_id: string }[]>`
      SELECT aggregate_id FROM app.custody_source WHERE kind = ${kind} AND aggregate_id = ${aggregateId}::uuid FOR UPDATE`;
    if (rows.length === 0) return null;
    const row = await this.tx.custodySource.findUnique({
      where: { kind_aggregateId: { kind, aggregateId } },
    });
    if (!row) return null;
    return {
      kind: member(row.kind, SOURCE_KINDS),
      aggregateId: row.aggregateId,
      lastVersion: row.lastVersion,
      holder: row.holderSubject,
      currency: member(row.currency, CURRENCIES),
      status: member(row.status, SOURCE_STATUSES),
      amountMinor: row.amountMinor,
      countedMinor: row.countedMinor,
    };
  }

  async saveSource(state: SourceState, at: Date): Promise<void> {
    await this.tx.custodySource.upsert({
      where: { kind_aggregateId: { kind: state.kind, aggregateId: state.aggregateId } },
      create: {
        kind: state.kind,
        aggregateId: state.aggregateId,
        lastVersion: state.lastVersion,
        holderSubject: state.holder,
        currency: state.currency,
        status: state.status,
        amountMinor: state.amountMinor,
        countedMinor: state.countedMinor,
        updatedAt: at,
      },
      update: {
        lastVersion: state.lastVersion,
        status: state.status,
        countedMinor: state.countedMinor,
        updatedAt: at,
      },
    });
  }

  async lockAccount(holder: string, currency: Currency, at: Date): Promise<CustodyAccount> {
    await this.tx.$executeRaw`
      INSERT INTO app.custody_account (holder_subject, currency, held_minor, in_handover_minor, deposited_minor,
        settled_minor, shortage_minor, overage_minor, version, updated_at)
      VALUES (${holder}::uuid, ${currency}, 0, 0, 0, 0, 0, 0, 0, ${at})
      ON CONFLICT (holder_subject, currency) DO NOTHING`;
    await this.tx.$queryRaw`
      SELECT holder_subject FROM app.custody_account
       WHERE holder_subject = ${holder}::uuid AND currency = ${currency} FOR UPDATE`;
    const row = await this.tx.custodyAccount.findUnique({
      where: { holderSubject_currency: { holderSubject: holder, currency } },
    });
    if (!row) throw new Error('CUSTODY_ACCOUNT_MISSING');
    return toAccount(row);
  }

  async updateAccount(account: CustodyAccount): Promise<void> {
    const b = account.balances;
    await this.tx.custodyAccount.update({
      where: {
        holderSubject_currency: { holderSubject: account.holder, currency: account.currency },
      },
      data: {
        heldMinor: b.held,
        inHandoverMinor: b.inHandover,
        depositedMinor: b.deposited,
        settledMinor: b.settled,
        shortageMinor: b.shortage,
        overageMinor: b.overage,
        version: account.version,
        updatedAt: account.updatedAt,
      },
    });
  }

  async appendMovement(movement: CustodyMovement): Promise<void> {
    const d = movement.delta;
    await this.tx.custodyMovement.create({
      data: {
        id: movement.id,
        holderSubject: movement.holder,
        currency: movement.currency,
        kind: movement.kind,
        heldDelta: d.held,
        inHandoverDelta: d.inHandover,
        depositedDelta: d.deposited,
        settledDelta: d.settled,
        shortageDelta: d.shortage,
        overageDelta: d.overage,
        eventId: movement.eventId,
        eventType: movement.eventType,
        sourceKind: movement.sourceKind,
        sourceId: movement.sourceId,
        sourceVersion: movement.sourceVersion,
        occurredAt: movement.occurredAt,
        recordedAt: movement.recordedAt,
      },
    });
  }
}

@Injectable()
export class PrismaWalletRepository implements WalletRepository {
  private readonly client: PrismaClient;

  constructor(prisma: PrismaService) {
    this.client = prisma.client;
  }

  transaction<T>(work: (uow: WalletUnitOfWork) => Promise<T>): Promise<T> {
    return this.client.$transaction((tx) => work(new PrismaWalletUnitOfWork(tx)), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 15_000,
    });
  }

  async inboxRecord(eventId: string): Promise<InboxRecord | null> {
    const row = await this.client.walletInbox.findUnique({ where: { eventId } });
    return row ? toInbox(row) : null;
  }

  async accountsOf(holder: string): Promise<CustodyAccount[]> {
    const rows = await this.client.custodyAccount.findMany({
      where: { holderSubject: holder },
      orderBy: { currency: 'asc' },
    });
    return rows.map(toAccount);
  }

  async movementsOf(holder: string, limit: number): Promise<CustodyMovement[]> {
    const rows = await this.client.custodyMovement.findMany({
      where: { holderSubject: holder },
      orderBy: [{ recordedAt: 'desc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(toMovement);
  }
}
