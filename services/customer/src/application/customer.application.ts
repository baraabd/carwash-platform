import { createHash } from 'node:crypto';
import {
  applyAddressChanges,
  applyProfileChanges,
  contactChanged,
  CustomerDomainError,
  parseAddressDetails,
  profileUnchanged,
  sameAddressDetails,
  type Address,
  type AddressLocation,
  type CustomerProfile,
} from '../domain';
import type {
  AuthorizedSession,
  Clock,
  CustomerStore,
  CustomerTransaction,
  IdGenerator,
  IdentityAuthorizer,
  SessionCredentials,
} from '../ports';
import { ApplicationError } from './errors';
import { addressUpdatedEvent, profileUpdatedEvent, type EventContext } from './events';

export const READ_PERMISSION = 'profile.read:self';
export const WRITE_PERMISSION = 'profile.write:self';
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface CustomerPolicy {
  /**
   * Technical abuse ceiling on ACTIVE saved addresses. The prototype's 20 is a
   * demo cap, not an approved product limit; this ceiling only stops unbounded
   * growth and is configurable by the deployment.
   */
  readonly maxActiveAddresses: number;
}

export interface RequestContext {
  readonly credentials: SessionCredentials;
  readonly correlationId: string;
  readonly traceParent: string | null;
}

export interface ProfileView {
  readonly customerId: string;
  readonly displayName: string | null;
  readonly phone: string | null;
  readonly preferredLocale: 'ar' | 'en';
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AddressView {
  readonly addressId: string;
  readonly label: string;
  readonly line: string;
  readonly accessNote: string | null;
  readonly location: AddressLocation;
  readonly status: 'ACTIVE' | 'ARCHIVED';
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Outcome<T> {
  readonly status: number;
  readonly body: T;
  readonly replayed: boolean;
}

export function profileView(profile: CustomerProfile): ProfileView {
  return {
    customerId: profile.id,
    displayName: profile.displayName,
    phone: profile.phone,
    preferredLocale: profile.preferredLocale,
    revision: profile.revision,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export function addressView(address: Address): AddressView {
  return {
    addressId: address.id,
    label: address.label,
    line: address.line,
    accessNote: address.accessNote,
    location: address.location,
    status: address.status,
    revision: address.revision,
    createdAt: address.createdAt.toISOString(),
    updatedAt: address.updatedAt.toISOString(),
  };
}

function fingerprint(operation: string, input: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify([operation, input]))
    .digest('hex');
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CustomerDomainError('INVALID_INPUT');
  }
  return value as Record<string, unknown>;
}

function onlyKeys(value: Readonly<Record<string, unknown>>, allowed: readonly string[]): void {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra !== undefined) throw new CustomerDomainError('INVALID_INPUT', extra);
}

function requireRevision(value: number | null): number {
  if (value === null) throw new ApplicationError('REVISION_REQUIRED');
  return value;
}

function principalScope(session: AuthorizedSession): string {
  return `${session.principal.kind}:${session.principal.subject}`;
}

/**
 * Customer use cases. Every write runs in one local transaction which also
 * holds its idempotency record, its outbox event and (for personal data) its
 * audit fact, so a crash can never leave one without the others.
 */
export class CustomerApplication {
  constructor(
    private readonly store: CustomerStore,
    private readonly identity: IdentityAuthorizer,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly policy: CustomerPolicy,
  ) {
    if (!Number.isSafeInteger(policy.maxActiveAddresses) || policy.maxActiveAddresses < 1) {
      throw new Error('INVALID_CUSTOMER_POLICY');
    }
  }

  private async session(context: RequestContext, permission: string): Promise<AuthorizedSession> {
    const session = await this.identity.authorize(
      context.credentials,
      permission === READ_PERMISSION ? 'read' : 'write',
    );
    if (!session.permissions.includes(permission)) throw new ApplicationError('AUTH_FORBIDDEN');
    return session;
  }

  private eventContext(context: RequestContext, now: Date): EventContext {
    return {
      eventId: this.ids.uuid(),
      occurredAt: now,
      correlationId: context.correlationId,
      traceParent: context.traceParent,
    };
  }

  private async withIdempotency<T>(
    tx: CustomerTransaction,
    session: AuthorizedSession,
    key: string | null,
    operation: string,
    input: unknown,
    now: Date,
    work: () => Promise<Outcome<T>>,
  ): Promise<Outcome<T>> {
    if (key === null) return work();
    if (!IDEMPOTENCY_KEY.test(key)) throw new ApplicationError('IDEMPOTENCY_KEY_INVALID');
    const scope = principalScope(session);
    const claim = await tx.claimIdempotency({
      scope,
      key,
      operation,
      fingerprint: fingerprint(operation, input),
      now,
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
    });
    if (claim.kind === 'mismatch') throw new ApplicationError('IDEMPOTENCY_KEY_REUSED');
    if (claim.kind === 'replay') {
      return { status: claim.status, body: claim.body as T, replayed: true };
    }
    const outcome = await work();
    await tx.completeIdempotency(scope, key, outcome.status, outcome.body);
    return outcome;
  }

  private async requireProfile(
    tx: CustomerTransaction,
    session: AuthorizedSession,
  ): Promise<CustomerProfile> {
    const profile = await tx.findProfileForUpdate(session.principal);
    if (!profile) throw new ApplicationError('PROFILE_NOT_FOUND');
    return profile;
  }

  /** Idempotent by nature: the principal's existing profile is returned unchanged. */
  async bootstrapProfile(context: RequestContext): Promise<Outcome<ProfileView>> {
    const session = await this.session(context, WRITE_PERMISSION);
    const existing = await this.store.findProfile(session.principal);
    if (existing) return { status: 200, body: profileView(existing), replayed: true };
    return this.store.transaction(async (tx) => {
      const now = this.clock.now();
      const created = await tx.insertProfile({
        id: this.ids.uuid(),
        principal: session.principal,
        now,
      });
      if (!created) {
        // A concurrent bootstrap for the same principal committed first.
        const winner = await tx.findProfileForUpdate(session.principal);
        if (!winner) throw new Error('PROFILE_BOOTSTRAP_RACE_UNRESOLVED');
        return { status: 200, body: profileView(winner), replayed: true };
      }
      await tx.appendOutbox(
        profileUpdatedEvent(
          this.eventContext(context, now),
          created.id,
          created.revision,
          'created',
        ),
      );
      await tx.appendAudit({
        id: this.ids.uuid(),
        actorSubject: session.principal.subject,
        actorSessionId: session.sessionId,
        action: 'customer.profile.created',
        targetType: 'customer',
        targetId: created.id,
        correlationId: context.correlationId,
        at: now,
      });
      return { status: 201, body: profileView(created), replayed: false };
    });
  }

  async getProfile(context: RequestContext): Promise<ProfileView> {
    const session = await this.session(context, READ_PERMISSION);
    const profile = await this.store.findProfile(session.principal);
    if (!profile) throw new ApplicationError('PROFILE_NOT_FOUND');
    return profileView(profile);
  }

  async updateProfile(
    context: RequestContext,
    expectedRevision: number | null,
    idempotencyKey: string | null,
    rawBody: unknown,
  ): Promise<Outcome<ProfileView>> {
    const session = await this.session(context, WRITE_PERMISSION);
    const body = asRecord(rawBody);
    const revision = requireRevision(expectedRevision);
    return this.store.transaction(async (tx) => {
      const now = this.clock.now();
      return this.withIdempotency(
        tx,
        session,
        idempotencyKey,
        'profile.update',
        [revision, body],
        now,
        async () => {
          const current = await this.requireProfile(tx, session);
          if (current.revision !== revision)
            throw new ApplicationError('REVISION_CONFLICT', current.revision);
          const changes = applyProfileChanges(current, body);
          if (profileUnchanged(current, changes)) {
            return { status: 200, body: profileView(current), replayed: false };
          }
          const updated = await tx.updateProfile(current.id, changes, revision, now);
          if (!updated) throw new ApplicationError('REVISION_CONFLICT', current.revision);
          await tx.appendOutbox(
            profileUpdatedEvent(
              this.eventContext(context, now),
              updated.id,
              updated.revision,
              'updated',
            ),
          );
          if (contactChanged(current, changes)) {
            await tx.appendAudit({
              id: this.ids.uuid(),
              actorSubject: session.principal.subject,
              actorSessionId: session.sessionId,
              action: 'customer.contact.changed',
              targetType: 'customer',
              targetId: updated.id,
              correlationId: context.correlationId,
              at: now,
            });
          }
          return { status: 200, body: profileView(updated), replayed: false };
        },
      );
    });
  }

  async listAddresses(context: RequestContext, includeArchived: boolean): Promise<AddressView[]> {
    const session = await this.session(context, READ_PERMISSION);
    const profile = await this.store.findProfile(session.principal);
    if (!profile) throw new ApplicationError('PROFILE_NOT_FOUND');
    return (await this.store.listAddresses(profile.id, includeArchived)).map(addressView);
  }

  /** A missing address and another customer's address are indistinguishable (404). */
  async getAddress(context: RequestContext, addressId: string): Promise<AddressView> {
    const session = await this.session(context, READ_PERMISSION);
    const profile = await this.store.findProfile(session.principal);
    if (!profile) throw new ApplicationError('ADDRESS_NOT_FOUND');
    const address = await this.store.findAddress(profile.id, addressId);
    if (!address) throw new ApplicationError('ADDRESS_NOT_FOUND');
    return addressView(address);
  }

  async createAddress(
    context: RequestContext,
    idempotencyKey: string | null,
    rawBody: unknown,
  ): Promise<Outcome<AddressView>> {
    const session = await this.session(context, WRITE_PERMISSION);
    if (idempotencyKey === null) throw new ApplicationError('IDEMPOTENCY_KEY_REQUIRED');
    const body = asRecord(rawBody);
    onlyKeys(body, ['label', 'line', 'accessNote', 'location']);
    const details = parseAddressDetails(body);
    return this.store.transaction(async (tx) => {
      const now = this.clock.now();
      return this.withIdempotency(
        tx,
        session,
        idempotencyKey,
        'address.create',
        body,
        now,
        async () => {
          // The profile row lock serialises concurrent creates for one customer,
          // so the active-address ceiling cannot be overrun by a race.
          const profile = await this.requireProfile(tx, session);
          if ((await tx.countActiveAddresses(profile.id)) >= this.policy.maxActiveAddresses) {
            throw new CustomerDomainError('ADDRESS_LIMIT_REACHED');
          }
          const address = await tx.insertAddress({
            ...details,
            id: this.ids.uuid(),
            customerId: profile.id,
            now,
          });
          await tx.appendOutbox(
            addressUpdatedEvent(this.eventContext(context, now), address, 'created'),
          );
          return { status: 201, body: addressView(address), replayed: false };
        },
      );
    });
  }

  async updateAddress(
    context: RequestContext,
    addressId: string,
    expectedRevision: number | null,
    idempotencyKey: string | null,
    rawBody: unknown,
  ): Promise<Outcome<AddressView>> {
    const session = await this.session(context, WRITE_PERMISSION);
    const body = asRecord(rawBody);
    onlyKeys(body, ['label', 'line', 'accessNote', 'location']);
    if (Object.keys(body).length === 0) throw new CustomerDomainError('INVALID_INPUT');
    const revision = requireRevision(expectedRevision);
    return this.store.transaction(async (tx) => {
      const now = this.clock.now();
      return this.withIdempotency(
        tx,
        session,
        idempotencyKey,
        'address.update',
        [addressId, revision, body],
        now,
        async () => {
          const profile = await this.requireOwnProfile(tx, session);
          const current = await tx.findAddress(profile.id, addressId);
          if (!current) throw new ApplicationError('ADDRESS_NOT_FOUND');
          if (current.revision !== revision)
            throw new ApplicationError('REVISION_CONFLICT', current.revision);
          const details = applyAddressChanges(current, body);
          if (sameAddressDetails(current, details)) {
            return { status: 200, body: addressView(current), replayed: false };
          }
          const updated = await tx.updateAddress(
            profile.id,
            addressId,
            details,
            'ACTIVE',
            revision,
            now,
          );
          if (!updated) throw new ApplicationError('REVISION_CONFLICT', current.revision);
          await tx.appendOutbox(
            addressUpdatedEvent(this.eventContext(context, now), updated, 'updated'),
          );
          await tx.appendAudit({
            id: this.ids.uuid(),
            actorSubject: session.principal.subject,
            actorSessionId: session.sessionId,
            action: 'customer.address.changed',
            targetType: 'address',
            targetId: updated.id,
            correlationId: context.correlationId,
            at: now,
          });
          return { status: 200, body: addressView(updated), replayed: false };
        },
      );
    });
  }

  /** Archiving an already archived address returns it unchanged (safe retry). */
  async archiveAddress(
    context: RequestContext,
    addressId: string,
    expectedRevision: number | null,
  ): Promise<Outcome<AddressView>> {
    const session = await this.session(context, WRITE_PERMISSION);
    const revision = requireRevision(expectedRevision);
    return this.store.transaction(async (tx) => {
      const now = this.clock.now();
      const profile = await this.requireOwnProfile(tx, session);
      const current = await tx.findAddress(profile.id, addressId);
      if (!current) throw new ApplicationError('ADDRESS_NOT_FOUND');
      if (current.status === 'ARCHIVED')
        return { status: 200, body: addressView(current), replayed: true };
      if (current.revision !== revision)
        throw new ApplicationError('REVISION_CONFLICT', current.revision);
      const archived = await tx.updateAddress(
        profile.id,
        addressId,
        current,
        'ARCHIVED',
        revision,
        now,
      );
      if (!archived) throw new ApplicationError('REVISION_CONFLICT', current.revision);
      await tx.appendOutbox(
        addressUpdatedEvent(this.eventContext(context, now), archived, 'archived'),
      );
      await tx.appendAudit({
        id: this.ids.uuid(),
        actorSubject: session.principal.subject,
        actorSessionId: session.sessionId,
        action: 'customer.address.archived',
        targetType: 'address',
        targetId: archived.id,
        correlationId: context.correlationId,
        at: now,
      });
      return { status: 200, body: addressView(archived), replayed: false };
    });
  }

  private async requireOwnProfile(
    tx: CustomerTransaction,
    session: AuthorizedSession,
  ): Promise<CustomerProfile> {
    // Without a profile no address can be owned, so the address is "not found".
    const profile = await tx.findProfileForUpdate(session.principal);
    if (!profile) throw new ApplicationError('ADDRESS_NOT_FOUND');
    return profile;
  }
}
