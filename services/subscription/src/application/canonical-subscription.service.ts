import { parsePageRequest, subscriptionV1 } from '@carwash/contracts';
import {
  Money,
  SubscriptionRuleError,
  available,
  grantDelta,
  planActivation,
  planCancel,
  planFreeze,
  planReservation,
  planRenewal,
  planUnfreeze,
  revisionInForce,
  viewStatus,
} from '../domain';
import {
  PurchaseOwnerRefusal,
  type PeriodRecord,
  type LockedSubscription,
  type PlanRevisionRecord,
  type PurchaseOwners,
  type PurchaseRecord,
  type SubscriptionChangeRecord,
  type SubscriptionRecord,
  type SubscriptionUnitOfWork,
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
  pathId,
  verifiedPrincipal,
  type RequestContext,
} from './request-support';
import { SubscriptionApplicationError } from './subscription-errors';
import type { SubscriptionService, SubscriptionDeps } from './subscription.service';
import { requirePeriodFunding } from './period-funding';

const PURCHASE_CREATE_OPERATION = 'subscription.purchase.create.v1';

export class CanonicalSubscriptionService {
  constructor(
    private readonly deps: SubscriptionDeps & {
      readonly owners: PurchaseOwners;
      readonly legacy: SubscriptionService;
    },
  ) {}
  private parse<I, T>(parser: (value: I) => T, value: I): T {
    try {
      return parser(value);
    } catch {
      throw new SubscriptionApplicationError('REQUEST_INVALID');
    }
  }
  private code(id: string): string {
    return `p-${pathId(id)}`;
  }
  private planView(revision: PlanRevisionRecord): subscriptionV1.PlanV1 {
    const planId = revision.planCode.slice(2);
    const body = {
      planId,
      version: revision.revision,
      status: revision.terms.available ? 'PUBLISHED' : 'RETIRED',
      name: revision.terms.displayName,
      units: revision.terms.washUnits,
      validityDays: revision.terms.periodDays,
      price: revision.terms.price.toWire(),
      packageIds: [...revision.terms.coveredPackageIds],
      vehicleTypes: [...(revision.terms.vehicleTypes ?? [])],
      publishedAt: revision.publishedAt.toISOString(),
    };
    return subscriptionV1.parsePlanV1({
      ...body,
      contentHash: this.deps.hasher.sha256Hex(canonicalJson(body)),
    });
  }
  async getPlan(id: string) {
    const current = revisionInForce(
      await this.deps.repository.revisionsOf(this.code(id)),
      this.deps.clock.now(),
    );
    if (!current || !current.terms.vehicleTypes?.length)
      throw new SubscriptionApplicationError('NOT_FOUND');
    return this.planView(current);
  }
  async listPlans(query: { limit?: unknown; cursor?: unknown }) {
    const { limit, cursor } = this.parse(parsePageRequest, query);
    if (cursor) pathId(cursor);
    const codes = await this.deps.repository.canonicalPlanCodes(
      cursor ? this.code(cursor) : null,
      limit + 1,
    );
    const selected = codes.slice(0, limit);
    const items = [];
    for (const code of selected) {
      const current = revisionInForce(
        await this.deps.repository.revisionsOf(code),
        this.deps.clock.now(),
      );
      if (current?.terms.vehicleTypes?.length) items.push(this.planView(current));
    }
    return {
      items,
      nextCursor: codes.length > limit ? (selected.at(-1)?.slice(2) ?? null) : null,
      asOf: this.deps.clock.now().toISOString(),
    };
  }
  async publish(
    context: RequestContext,
    key: unknown,
    id: string,
    body: unknown,
  ): Promise<CommandResult> {
    const planId = pathId(id);
    const input = this.parse(subscriptionV1.parsePublishPlanRequestV1, body);
    const result = await this.deps.legacy.publishRevision(context, key, this.code(planId), {
      expectedRevision: input.expectedRevision,
      effectiveFrom: null,
      terms: {
        displayName: input.name,
        price: input.price,
        washUnits: input.units,
        periodDays: input.validityDays,
        coveredPackageIds: input.packageIds,
        vehicleTypes: input.vehicleTypes,
        available: input.status === 'PUBLISHED',
      },
    });
    if (result.status >= 400) return result;
    const revision = (await this.deps.repository.revisionsOf(this.code(planId))).find(
      (candidate) => candidate.revision === result.body.revision,
    );
    if (!revision) throw new Error('PLAN_RECEIPT_WITHOUT_REVISION');
    return { ...result, body: { ...this.planView(revision) } };
  }
  private purchaseView(purchase: PurchaseRecord): Record<string, unknown> {
    return {
      ...subscriptionV1.parsePurchaseV1({
        purchaseId: purchase.id,
        revision: purchase.revision,
        status: purchase.status,
        beneficiary: { kind: 'account', subjectId: purchase.customerSubject },
        planId: purchase.planId,
        planVersion: purchase.planVersion,
        quoteId: purchase.quoteId,
        total: purchase.amount.toWire(),
        paymentMethod: purchase.paymentMethod,
        obligationId: purchase.obligationId,
        subscriptionId: purchase.status === 'ACTIVATED' ? purchase.subscriptionId : null,
        renewalOf:
          purchase.periodNo > 1
            ? { subscriptionId: purchase.subscriptionId, periodNo: purchase.periodNo }
            : null,
        createdAt: purchase.createdAt.toISOString(),
        updatedAt: purchase.updatedAt.toISOString(),
      }),
    };
  }
  private async changed(
    uow: SubscriptionUnitOfWork,
    record: SubscriptionRecord,
    period: PeriodRecord | null,
    previous: SubscriptionRecord['status'] | null,
    actor: string,
    correlationId: string,
    action:
      | 'subscription.requested'
      | 'subscription.activated'
      | 'subscription.renewed'
      | 'subscription.frozen'
      | 'subscription.unfrozen'
      | 'subscription.cancelled',
  ) {
    const now = this.deps.clock.now();
    await uow.appendAudit({
      id: this.deps.ids.uuid(),
      occurredAt: now,
      actor: { kind: 'account', id: actor },
      action,
      planCode: record.planCode,
      subscriptionId: record.id,
      reservationId: null,
      outcome: record.status,
      correlationId,
    });
    await uow.appendOutbox(
      subscriptionChangedEvent(
        {
          customerSubject: record.customerSubject,
          planCode: record.planCode,
          planRevision: record.planRevision,
          previousStatus: previous,
          status: record.status,
          periodNo: period?.periodNo ?? null,
          periodEndsAt: period?.endsAt.toISOString() ?? null,
          unitsGranted: period?.granted ?? null,
        },
        {
          eventId: this.deps.ids.uuid(),
          occurredAt: now,
          correlationId,
          actor: { kind: 'account', id: actor },
          aggregateId: record.id,
          version: record.version,
        },
      ),
    );
  }
  async createPurchase(
    context: RequestContext,
    rawKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    return this.createPurchaseForPeriod(context, rawKey, body);
  }

  /** Explicit customer purchase of the next period; never an automatic debit or staff settlement. */
  async createRenewal(
    context: RequestContext,
    rawKey: unknown,
    id: string,
    body: unknown,
  ): Promise<CommandResult> {
    const input = this.parse(subscriptionV1.parseCreateRenewalPurchaseRequestV1, body);
    const { expectedRevision, ...purchase } = input;
    return this.createPurchaseForPeriod(context, rawKey, purchase, {
      subscriptionId: pathId(id),
      expectedRevision: boundedInt(expectedRevision, 1, 'expectedRevision'),
    });
  }

  private async createPurchaseForPeriod(
    context: RequestContext,
    rawKey: unknown,
    body: unknown,
    renewal?: { readonly subscriptionId: string; readonly expectedRevision: number },
  ): Promise<CommandResult> {
    const actor = await verifiedPrincipal(this.deps.authority, context, CUSTOMER_PERMISSION);
    if (actor.principalKind !== 'account') throw new SubscriptionApplicationError('AUTH_FORBIDDEN');
    const key = idempotencyKey(rawKey);
    const input = this.parse(subscriptionV1.parseCreatePurchaseRequestV1, body);
    // Units are prepaid. Cash collection for a future wash cannot prove a plan purchase.
    if (input.paymentMethod === 'CASH_ON_COMPLETION')
      throw new SubscriptionApplicationError('REQUEST_INVALID', { field: 'paymentMethod' });
    const fingerprint = this.deps.hasher.sha256Hex(
      canonicalJson(renewal ? { ...input, renewal } : input),
    );
    const result = await receiptCommand({
      repository: this.deps.repository,
      clock: this.deps.clock,
      actor: actor.subject,
      operation: PURCHASE_CREATE_OPERATION,
      key,
      fingerprint,
      work: async (uow, now) => {
        const renewing: LockedSubscription | null = renewal
          ? await uow.lockSubscription(renewal.subscriptionId)
          : null;
        if (
          renewal &&
          (!renewing ||
            renewing.subscription.customerSubject !== actor.subject ||
            renewing.subscription.planCode !== this.code(input.planId) ||
            (await uow.purchaseForPeriod(renewal.subscriptionId, 1))?.status !== 'ACTIVATED')
        )
          throw new SubscriptionApplicationError('NOT_FOUND');
        const prior = await uow.purchaseForQuote(input.quoteId);
        if (prior) {
          if (
            prior.customerSubject !== actor.subject ||
            prior.planId !== input.planId ||
            prior.planVersion !== input.planVersion ||
            prior.paymentMethod !== input.paymentMethod ||
            (renewal
              ? prior.subscriptionId !== renewal.subscriptionId || prior.periodNo < 2
              : prior.periodNo !== 1) ||
            !prior.amount.equals(Money.parse(input.total))
          )
            throw new SubscriptionApplicationError('IDEMPOTENCY_CONFLICT');
          return { status: 200, body: this.purchaseView(prior) };
        }
        const current = revisionInForce(await uow.revisionsOf(this.code(input.planId)), now);
        if (!current?.terms.available || !current.terms.vehicleTypes?.length)
          throw new SubscriptionApplicationError('PLAN_NOT_OFFERED');
        if (current.revision !== input.planVersion)
          throw new SubscriptionApplicationError('REVISION_CONFLICT');
        if (renewal && renewing) {
          const next = planRenewal(
            {
              status: renewing.subscription.status,
              version: renewing.subscription.version,
              terms: renewing.subscription.terms,
              currentPeriod: renewing.period,
            },
            renewal.expectedRevision,
            current.terms,
            now,
          );
          if (await uow.purchaseForPeriod(renewal.subscriptionId, next.periodNo))
            throw new SubscriptionApplicationError('PURCHASE_NOT_ACTIVATABLE');
        }
        let quote;
        try {
          quote = await this.deps.owners.quote(
            input.quoteId,
            context.credential ?? '',
            context.correlationId,
          );
        } catch (error) {
          if (error instanceof PurchaseOwnerRefusal)
            throw new SubscriptionApplicationError('QUOTE_MISMATCH');
          throw new SubscriptionApplicationError('FUNDING_UNAVAILABLE');
        }
        if (
          !quote ||
          quote.quoteId !== input.quoteId ||
          quote.planId !== input.planId ||
          quote.planVersion !== input.planVersion ||
          quote.customerSubject !== actor.subject ||
          quote.expiresAt.getTime() <= now.getTime() ||
          !quote.amount.equals(current.terms.price) ||
          !quote.amount.equals(Money.parse(input.total))
        )
          throw new SubscriptionApplicationError('QUOTE_MISMATCH');
        const subscription: SubscriptionRecord = renewing?.subscription ?? {
          id: this.deps.ids.uuid(),
          customerSubject: actor.subject,
          planCode: current.planCode,
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
        const purchase: PurchaseRecord = {
          id: this.deps.ids.uuid(),
          customerSubject: actor.subject,
          subscriptionId: subscription.id,
          periodNo: renewing ? (renewing.subscription.currentPeriodNo ?? 0) + 1 : 1,
          planId: input.planId,
          planVersion: input.planVersion,
          quoteId: input.quoteId,
          amount: quote.amount,
          paymentMethod: input.paymentMethod,
          status: 'PENDING_PAYMENT',
          revision: 1,
          obligationId: null,
          createdAt: now,
          updatedAt: now,
        };
        if (!renewing) await uow.insertSubscription(subscription);
        await uow.insertPurchase(purchase);
        if (renewing)
          await uow.appendAudit({
            id: this.deps.ids.uuid(),
            occurredAt: now,
            actor: { kind: 'account', id: actor.subject },
            action: 'subscription.renewal-requested',
            planCode: subscription.planCode,
            subscriptionId: subscription.id,
            reservationId: null,
            outcome: `PERIOD_${purchase.periodNo}`,
            correlationId: context.correlationId,
          });
        else
          await this.changed(
            uow,
            subscription,
            null,
            null,
            actor.subject,
            context.correlationId,
            'subscription.requested',
          );
        return { status: 201, body: this.purchaseView(purchase) };
      },
    });
    if (result.status >= 400) return result;
    const purchase = await this.getPurchase(context, String(result.body.purchaseId));
    return { ...result, body: purchase };
  }
  /** Recover an accepted purchase without asking the account to persist its financial command. */
  async getPurchaseByRequest(
    context: RequestContext,
    rawKey: unknown,
  ): Promise<Record<string, unknown>> {
    const actor = await verifiedPrincipal(this.deps.authority, context, CUSTOMER_PERMISSION);
    if (actor.principalKind !== 'account') throw new SubscriptionApplicationError('AUTH_FORBIDDEN');
    const key = idempotencyKey(rawKey);
    const receipt = await this.deps.repository.findReceipt(
      actor.subject,
      PURCHASE_CREATE_OPERATION,
      key,
    );
    if (
      !receipt ||
      receipt.outcome.status >= 400 ||
      typeof receipt.outcome.body.purchaseId !== 'string'
    )
      throw new SubscriptionApplicationError('NOT_FOUND');
    // The receipt is scoped to the current account and operation. Read current
    // owner state rather than returning the stale creation snapshot; this also
    // resumes the already accepted fixed-key Billing command after a lost reply.
    return this.getPurchase(context, receipt.outcome.body.purchaseId);
  }
  async getPurchase(context: RequestContext, id: string): Promise<Record<string, unknown>> {
    const actor = await verifiedPrincipal(this.deps.authority, context, CUSTOMER_PERMISSION);
    const purchase = await this.deps.repository.purchase(pathId(id));
    if (
      !purchase ||
      actor.principalKind !== 'account' ||
      purchase.customerSubject !== actor.subject
    )
      throw new SubscriptionApplicationError('NOT_FOUND');
    if (['ACTIVATED', 'REJECTED', 'EXPIRED'].includes(purchase.status))
      return this.purchaseView(purchase);
    let obligation;
    try {
      obligation = purchase.obligationId
        ? await this.deps.owners.obligation(
            purchase.obligationId,
            context.credential ?? '',
            context.correlationId,
          )
        : await this.deps.owners.createObligation(
            purchase.quoteId,
            purchase.paymentMethod,
            context.credential ?? '',
            `subscription-${purchase.id.replaceAll('-', '')}`,
            context.correlationId,
          );
    } catch (error) {
      // Even a definite refusal after a partially completed create+method flow
      // cannot prove no debt exists. Retain the durable purchase for exact replay.
      if (error instanceof PurchaseOwnerRefusal) return this.purchaseView(purchase);
      throw new SubscriptionApplicationError('FUNDING_UNAVAILABLE');
    }
    if (obligation.quoteId !== purchase.quoteId || !obligation.amount.equals(purchase.amount))
      throw new SubscriptionApplicationError('FUNDING_UNAVAILABLE');
    const funding =
      obligation.status === 'SETTLED'
        ? await this.deps.funding.claim({
            obligationId: obligation.obligationId,
            subscriptionId: purchase.subscriptionId,
            periodNo: purchase.periodNo,
            customerSubject: purchase.customerSubject,
            amount: purchase.amount,
            quoteId: purchase.quoteId,
            correlationId: context.correlationId,
          })
        : 'NOT_VERIFIED';
    if (funding === 'UNAVAILABLE') throw new SubscriptionApplicationError('FUNDING_UNAVAILABLE');
    return this.deps.repository.transaction(async (uow) => {
      const current = await uow.lockPurchase(purchase.id);
      if (!current) throw new SubscriptionApplicationError('NOT_FOUND');
      if (['ACTIVATED', 'REJECTED', 'EXPIRED'].includes(current.status))
        return this.purchaseView(current);
      if (current.obligationId !== null && current.obligationId !== obligation.obligationId)
        throw new SubscriptionApplicationError('FUNDING_UNAVAILABLE');
      const now = this.deps.clock.now();
      const locked = await uow.lockSubscription(current.subscriptionId);
      if (!locked || locked.subscription.customerSubject !== actor.subject)
        throw new SubscriptionApplicationError('NOT_FOUND');
      if (locked.subscription.status === 'CANCELLED') {
        const rejected: PurchaseRecord = {
          ...current,
          status: 'REJECTED',
          obligationId: obligation.obligationId,
          revision: current.revision + 1,
          updatedAt: now,
        };
        await uow.updatePurchase(rejected);
        return this.purchaseView(rejected);
      }
      let status: PurchaseRecord['status'] =
        obligation.financialStatus === 'UNDER_REVIEW'
          ? 'PAYMENT_UNDER_REVIEW'
          : obligation.financialStatus === 'OUTCOME_UNKNOWN'
            ? 'PAYMENT_UNKNOWN'
            : 'PENDING_PAYMENT';
      if (funding === 'CLAIMED') {
        const plan = (await uow.revisionsOf(locked.subscription.planCode)).find(
          (r) => r.revision === current.planVersion,
        );
        if (!plan || !plan.terms.price.equals(current.amount))
          throw new SubscriptionApplicationError('FUNDING_UNAVAILABLE');
        const state = {
          status: locked.subscription.status,
          version: locked.subscription.version,
          terms: locked.subscription.terms,
          currentPeriod: locked.period,
        };
        const periodState =
          current.periodNo === 1
            ? planActivation(state, locked.subscription.version, now)
            : planRenewal(state, locked.subscription.version, plan.terms, now);
        if (periodState.periodNo !== current.periodNo)
          throw new SubscriptionApplicationError('REVISION_CONFLICT');
        const period: PeriodRecord = {
          ...periodState,
          subscriptionId: current.subscriptionId,
          planRevision: current.planVersion,
          paymentReference: obligation.obligationId,
          grantedBy: actor.subject,
          grantedAt: now,
        };
        await uow.insertPeriod(period);
        const delta = grantDelta(period.granted);
        await uow.appendMovement({
          id: this.deps.ids.uuid(),
          subscriptionId: current.subscriptionId,
          periodNo: period.periodNo,
          reservationId: null,
          kind: 'GRANT',
          granted: delta.granted,
          reserved: 0,
          consumed: 0,
          occurredAt: now,
          actor: { kind: 'account', id: actor.subject },
          correlationId: context.correlationId,
        });
        const active: SubscriptionRecord = {
          ...locked.subscription,
          status: 'ACTIVE',
          version: locked.subscription.version + 1,
          currentPeriodNo: period.periodNo,
          planRevision: current.planVersion,
          terms: plan.terms,
          updatedAt: now,
        };
        await uow.updateSubscription(active);
        await this.changed(
          uow,
          active,
          period,
          locked.subscription.status,
          actor.subject,
          context.correlationId,
          current.periodNo === 1 ? 'subscription.activated' : 'subscription.renewed',
        );
        status = 'ACTIVATED';
      }
      if (current.status === status && current.obligationId === obligation.obligationId)
        return this.purchaseView(current);
      const updated: PurchaseRecord = {
        ...current,
        status,
        obligationId: obligation.obligationId,
        revision: current.revision + 1,
        updatedAt: now,
      };
      await uow.updatePurchase(updated);
      return this.purchaseView(updated);
    });
  }
  subscriptionView(
    record: SubscriptionRecord,
    period: PeriodRecord,
    purchase: PurchaseRecord,
  ): Record<string, unknown> {
    const status = viewStatus(
      {
        status: record.status,
        version: record.version,
        terms: record.terms,
        currentPeriod: period,
      },
      this.deps.clock.now(),
    );
    return {
      ...subscriptionV1.parseSubscriptionV1({
        subscriptionId: record.id,
        revision: record.version,
        status: status === 'ACTIVE' && period.consumed === period.granted ? 'EXHAUSTED' : status,
        beneficiary: { kind: 'account', subjectId: record.customerSubject },
        planId: purchase.planId,
        planVersion: record.planRevision,
        purchaseId: purchase.id,
        periodNo: period.periodNo,
        renewalAvailable:
          record.status === 'ACTIVE' && this.deps.clock.now().getTime() >= period.endsAt.getTime(),
        units: {
          total: period.granted,
          reserved: period.reserved,
          consumed: period.consumed,
          available: available(period),
        },
        startsAt: period.startsAt.toISOString(),
        expiresAt: period.endsAt.toISOString(),
        frozenAt: status === 'FROZEN' ? record.updatedAt.toISOString() : null,
        cancelledAt: status === 'CANCELLED' ? record.updatedAt.toISOString() : null,
        updatedAt: record.updatedAt.toISOString(),
      }),
    };
  }
  async getSubscription(context: RequestContext, id: string) {
    const actor = await verifiedPrincipal(this.deps.authority, context);
    const subscriptionId = pathId(id);
    return this.deps.repository.transaction(async (uow) => {
      const locked = await uow.lockSubscription(subscriptionId);
      if (
        !locked?.period ||
        (actor.subject !== locked.subscription.customerSubject &&
          !actor.permissions.includes(MANAGE_PERMISSION))
      )
        throw new SubscriptionApplicationError('NOT_FOUND');
      const purchase = await uow.purchaseForPeriod(subscriptionId, locked.period.periodNo);
      if (purchase?.status !== 'ACTIVATED') throw new SubscriptionApplicationError('NOT_FOUND');
      return this.subscriptionView(locked.subscription, locked.period, purchase);
    });
  }
  async listSubscriptions(context: RequestContext, query: { limit?: unknown; cursor?: unknown }) {
    const actor = await verifiedPrincipal(this.deps.authority, context, CUSTOMER_PERMISSION);
    const { limit, cursor } = this.parse(parsePageRequest, query);
    if (cursor) pathId(cursor);
    const records = await this.deps.repository.canonicalSubscriptionsOf(
      actor.subject,
      cursor,
      limit + 1,
    );
    const selected = records.slice(0, limit);
    return {
      items: await Promise.all(selected.map((record) => this.getSubscription(context, record.id))),
      nextCursor: records.length > limit ? (selected.at(-1)?.id ?? null) : null,
      asOf: this.deps.clock.now().toISOString(),
    };
  }

  async eligibility(context: RequestContext, id: string, body: unknown) {
    const actor = await verifiedPrincipal(this.deps.authority, context, CUSTOMER_PERMISSION);
    const subscriptionId = pathId(id);
    const input = this.parse(subscriptionV1.parseCheckEligibilityRequestV1, body);
    const purchase = await this.deps.repository.purchaseForSubscription(subscriptionId);
    if (
      !purchase ||
      purchase.status !== 'ACTIVATED' ||
      actor.principalKind !== 'account' ||
      purchase.customerSubject !== actor.subject
    )
      throw new SubscriptionApplicationError('NOT_FOUND');
    return this.deps.repository.transaction(async (uow) => {
      const locked = await uow.lockSubscription(subscriptionId);
      if (!locked?.period) throw new SubscriptionApplicationError('NOT_FOUND');
      const now = this.deps.clock.now();
      let reason: subscriptionV1.EligibilityReason | null = null;
      try {
        if (!locked.subscription.terms.vehicleTypes?.includes(input.vehicleType))
          throw new SubscriptionRuleError('PACKAGE_NOT_COVERED');
        planReservation({
          state: {
            status: locked.subscription.status,
            version: locked.subscription.version,
            terms: locked.subscription.terms,
            currentPeriod: locked.period,
          },
          packageId: input.packageId,
          scheduledFor: new Date(input.scheduledFor),
          now,
        });
      } catch (error) {
        if (!(error instanceof SubscriptionRuleError)) throw error;
        const allowed = subscriptionV1.ELIGIBILITY_REASONS.find(
          (candidate) => candidate === error.code,
        );
        if (!allowed) throw error;
        reason = allowed;
      }
      if (reason === null)
        await requirePeriodFunding(
          this.deps.funding,
          uow,
          locked.subscription,
          locked.period,
          context.correlationId,
        );
      return subscriptionV1.parseEligibilityV1({
        subscriptionId,
        revision: locked.subscription.version,
        eligible: reason === null,
        reason,
        checkedAt: now.toISOString(),
      });
    });
  }

  async requestChange(
    context: RequestContext,
    rawKey: unknown,
    id: string,
    body: unknown,
  ): Promise<CommandResult> {
    const actor = await verifiedPrincipal(this.deps.authority, context);
    const subscriptionId = pathId(id);
    const key = idempotencyKey(rawKey);
    const input = this.parse(subscriptionV1.parseRequestSubscriptionChangeV1, body);
    const purchase = await this.deps.repository.purchaseForSubscription(subscriptionId);
    if (
      !purchase ||
      purchase.status !== 'ACTIVATED' ||
      actor.principalKind !== 'account' ||
      (purchase.customerSubject !== actor.subject && !actor.permissions.includes(MANAGE_PERMISSION))
    )
      throw new SubscriptionApplicationError('NOT_FOUND');
    return receiptCommand({
      repository: this.deps.repository,
      clock: this.deps.clock,
      actor: actor.subject,
      operation: 'subscription.change.request.v1',
      key,
      fingerprint: this.deps.hasher.sha256Hex(canonicalJson({ subscriptionId, ...input })),
      work: async (uow, now) => {
        const locked = await uow.lockSubscription(subscriptionId);
        if (!locked?.period) throw new SubscriptionApplicationError('NOT_FOUND');
        const currentPurchase = await uow.purchaseForPeriod(subscriptionId, locked.period.periodNo);
        if (currentPurchase?.status !== 'ACTIVATED')
          throw new SubscriptionApplicationError('NOT_FOUND');
        if (locked.subscription.version !== input.expectedRevision)
          throw new SubscriptionApplicationError('VERSION_CONFLICT');
        if (locked.subscription.status === 'CANCELLED')
          throw new SubscriptionApplicationError('SUBSCRIPTION_CLOSED');
        const change: SubscriptionChangeRecord = {
          id: this.deps.ids.uuid(),
          subscriptionId,
          expectedRevision: input.expectedRevision,
          action: input.action,
          reason: input.reason,
          requestedBy: actor.subject,
          requestedAt: now,
          status: 'PENDING_REVIEW',
          decidedBy: null,
          decidedAt: null,
        };
        await uow.insertChange(change);
        await uow.appendAudit({
          id: this.deps.ids.uuid(),
          occurredAt: now,
          actor: { kind: 'account', id: actor.subject },
          action: 'subscription.change-requested',
          planCode: locked.subscription.planCode,
          subscriptionId,
          reservationId: null,
          outcome: input.action,
          correlationId: context.correlationId,
        });
        return {
          status: 201,
          body: {
            changeId: change.id,
            action: change.action,
            status: change.status,
            effectiveAt: null,
            subscription: this.subscriptionView(
              locked.subscription,
              locked.period,
              currentPurchase,
            ),
          },
        };
      },
    });
  }

  async pendingChanges(context: RequestContext) {
    await verifiedPrincipal(this.deps.authority, context, MANAGE_PERMISSION);
    return {
      items: (await this.deps.repository.pendingChanges(100)).map((row) => ({
        changeId: row.id,
        subscriptionId: row.subscriptionId,
        expectedRevision: row.expectedRevision,
        action: row.action,
        reason: row.reason,
        requestedAt: row.requestedAt.toISOString(),
        status: row.status,
      })),
    };
  }

  async fundingRecoveries(context: RequestContext) {
    await verifiedPrincipal(this.deps.authority, context, MANAGE_PERMISSION);
    return {
      items: await this.deps.repository.fundingRecoveries(100),
      asOf: this.deps.clock.now().toISOString(),
    };
  }

  async retryFundingRelease(
    context: RequestContext,
    rawKey: unknown,
    id: string,
    body: unknown,
  ): Promise<CommandResult> {
    const actor = await verifiedPrincipal(this.deps.authority, context, MANAGE_PERMISSION);
    const subscriptionId = pathId(id);
    const { expectedAttempts } = this.parse(
      subscriptionV1.parseFundingRecoveryRetryRequestV1,
      body,
    );
    return receiptCommand({
      repository: this.deps.repository,
      clock: this.deps.clock,
      actor: actor.subject,
      operation: 'subscription.funding-release.retry.v1',
      key: idempotencyKey(rawKey),
      fingerprint: this.deps.hasher.sha256Hex(canonicalJson({ subscriptionId, expectedAttempts })),
      work: async (uow, now) => {
        const locked = await uow.lockSubscription(subscriptionId);
        if (!locked) throw new SubscriptionApplicationError('NOT_FOUND');
        if (locked.subscription.status !== 'CANCELLED')
          throw new SubscriptionApplicationError('REVISION_CONFLICT');
        const queued = await uow.retryFundingRelease(subscriptionId, expectedAttempts, now);
        if (!queued) throw new SubscriptionApplicationError('REVISION_CONFLICT');
        await uow.appendAudit({
          id: this.deps.ids.uuid(),
          occurredAt: now,
          actor: { kind: 'account', id: actor.subject },
          action: 'subscription.funding-release-retried',
          planCode: locked.subscription.planCode,
          subscriptionId,
          reservationId: null,
          outcome: `ATTEMPT_${expectedAttempts}`,
          correlationId: context.correlationId,
        });
        return { status: 200, body: { subscriptionId, ...queued, status: 'PENDING' } };
      },
    });
  }

  async decideChange(
    context: RequestContext,
    rawKey: unknown,
    id: string,
    changeId: string,
    body: unknown,
  ): Promise<CommandResult> {
    const actor = await verifiedPrincipal(this.deps.authority, context, MANAGE_PERMISSION);
    const subscriptionId = pathId(id);
    const targetId = pathId(changeId);
    const key = idempotencyKey(rawKey);
    const input = objectWithKeys(body, ['approve']);
    if (typeof input.approve !== 'boolean')
      throw new SubscriptionApplicationError('REQUEST_INVALID');
    const purchase = await this.deps.repository.purchaseForSubscription(subscriptionId);
    if (!purchase || purchase.status !== 'ACTIVATED')
      throw new SubscriptionApplicationError('NOT_FOUND');
    if (actor.subject === purchase.customerSubject)
      throw new SubscriptionApplicationError('SELF_SERVICE_FORBIDDEN');
    return receiptCommand({
      repository: this.deps.repository,
      clock: this.deps.clock,
      actor: actor.subject,
      operation: 'subscription.change.decide.v1',
      key,
      fingerprint: this.deps.hasher.sha256Hex(
        canonicalJson({ subscriptionId, changeId: targetId, approve: input.approve }),
      ),
      work: async (uow, now) => {
        const request = await uow.lockChange(targetId);
        if (!request || request.subscriptionId !== subscriptionId)
          throw new SubscriptionApplicationError('NOT_FOUND');
        if (request.status !== 'PENDING_REVIEW')
          throw new SubscriptionApplicationError('REVISION_CONFLICT');
        const locked = await uow.lockSubscription(subscriptionId);
        if (!locked?.period) throw new SubscriptionApplicationError('NOT_FOUND');
        const currentPurchase = await uow.purchaseForPeriod(subscriptionId, locked.period.periodNo);
        if (currentPurchase?.status !== 'ACTIVATED')
          throw new SubscriptionApplicationError('NOT_FOUND');
        let subscription = locked.subscription;
        if (input.approve) {
          const state = {
            status: subscription.status,
            version: subscription.version,
            terms: subscription.terms,
            currentPeriod: locked.period,
          };
          if (request.action === 'FREEZE') planFreeze(state, request.expectedRevision, now);
          else if (request.action === 'RESUME') planUnfreeze(state, request.expectedRevision);
          else planCancel(state, request.expectedRevision, false);
          subscription = {
            ...subscription,
            status:
              request.action === 'FREEZE'
                ? 'FROZEN'
                : request.action === 'RESUME'
                  ? 'ACTIVE'
                  : 'CANCELLED',
            version: subscription.version + 1,
            updatedAt: now,
            freezeReason: request.action === 'FREEZE' ? 'CUSTOMER_REQUEST' : null,
            cancelReason: request.action === 'CANCEL' ? 'CUSTOMER_REQUEST' : null,
          };
          await uow.updateSubscription(subscription);
          await this.changed(
            uow,
            subscription,
            locked.period,
            locked.subscription.status,
            actor.subject,
            context.correlationId,
            request.action === 'FREEZE'
              ? 'subscription.frozen'
              : request.action === 'RESUME'
                ? 'subscription.unfrozen'
                : 'subscription.cancelled',
          );
        } else
          await uow.appendAudit({
            id: this.deps.ids.uuid(),
            occurredAt: now,
            actor: { kind: 'account', id: actor.subject },
            action: 'subscription.change-rejected',
            planCode: subscription.planCode,
            subscriptionId,
            reservationId: null,
            outcome: request.action,
            correlationId: context.correlationId,
          });
        const status = input.approve ? ('APPLIED' as const) : ('REJECTED' as const);
        await uow.updateChange({ ...request, status, decidedBy: actor.subject, decidedAt: now });
        return {
          status: 200,
          body: {
            changeId: request.id,
            action: request.action,
            status,
            effectiveAt: input.approve ? now.toISOString() : null,
            subscription: this.subscriptionView(subscription, locked.period, currentPurchase),
          },
        };
      },
    });
  }
}
