import {
  CANCEL_REASONS,
  FREEZE_REASONS,
  PLAN_CODE,
  PlanRuleError,
  grantDelta,
  normalizePlanTerms,
  planActivation,
  planCancel,
  planFreeze,
  planRenewal,
  planRevision,
  planUnfreeze,
  revisionInForce,
  type PeriodState,
  type PlanTerms,
  type SubscriptionState,
  type SubscriptionStatus,
} from '../domain';
import type {
  AccessAuthority,
  ActorRef,
  AuditAction,
  Clock,
  Hasher,
  IdGenerator,
  LockedSubscription,
  PeriodRecord,
  PlanRevisionRecord,
  RecordedOutcome,
  SubscriptionRecord,
  SubscriptionRepository,
  SubscriptionUnitOfWork,
  VerifiedPrincipal,
} from '../ports';
import { canonicalJson } from './canonical-json';
import { receiptCommand, type CommandResult } from './command-support';
import { subscriptionChangedEvent } from './events';
import {
  CUSTOMER_PERMISSION,
  MANAGE_PERMISSION,
  boundedInt,
  idempotencyKey,
  objectWithKeys,
  oneOf,
  pathId,
  timestamp,
  uuidField,
  verifiedPrincipal,
  type RequestContext,
} from './request-support';
import { SubscriptionApplicationError } from './subscription-errors';
import { revisionView, revisionsView, subscriptionView, termsView } from './views';

export const OPERATIONS = {
  publish: 'subscription.plan.publish.v1',
  request: 'subscription.request.v1',
  activate: 'subscription.activate.v1',
  renew: 'subscription.renew.v1',
  freeze: 'subscription.freeze.v1',
  unfreeze: 'subscription.unfreeze.v1',
  cancel: 'subscription.cancel.v1',
} as const;

export interface SubscriptionDeps {
  readonly repository: SubscriptionRepository;
  readonly authority: AccessAuthority;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly hasher: Hasher;
}

function stateOf(locked: LockedSubscription): SubscriptionState {
  return {
    status: locked.subscription.status,
    version: locked.subscription.version,
    terms: locked.subscription.terms,
    currentPeriod: locked.period,
  };
}

function planCode(value: string): string {
  if (!PLAN_CODE.test(value)) throw new SubscriptionApplicationError('NOT_FOUND');
  return value;
}

/**
 * Plans, customer subscriptions and their lifecycle. Staff management needs
 * `subscription.manage`; customers act on their own subscriptions only. Every
 * mutating command is receipt-idempotent, optimistic on the subscription
 * version, audited and emits its outbox event in the same transaction.
 */
export class SubscriptionService {
  constructor(private readonly deps: SubscriptionDeps) {}

  private fingerprint(value: Record<string, unknown>): string {
    return this.deps.hasher.sha256Hex(canonicalJson(value));
  }

  private command(
    actor: string,
    operation: string,
    key: string,
    fingerprint: string,
    work: (uow: SubscriptionUnitOfWork, now: Date) => Promise<RecordedOutcome>,
  ): Promise<CommandResult> {
    return receiptCommand({
      repository: this.deps.repository,
      clock: this.deps.clock,
      actor,
      operation,
      key,
      fingerprint,
      work,
    });
  }

  private async audit(
    uow: SubscriptionUnitOfWork,
    now: Date,
    actor: ActorRef,
    action: AuditAction,
    refs: { planCode?: string; subscriptionId?: string; reservationId?: string },
    outcome: string,
    correlationId: string,
  ): Promise<void> {
    await uow.appendAudit({
      id: this.deps.ids.uuid(),
      occurredAt: now,
      actor,
      action,
      planCode: refs.planCode ?? null,
      subscriptionId: refs.subscriptionId ?? null,
      reservationId: refs.reservationId ?? null,
      outcome,
      correlationId,
    });
  }

  private async emitChanged(
    uow: SubscriptionUnitOfWork,
    now: Date,
    actor: ActorRef,
    previous: SubscriptionStatus | null,
    subscription: SubscriptionRecord,
    period: PeriodState | null,
    correlationId: string,
  ): Promise<void> {
    await uow.appendOutbox(
      subscriptionChangedEvent(
        {
          customerSubject: subscription.customerSubject,
          planCode: subscription.planCode,
          planRevision: subscription.planRevision,
          previousStatus: previous,
          status: subscription.status,
          periodNo: period?.periodNo ?? null,
          periodEndsAt: period?.endsAt.toISOString() ?? null,
          unitsGranted: period?.granted ?? null,
        },
        {
          eventId: this.deps.ids.uuid(),
          occurredAt: now,
          correlationId,
          actor,
          aggregateId: subscription.id,
          version: subscription.version,
        },
      ),
    );
  }

  // ---------------------------------------------------------------- plans

  /** Publishes the next immutable revision of a plan (creating the plan on revision 1). */
  async publishRevision(
    context: RequestContext,
    key: unknown,
    code: string,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = await verifiedPrincipal(this.deps.authority, context, MANAGE_PERMISSION);
    const idempotency = idempotencyKey(key);
    if (!PLAN_CODE.test(code))
      throw new SubscriptionApplicationError('REQUEST_INVALID', { field: 'planCode' });
    const input = objectWithKeys(body, ['expectedRevision', 'effectiveFrom', 'terms']);
    const expectedRevision = boundedInt(input.expectedRevision, 0, 'expectedRevision');
    const effectiveFrom = timestamp(input.effectiveFrom, 'effectiveFrom', true);
    let terms: PlanTerms;
    try {
      terms = normalizePlanTerms(input.terms);
    } catch (error: unknown) {
      if (!(error instanceof PlanRuleError)) throw error;
      if (error.code === 'TERMS_MALFORMED')
        throw new SubscriptionApplicationError('REQUEST_INVALID', { field: error.path });
      throw new SubscriptionApplicationError('TERMS_INVALID', {
        reason: error.code,
        field: error.path,
      });
    }
    const actor: ActorRef = { kind: 'account', id: principal.subject };
    const fingerprint = this.fingerprint({
      operation: OPERATIONS.publish,
      actor: principal.subject,
      code,
      expectedRevision,
      effectiveFrom: effectiveFrom?.toISOString() ?? null,
      terms: termsView(terms),
    });
    return this.command(
      principal.subject,
      OPERATIONS.publish,
      idempotency,
      fingerprint,
      async (uow, now) => {
        const head = await uow.lockPlan(code, principal.subject, now);
        const plan = planRevision({ head, expectedRevision, effectiveFrom, now });
        if (!plan.accepted) {
          await this.audit(
            uow,
            now,
            actor,
            'subscription.plan.revision-rejected',
            { planCode: code },
            plan.reason,
            context.correlationId,
          );
          return {
            status: plan.reason === 'REVISION_CONFLICT' ? 409 : 422,
            body: { code: plan.reason },
          };
        }
        const revision: PlanRevisionRecord = {
          planCode: code,
          revision: plan.revision,
          effectiveFrom: plan.effectiveFrom,
          publishedAt: now,
          publishedBy: principal.subject,
          correlationId: context.correlationId,
          terms,
        };
        await uow.insertRevision(revision);
        await this.audit(
          uow,
          now,
          actor,
          'subscription.plan.revision-published',
          { planCode: code },
          `REVISION_${plan.revision}`,
          context.correlationId,
        );
        return { status: 201, body: revisionView(revision, null) };
      },
    );
  }

  async listPlans(context: RequestContext): Promise<{ plans: Record<string, unknown>[] }> {
    await verifiedPrincipal(this.deps.authority, context, MANAGE_PERMISSION);
    const codes = await this.deps.repository.planCodes(100);
    const plans = [];
    for (const code of codes)
      plans.push({
        planCode: code,
        revisions: revisionsView(await this.deps.repository.revisionsOf(code)),
      });
    return { plans };
  }

  async getPlan(context: RequestContext, code: string): Promise<Record<string, unknown>> {
    await verifiedPrincipal(this.deps.authority, context, MANAGE_PERMISSION);
    const revisions = await this.deps.repository.revisionsOf(planCode(code));
    if (revisions.length === 0) throw new SubscriptionApplicationError('NOT_FOUND');
    return { planCode: code, revisions: revisionsView(revisions) };
  }

  /** Plans a customer can buy now: the revision in force, if it is available. */
  async offers(context: RequestContext): Promise<{ offers: Record<string, unknown>[] }> {
    await verifiedPrincipal(this.deps.authority, context, CUSTOMER_PERMISSION);
    const now = this.deps.clock.now();
    const offers = [];
    for (const code of await this.deps.repository.planCodes(100)) {
      const revisions = await this.deps.repository.revisionsOf(code);
      const current = revisionInForce(revisions, now);
      if (!current || !current.terms.available) continue;
      const next = revisions.find((r) => r.revision === current.revision + 1);
      offers.push(revisionView(current, next?.effectiveFrom ?? null));
    }
    return { offers };
  }

  // -------------------------------------------------------- subscriptions

  /** A customer asks to buy the plan revision in force; staff activate it after payment. */
  async request(context: RequestContext, key: unknown, body: unknown): Promise<CommandResult> {
    const principal = await verifiedPrincipal(this.deps.authority, context, CUSTOMER_PERMISSION);
    if (principal.principalKind !== 'account')
      throw new SubscriptionApplicationError('AUTH_FORBIDDEN');
    const idempotency = idempotencyKey(key);
    const input = objectWithKeys(body, ['planCode']);
    if (typeof input.planCode !== 'string' || !PLAN_CODE.test(input.planCode))
      throw new SubscriptionApplicationError('REQUEST_INVALID', { field: 'planCode' });
    const code = input.planCode;
    const actor: ActorRef = { kind: 'account', id: principal.subject };
    const fingerprint = this.fingerprint({
      operation: OPERATIONS.request,
      actor: principal.subject,
      code,
    });
    return this.command(
      principal.subject,
      OPERATIONS.request,
      idempotency,
      fingerprint,
      async (uow, now) => {
        const current = revisionInForce(await uow.revisionsOf(code), now);
        if (!current || !current.terms.available)
          throw new SubscriptionApplicationError('PLAN_NOT_OFFERED');
        const subscription: SubscriptionRecord = {
          id: this.deps.ids.uuid(),
          customerSubject: principal.subject,
          planCode: code,
          planRevision: current.revision,
          status: 'PENDING_ACTIVATION',
          version: 1,
          terms: current.terms,
          currentPeriodNo: null,
          requestedAt: now,
          updatedAt: now,
          freezeReason: null,
          cancelReason: null,
        };
        await uow.insertSubscription(subscription);
        await this.audit(
          uow,
          now,
          actor,
          'subscription.requested',
          { planCode: code, subscriptionId: subscription.id },
          'PENDING_ACTIVATION',
          context.correlationId,
        );
        await this.emitChanged(uow, now, actor, null, subscription, null, context.correlationId);
        return { status: 201, body: subscriptionView(subscription, null, now, false) };
      },
    );
  }

  private async lockedForStaff(
    uow: SubscriptionUnitOfWork,
    id: string,
    principal: VerifiedPrincipal,
  ): Promise<LockedSubscription> {
    const locked = await uow.lockSubscription(id);
    if (!locked) throw new SubscriptionApplicationError('NOT_FOUND');
    // Separation of duties: staff never manage their own subscription.
    if (locked.subscription.customerSubject === principal.subject)
      throw new SubscriptionApplicationError('SELF_SERVICE_FORBIDDEN');
    return locked;
  }

  private async grantPeriod(
    uow: SubscriptionUnitOfWork,
    now: Date,
    actor: ActorRef,
    subscription: SubscriptionRecord,
    period: PeriodState,
    paymentReference: string,
    correlationId: string,
  ): Promise<PeriodRecord> {
    const record: PeriodRecord = {
      ...period,
      subscriptionId: subscription.id,
      planRevision: subscription.planRevision,
      paymentReference,
      grantedBy: actor.id,
      grantedAt: now,
    };
    await uow.insertPeriod(record);
    const delta = grantDelta(period.granted);
    await uow.appendMovement({
      id: this.deps.ids.uuid(),
      subscriptionId: subscription.id,
      periodNo: period.periodNo,
      reservationId: null,
      kind: delta.kind,
      granted: delta.granted,
      reserved: delta.reserved,
      consumed: delta.consumed,
      occurredAt: now,
      actor,
      correlationId,
    });
    return record;
  }

  private fundingInput(body: unknown): { expectedVersion: number; paymentReference: string } {
    const input = objectWithKeys(body, ['expectedVersion', 'paymentReference']);
    return {
      expectedVersion: boundedInt(input.expectedVersion, 1, 'expectedVersion'),
      paymentReference: uuidField(input.paymentReference, 'paymentReference'),
    };
  }

  /**
   * Staff activate a requested subscription after verifying its payment in
   * Billing; the opaque Billing reference funds exactly one period.
   */
  async activate(
    context: RequestContext,
    key: unknown,
    id: string,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = await verifiedPrincipal(this.deps.authority, context, MANAGE_PERMISSION);
    const idempotency = idempotencyKey(key);
    const subscriptionId = pathId(id);
    const { expectedVersion, paymentReference } = this.fundingInput(body);
    const actor: ActorRef = { kind: 'account', id: principal.subject };
    const fingerprint = this.fingerprint({
      operation: OPERATIONS.activate,
      actor: principal.subject,
      subscriptionId,
      expectedVersion,
      paymentReference,
    });
    return this.command(
      principal.subject,
      OPERATIONS.activate,
      idempotency,
      fingerprint,
      async (uow, now) => {
        const locked = await this.lockedForStaff(uow, subscriptionId, principal);
        const period = planActivation(stateOf(locked), expectedVersion, now);
        const updated: SubscriptionRecord = {
          ...locked.subscription,
          status: 'ACTIVE',
          version: locked.subscription.version + 1,
          currentPeriodNo: period.periodNo,
          updatedAt: now,
        };
        const record = await this.grantPeriod(
          uow,
          now,
          actor,
          updated,
          period,
          paymentReference,
          context.correlationId,
        );
        await uow.updateSubscription(updated);
        await this.audit(
          uow,
          now,
          actor,
          'subscription.activated',
          { planCode: updated.planCode, subscriptionId },
          `PERIOD_${period.periodNo}`,
          context.correlationId,
        );
        await this.emitChanged(
          uow,
          now,
          actor,
          locked.subscription.status,
          updated,
          period,
          context.correlationId,
        );
        return { status: 200, body: subscriptionView(updated, record, now, true) };
      },
    );
  }

  /** Staff record a paid renewal: the next period on the revision in force now. */
  async renew(
    context: RequestContext,
    key: unknown,
    id: string,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = await verifiedPrincipal(this.deps.authority, context, MANAGE_PERMISSION);
    const idempotency = idempotencyKey(key);
    const subscriptionId = pathId(id);
    const { expectedVersion, paymentReference } = this.fundingInput(body);
    const actor: ActorRef = { kind: 'account', id: principal.subject };
    const fingerprint = this.fingerprint({
      operation: OPERATIONS.renew,
      actor: principal.subject,
      subscriptionId,
      expectedVersion,
      paymentReference,
    });
    return this.command(
      principal.subject,
      OPERATIONS.renew,
      idempotency,
      fingerprint,
      async (uow, now) => {
        const locked = await this.lockedForStaff(uow, subscriptionId, principal);
        const current = revisionInForce(await uow.revisionsOf(locked.subscription.planCode), now);
        if (!current || !current.terms.available)
          throw new SubscriptionApplicationError('PLAN_NOT_OFFERED');
        const period = planRenewal(stateOf(locked), expectedVersion, current.terms, now);
        const updated: SubscriptionRecord = {
          ...locked.subscription,
          planRevision: current.revision,
          terms: current.terms,
          version: locked.subscription.version + 1,
          currentPeriodNo: period.periodNo,
          updatedAt: now,
        };
        const record = await this.grantPeriod(
          uow,
          now,
          actor,
          updated,
          period,
          paymentReference,
          context.correlationId,
        );
        await uow.updateSubscription(updated);
        await this.audit(
          uow,
          now,
          actor,
          'subscription.renewed',
          { planCode: updated.planCode, subscriptionId },
          `PERIOD_${period.periodNo}`,
          context.correlationId,
        );
        await this.emitChanged(
          uow,
          now,
          actor,
          locked.subscription.status,
          updated,
          period,
          context.correlationId,
        );
        return { status: 200, body: subscriptionView(updated, record, now, true) };
      },
    );
  }

  private async transition(
    context: RequestContext,
    key: unknown,
    id: string,
    body: unknown,
    spec: {
      readonly operation: string;
      readonly keys: readonly string[];
      readonly action: AuditAction;
      readonly apply: (
        locked: LockedSubscription,
        input: Record<string, unknown>,
        expectedVersion: number,
        now: Date,
      ) => SubscriptionRecord;
    },
    principal: VerifiedPrincipal,
    staff: boolean,
  ): Promise<CommandResult> {
    const idempotency = idempotencyKey(key);
    const subscriptionId = pathId(id);
    const input = objectWithKeys(body, ['expectedVersion', ...spec.keys]);
    const expectedVersion = boundedInt(input.expectedVersion, 1, 'expectedVersion');
    const actor: ActorRef = { kind: 'account', id: principal.subject };
    const fingerprint = this.fingerprint({
      operation: spec.operation,
      actor: principal.subject,
      subscriptionId,
      input,
    });
    return this.command(
      principal.subject,
      spec.operation,
      idempotency,
      fingerprint,
      async (uow, now) => {
        let locked: LockedSubscription;
        if (staff) locked = await this.lockedForStaff(uow, subscriptionId, principal);
        else {
          const found = await uow.lockSubscription(subscriptionId);
          if (!found || found.subscription.customerSubject !== principal.subject)
            throw new SubscriptionApplicationError('NOT_FOUND');
          locked = found;
        }
        const updated = spec.apply(locked, input, expectedVersion, now);
        await uow.updateSubscription(updated);
        await this.audit(
          uow,
          now,
          actor,
          spec.action,
          { planCode: updated.planCode, subscriptionId },
          updated.status,
          context.correlationId,
        );
        await this.emitChanged(
          uow,
          now,
          actor,
          locked.subscription.status,
          updated,
          locked.period,
          context.correlationId,
        );
        return { status: 200, body: subscriptionView(updated, locked.period, now, staff) };
      },
    );
  }

  async freeze(
    context: RequestContext,
    key: unknown,
    id: string,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = await verifiedPrincipal(this.deps.authority, context, MANAGE_PERMISSION);
    // Validate the reason before the command so a bad value is a 400, not a receipt.
    const reason = oneOf(
      objectWithKeys(body, ['expectedVersion', 'reason']).reason,
      FREEZE_REASONS,
      'reason',
    );
    return this.transition(
      context,
      key,
      id,
      body,
      {
        operation: OPERATIONS.freeze,
        keys: ['reason'],
        action: 'subscription.frozen',
        apply: (locked, _input, expectedVersion, now) => {
          planFreeze(stateOf(locked), expectedVersion, now);
          return {
            ...locked.subscription,
            status: 'FROZEN',
            freezeReason: reason,
            version: locked.subscription.version + 1,
            updatedAt: now,
          };
        },
      },
      principal,
      true,
    );
  }

  async unfreeze(
    context: RequestContext,
    key: unknown,
    id: string,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = await verifiedPrincipal(this.deps.authority, context, MANAGE_PERMISSION);
    return this.transition(
      context,
      key,
      id,
      body,
      {
        operation: OPERATIONS.unfreeze,
        keys: [],
        action: 'subscription.unfrozen',
        apply: (locked, _input, expectedVersion, now) => {
          planUnfreeze(stateOf(locked), expectedVersion);
          return {
            ...locked.subscription,
            status: 'ACTIVE',
            freezeReason: null,
            version: locked.subscription.version + 1,
            updatedAt: now,
          };
        },
      },
      principal,
      true,
    );
  }

  /** Staff cancel any open subscription; a customer may withdraw only their own unactivated request. */
  async cancel(
    context: RequestContext,
    key: unknown,
    id: string,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = await verifiedPrincipal(this.deps.authority, context);
    const staff = principal.permissions.includes(MANAGE_PERMISSION);
    if (!staff && !principal.permissions.includes(CUSTOMER_PERMISSION))
      throw new SubscriptionApplicationError('AUTH_FORBIDDEN');
    const reason = oneOf(
      objectWithKeys(body, ['expectedVersion', 'reason']).reason,
      CANCEL_REASONS,
      'reason',
    );
    if (!staff && reason !== 'CUSTOMER_REQUEST')
      throw new SubscriptionApplicationError('REQUEST_INVALID', { field: 'reason' });
    return this.transition(
      context,
      key,
      id,
      body,
      {
        operation: OPERATIONS.cancel,
        keys: ['reason'],
        action: 'subscription.cancelled',
        apply: (locked, _input, expectedVersion, now) => {
          planCancel(stateOf(locked), expectedVersion, !staff);
          return {
            ...locked.subscription,
            status: 'CANCELLED',
            cancelReason: reason,
            freezeReason: null,
            version: locked.subscription.version + 1,
            updatedAt: now,
          };
        },
      },
      principal,
      staff,
    );
  }

  // ---------------------------------------------------------------- reads

  async getSubscription(context: RequestContext, id: string): Promise<Record<string, unknown>> {
    const principal = await verifiedPrincipal(this.deps.authority, context);
    const staff = principal.permissions.includes(MANAGE_PERMISSION);
    const subscription = await this.deps.repository.subscription(pathId(id));
    if (!subscription || (!staff && subscription.customerSubject !== principal.subject))
      throw new SubscriptionApplicationError('NOT_FOUND');
    const period = subscription.currentPeriodNo
      ? await this.deps.repository.period(subscription.id, subscription.currentPeriodNo)
      : null;
    return subscriptionView(subscription, period, this.deps.clock.now(), staff);
  }

  private async listViews(
    subject: string,
    staff: boolean,
  ): Promise<{ subscriptions: Record<string, unknown>[] }> {
    const now = this.deps.clock.now();
    const subscriptions = [];
    for (const subscription of await this.deps.repository.subscriptionsOf(subject, 50)) {
      const period = subscription.currentPeriodNo
        ? await this.deps.repository.period(subscription.id, subscription.currentPeriodNo)
        : null;
      subscriptions.push(subscriptionView(subscription, period, now, staff));
    }
    return { subscriptions };
  }

  async mySubscriptions(
    context: RequestContext,
  ): Promise<{ subscriptions: Record<string, unknown>[] }> {
    const principal = await verifiedPrincipal(this.deps.authority, context, CUSTOMER_PERMISSION);
    return this.listViews(principal.subject, false);
  }

  async customerSubscriptions(
    context: RequestContext,
    subject: string,
  ): Promise<{ subscriptions: Record<string, unknown>[] }> {
    await verifiedPrincipal(this.deps.authority, context, MANAGE_PERMISSION);
    return this.listViews(pathId(subject.toLowerCase()), true);
  }
}
