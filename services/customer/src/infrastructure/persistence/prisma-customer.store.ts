import type {
  Address,
  AddressDetails,
  AddressLocation,
  AddressStatus,
  CustomerProfile,
  LocationSource,
  Principal,
  ProfileChanges,
} from '../../domain';
import { canonicalDecimal, CRS, LOCATION_SOURCES, parseLocale } from '../../domain';
import type {
  AuditEntry,
  CustomerStore,
  CustomerTransaction,
  IdempotencyClaim,
  IdempotencyRequest,
  NewAddress,
  NewProfile,
  OutboxEvent,
} from '../../ports';
import type {
  CustomerAddress,
  CustomerProfile as ProfileRow,
  PrismaClient,
} from '../../generated/prisma/client';
import {
  Decimal,
  type InputJsonValue,
  type TransactionClient,
} from '../../generated/prisma/internal/prismaNamespace';

const SCHEMA = /^[a-z_][a-z0-9_]{0,62}$/;
const TRANSACTION_OPTIONS = { maxWait: 2_000, timeout: 10_000 } as const;

function toProfile(row: ProfileRow): CustomerProfile {
  if (row.principalKind !== 'account' && row.principalKind !== 'guest') {
    throw new Error('CORRUPT_PRINCIPAL_KIND');
  }
  return {
    id: row.id,
    principal: { kind: row.principalKind, subject: row.principalSubject },
    displayName: row.displayName,
    phone: row.phone,
    preferredLocale: parseLocale(row.preferredLocale),
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function decimalText(value: Decimal | null): string {
  if (value === null) throw new Error('CORRUPT_COORDINATES');
  return canonicalDecimal(value.toFixed(6));
}

function toLocation(row: CustomerAddress): AddressLocation {
  if (row.locationKind === 'manual') return { kind: 'manual' };
  const source = LOCATION_SOURCES.find(
    (candidate): candidate is LocationSource => candidate === row.locationSource,
  );
  if (row.locationKind !== 'coordinates' || !source) throw new Error('CORRUPT_LOCATION');
  return {
    kind: 'coordinates',
    source,
    coordinates: {
      crs: CRS,
      latitude: decimalText(row.latitude),
      longitude: decimalText(row.longitude),
    },
  };
}

function toAddress(row: CustomerAddress): Address {
  if (row.status !== 'ACTIVE' && row.status !== 'ARCHIVED')
    throw new Error('CORRUPT_ADDRESS_STATUS');
  return {
    id: row.id,
    customerId: row.customerId,
    label: row.label,
    line: row.line,
    accessNote: row.accessNote,
    location: toLocation(row),
    status: row.status,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function locationColumns(details: AddressDetails) {
  const location = details.location;
  return location.kind === 'manual'
    ? { locationKind: 'manual', locationSource: null, latitude: null, longitude: null }
    : {
        locationKind: 'coordinates',
        locationSource: location.source,
        latitude: new Decimal(location.coordinates.latitude),
        longitude: new Decimal(location.coordinates.longitude),
      };
}

class PrismaCustomerTransaction implements CustomerTransaction {
  constructor(
    private readonly tx: TransactionClient,
    private readonly schema: string,
  ) {}

  async claimIdempotency(request: IdempotencyRequest): Promise<IdempotencyClaim> {
    // INSERT ... ON CONFLICT DO NOTHING. A concurrent duplicate blocks on the
    // primary key until the first transaction ends, then sees its committed row.
    const inserted = await this.tx.idempotencyRecord.createMany({
      data: [
        {
          scope: request.scope,
          key: request.key,
          operation: request.operation,
          fingerprint: request.fingerprint,
          createdAt: request.now,
          expiresAt: request.expiresAt,
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 1) return { kind: 'claimed' };
    const existing = await this.tx.idempotencyRecord.findUnique({
      where: { scope_key: { scope: request.scope, key: request.key } },
    });
    if (!existing || existing.responseStatus === null)
      throw new Error('IDEMPOTENCY_RECORD_INCOMPLETE');
    if (existing.operation !== request.operation || existing.fingerprint !== request.fingerprint) {
      return { kind: 'mismatch' };
    }
    return { kind: 'replay', status: existing.responseStatus, body: existing.responseBody };
  }

  async completeIdempotency(
    scope: string,
    key: string,
    status: number,
    body: unknown,
  ): Promise<void> {
    await this.tx.idempotencyRecord.update({
      where: { scope_key: { scope, key } },
      data: { responseStatus: status, responseBody: body as InputJsonValue },
    });
  }

  async findProfileForUpdate(principal: Principal): Promise<CustomerProfile | null> {
    const locked = await this.tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "${this.schema}"."customer_profile"
        WHERE principal_kind = $1 AND principal_subject = $2::uuid
        FOR UPDATE`,
      principal.kind,
      principal.subject,
    );
    const id = locked[0]?.id;
    if (id === undefined) return null;
    const row = await this.tx.customerProfile.findUnique({ where: { id } });
    return row ? toProfile(row) : null;
  }

  async insertProfile(profile: NewProfile): Promise<CustomerProfile | null> {
    const inserted = await this.tx.customerProfile.createMany({
      data: [
        {
          id: profile.id,
          principalKind: profile.principal.kind,
          principalSubject: profile.principal.subject,
          preferredLocale: 'ar',
          revision: 1,
          createdAt: profile.now,
          updatedAt: profile.now,
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count !== 1) return null;
    const row = await this.tx.customerProfile.findUnique({ where: { id: profile.id } });
    return row ? toProfile(row) : null;
  }

  async updateProfile(
    id: string,
    changes: ProfileChanges,
    expectedRevision: number,
    now: Date,
  ): Promise<CustomerProfile | null> {
    const updated = await this.tx.customerProfile.updateMany({
      where: { id, revision: expectedRevision },
      data: { ...changes, revision: expectedRevision + 1, updatedAt: now },
    });
    if (updated.count !== 1) return null;
    const row = await this.tx.customerProfile.findUnique({ where: { id } });
    return row ? toProfile(row) : null;
  }

  countActiveAddresses(customerId: string): Promise<number> {
    return this.tx.customerAddress.count({ where: { customerId, status: 'ACTIVE' } });
  }

  async insertAddress(address: NewAddress): Promise<Address> {
    const row = await this.tx.customerAddress.create({
      data: {
        id: address.id,
        customerId: address.customerId,
        label: address.label,
        line: address.line,
        accessNote: address.accessNote,
        ...locationColumns(address),
        status: 'ACTIVE',
        revision: 1,
        createdAt: address.now,
        updatedAt: address.now,
      },
    });
    return toAddress(row);
  }

  async findAddress(customerId: string, addressId: string): Promise<Address | null> {
    const row = await this.tx.customerAddress.findFirst({ where: { id: addressId, customerId } });
    return row ? toAddress(row) : null;
  }

  async updateAddress(
    customerId: string,
    addressId: string,
    details: AddressDetails,
    status: AddressStatus,
    expectedRevision: number,
    now: Date,
  ): Promise<Address | null> {
    const updated = await this.tx.customerAddress.updateMany({
      where: { id: addressId, customerId, revision: expectedRevision },
      data: {
        label: details.label,
        line: details.line,
        accessNote: details.accessNote,
        ...locationColumns(details),
        status,
        revision: expectedRevision + 1,
        updatedAt: now,
      },
    });
    if (updated.count !== 1) return null;
    return this.findAddress(customerId, addressId);
  }

  async appendOutbox(event: OutboxEvent): Promise<void> {
    await this.tx.outboxMessage.create({
      data: {
        id: event.eventId,
        eventId: event.eventId,
        eventType: event.eventType,
        exchange: event.exchange,
        routingKey: event.routingKey,
        payload: event.payload,
        correlationId: event.correlationId,
        traceParent: event.traceParent,
      },
    });
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    await this.tx.auditEntry.create({ data: { ...entry } });
  }
}

/**
 * Customer's own PostgreSQL adapter. It is the only code that knows table
 * names; nothing outside this service may read these tables.
 */
export class PrismaCustomerStore implements CustomerStore {
  private readonly schema: string;

  constructor(
    private readonly client: PrismaClient,
    schema: string,
  ) {
    if (!SCHEMA.test(schema)) throw new Error('INVALID_DATABASE_SCHEMA');
    this.schema = schema;
  }

  transaction<T>(work: (tx: CustomerTransaction) => Promise<T>): Promise<T> {
    return this.client.$transaction(
      (tx) => work(new PrismaCustomerTransaction(tx, this.schema)),
      TRANSACTION_OPTIONS,
    );
  }

  async findProfile(principal: Principal): Promise<CustomerProfile | null> {
    const row = await this.client.customerProfile.findUnique({
      where: {
        principalKind_principalSubject: {
          principalKind: principal.kind,
          principalSubject: principal.subject,
        },
      },
    });
    return row ? toProfile(row) : null;
  }

  async listAddresses(customerId: string, includeArchived: boolean): Promise<Address[]> {
    const rows = await this.client.customerAddress.findMany({
      where: includeArchived ? { customerId } : { customerId, status: 'ACTIVE' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toAddress);
  }

  async findAddress(customerId: string, addressId: string): Promise<Address | null> {
    const row = await this.client.customerAddress.findFirst({
      where: { id: addressId, customerId },
    });
    return row ? toAddress(row) : null;
  }
}
