import { HttpClient, type ApiResult, type FetchLike, type RequestSpec } from '@carwash/api-clients';
import { apiError, parsePage, type PrincipalRef } from '@carwash/contracts/common';
import type { IdentitySessionView } from '@carwash/contracts/identity-v1';
import {
  parseCreateSubscriptionQuoteV1,
  parseSubscriptionQuoteV1,
  type SubscriptionQuoteV1,
} from '@carwash/contracts/pricing-v1';
import {
  parsePlanV1,
  parsePurchaseV1,
  parseSubscriptionV1,
  parseCreatePurchaseRequestV1,
  parseCreateRenewalPurchaseRequestV1,
  parseRequestSubscriptionChangeV1,
  parseSubscriptionChangeV1,
  type PlanV1,
  type PurchaseV1,
  type SubscriptionV1,
  type SubscriptionChangeV1,
  type SubscriptionChangeAction,
} from '@carwash/contracts/subscription-v1';
import {
  parseObligationV1,
  parseSubmitAttemptRequestV1,
  type ObligationV1,
} from '@carwash/contracts/billing-v1';
import { currentInstant } from '../shared/clock.ts';

export type MembershipOperation = 'quote' | 'purchase' | 'payment-attempt' | 'change';
export interface MembershipSnapshot {
  readonly principal: PrincipalRef | null;
  readonly plans: readonly PlanV1[];
  readonly plansStatus: 'idle' | 'loading' | 'available' | 'unavailable';
  readonly plansCursor: string | null;
  readonly subscriptions: readonly SubscriptionV1[];
  readonly subscriptionsStatus: 'idle' | 'loading' | 'available' | 'unavailable';
  readonly subscriptionsCursor: string | null;
  readonly selectedPlan: PlanV1 | null;
  readonly renewalTarget: {
    readonly subscriptionId: string;
    readonly expectedRevision: number;
    readonly periodNo: number;
  } | null;
  readonly quote: SubscriptionQuoteV1 | null;
  readonly purchase: PurchaseV1 | null;
  readonly purchaseStatus: 'idle' | 'loading' | 'available' | 'unavailable';
  readonly obligation: ObligationV1 | null;
  readonly change: SubscriptionChangeV1 | null;
  readonly busy: boolean;
  readonly pending: MembershipOperation | null;
  readonly unknownPurchaseKey: string | null;
  readonly problem: string | null;
}
interface Store {
  read(subjectId: string): {
    readonly pendingKey: string | null;
    readonly purchaseId: string | null;
  };
  write(
    subjectId: string,
    value: { readonly pendingKey: string | null; readonly purchaseId: string | null },
  ): void;
}
interface Options {
  readonly origin: string;
  readonly fetch: FetchLike;
  readonly csrf: () => string;
  readonly newKey: () => string;
  readonly now?: () => number;
  readonly recovery?: Store;
}
const empty = (): MembershipSnapshot => ({
  principal: null,
  plans: [],
  plansStatus: 'idle',
  plansCursor: null,
  subscriptions: [],
  subscriptionsStatus: 'idle',
  subscriptionsCursor: null,
  selectedPlan: null,
  renewalTarget: null,
  quote: null,
  purchase: null,
  purchaseStatus: 'idle',
  obligation: null,
  change: null,
  busy: false,
  pending: null,
  unknownPurchaseKey: null,
  problem: null,
});
const sameOwner = (a: PrincipalRef, b: PrincipalRef): boolean =>
  a.kind === b.kind && a.subjectId === b.subjectId;
const opaque = (value: string | null): string | null =>
  value && /^[A-Za-z0-9_-]{16,128}$/.test(value) ? value : null;
const isId = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const isMembershipId = isId;
function message(result: ApiResult<unknown>): string | null {
  if (result.ok) return null;
  if (result.error.code === 'OUTCOME_UNKNOWN')
    return 'لم تُحسم نتيجة الطلب. أعد إرسال الطلب نفسه أو تحقّق من الشراء السابق قبل بدء طلب آخر.';
  if (result.status === 401) return 'انتهت الجلسة. سجّل الدخول من بياناتي ثم أعد القراءة.';
  if (result.status === 403) return 'لا يسمح هذا الحساب بإجراء الاشتراك المطلوب.';
  if (result.status === 409 || result.status === 412)
    return 'تغيرت الخطة أو الاستحقاقات. حدّث البيانات وراجع الاختيار.';
  if (result.status === 400 || result.status === 422)
    return 'راجع الاختيار والحقول؛ لم يعتمد النظام هذا الطلب.';
  if (result.status === 404)
    return 'لم يُعثر على السجل في هذا الحساب. نتيجة الطلب السابق قد تحتاج إعادة التحقق.';
  return 'تعذرت قراءة الجهة المالكة. أعد المحاولة لاحقًا.';
}
function unavailable(): ApiResult<never> {
  return {
    ok: false,
    status: 409,
    error: apiError('CONFLICT', 'CONFLICT', {
      requestId: 'membership',
      correlationId: 'membership',
    }).error,
  };
}

export class ProductionMembership {
  private readonly options: Options;
  private readonly client: HttpClient;
  private readonly publicClient: HttpClient;
  private readonly now: () => number;
  private snapshot = empty();
  private readonly listeners = new Set<() => void>();
  private identity: string | null = null;
  private epoch = 0;
  private purchaseSequence = 0;
  private subscriptionsSequence = 0;
  private command: {
    readonly operation: MembershipOperation;
    readonly spec: RequestSpec<unknown>;
    readonly apply: (value: unknown) => void;
    readonly epoch: number;
  } | null = null;
  constructor(options: Options) {
    this.options = options;
    const baseUrl = `${new URL(options.origin).origin}/api/v1`;
    this.client = new HttpClient({
      baseUrl,
      fetch: options.fetch,
      credentials: 'same-origin',
      timeoutMs: 10000,
      headers: () => ({ 'x-csrf-token': options.csrf() }),
    });
    this.publicClient = new HttpClient({
      baseUrl,
      fetch: options.fetch,
      credentials: 'omit',
      timeoutMs: 10000,
    });
    this.now = options.now ?? (() => currentInstant().getTime());
  }
  readonly getSnapshot = (): MembershipSnapshot => this.snapshot;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private patch(value: Partial<MembershipSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...value };
    for (const listener of this.listeners) listener();
  }
  bindSession(session: IdentitySessionView | null): void {
    const identity =
      session?.principalKind === 'account'
        ? `${session.subject}:${session.sessionId}:${session.authVersion}`
        : null;
    if (identity === this.identity) return;
    this.identity = identity;
    this.epoch++;
    this.purchaseSequence++;
    this.subscriptionsSequence++;
    this.command = null;
    const principal: PrincipalRef | null =
      identity && session ? { kind: 'account', subjectId: session.subject } : null;
    const { plans, plansStatus, plansCursor } = this.snapshot;
    this.patch({ ...empty(), principal, plans, plansStatus, plansCursor });
    if (principal) {
      let saved;
      try {
        saved = this.options.recovery?.read(principal.subjectId);
      } catch {
        /* Opaque recovery is optional when browser storage is disabled. */
      }
      const key = opaque(saved?.pendingKey ?? null);
      if (key) {
        this.patch({ unknownPurchaseKey: key });
        void this.recoverPurchase();
      } else if (saved?.purchaseId && isId(saved.purchaseId))
        void this.loadPurchase(saved.purchaseId);
    }
  }
  private own<T extends { readonly beneficiary: PrincipalRef }>(value: T): T {
    if (!this.snapshot.principal || !sameOwner(value.beneficiary, this.snapshot.principal))
      throw new Error('membership beneficiary');
    return value;
  }
  private persist(pendingKey: string | null, purchaseId: string | null): void {
    const principal = this.snapshot.principal;
    if (!principal) return;
    try {
      this.options.recovery?.write(principal.subjectId, { pendingKey, purchaseId });
    } catch {
      /* Never fall back to storing credentials or financial payloads. */
    }
  }
  private canWrite(): boolean {
    return Boolean(
      this.snapshot.principal &&
      !this.snapshot.busy &&
      !this.command &&
      !this.snapshot.unknownPurchaseKey,
    );
  }
  async loadPlans(more = false): Promise<void> {
    if (this.snapshot.plansStatus === 'loading' || (more && !this.snapshot.plansCursor)) return;
    const cursor = this.snapshot.plansCursor;
    this.patch({ plansStatus: 'loading' });
    const result = await this.publicClient.request({
      method: 'GET',
      path: '/customer/subscription-plans',
      query: { limit: 50, ...(more ? { cursor: cursor! } : {}) },
      parse: (value) => {
        const page = parsePage(value, '$', parsePlanV1);
        if (new Set(page.items.map((item) => item.planId)).size !== page.items.length)
          throw new Error('duplicate plan');
        return page;
      },
    });
    this.patch({
      plansStatus: result.ok ? 'available' : 'unavailable',
      ...(result.ok
        ? {
            plans: more
              ? [
                  ...this.snapshot.plans,
                  ...result.value.items.filter(
                    (item) =>
                      !this.snapshot.plans.some((existing) => existing.planId === item.planId),
                  ),
                ]
              : result.value.items,
            plansCursor: result.value.nextCursor,
          }
        : { plans: more ? this.snapshot.plans : [], problem: message(result) }),
    });
  }
  async loadSubscriptions(more = false): Promise<void> {
    if (
      !this.snapshot.principal ||
      this.snapshot.busy ||
      this.snapshot.subscriptionsStatus === 'loading' ||
      (more && !this.snapshot.subscriptionsCursor)
    )
      return;
    const epoch = this.epoch,
      sequence = ++this.subscriptionsSequence,
      cursor = this.snapshot.subscriptionsCursor;
    this.patch({ subscriptionsStatus: 'loading' });
    const result = await this.client.request({
      method: 'GET',
      path: '/customer/subscriptions',
      query: { limit: 50, ...(more ? { cursor: cursor! } : {}) },
      parse: (value) => {
        const page = parsePage(value, '$', parseSubscriptionV1);
        for (const item of page.items) this.own(item);
        if (new Set(page.items.map((item) => item.subscriptionId)).size !== page.items.length)
          throw new Error('duplicate subscription');
        return page;
      },
    });
    if (epoch !== this.epoch || sequence !== this.subscriptionsSequence) return;
    this.patch({
      subscriptionsStatus: result.ok ? 'available' : 'unavailable',
      ...(result.ok
        ? {
            subscriptions: more
              ? [
                  ...this.snapshot.subscriptions,
                  ...result.value.items.filter(
                    (item) =>
                      !this.snapshot.subscriptions.some(
                        (existing) => existing.subscriptionId === item.subscriptionId,
                      ),
                  ),
                ]
              : result.value.items,
            subscriptionsCursor: result.value.nextCursor,
          }
        : { problem: message(result) }),
    });
  }
  async choosePlan(planId: string): Promise<boolean> {
    return this.quotePlan(planId, null);
  }
  canRenew(subscription: SubscriptionV1): boolean {
    return (
      this.snapshot.principal !== null &&
      sameOwner(subscription.beneficiary, this.snapshot.principal) &&
      subscription.renewalAvailable &&
      subscription.status === 'EXPIRED' &&
      Date.parse(subscription.expiresAt) <= this.now()
    );
  }
  async chooseRenewal(subscriptionId: string): Promise<boolean> {
    if (!this.canWrite() || this.snapshot.subscriptionsStatus !== 'available') return false;
    const subscription = this.snapshot.subscriptions.find(
      (item) => item.subscriptionId === subscriptionId,
    );
    if (!subscription || !this.canRenew(subscription)) return false;
    return this.quotePlan(subscription.planId, {
      subscriptionId,
      expectedRevision: subscription.revision,
      periodNo: subscription.periodNo + 1,
    });
  }
  private async quotePlan(
    planId: string,
    renewalTarget: MembershipSnapshot['renewalTarget'],
  ): Promise<boolean> {
    if (!this.canWrite()) return false;
    const plan = this.snapshot.plans.find(
      (item) => item.planId === planId && item.status === 'PUBLISHED',
    );
    if (!plan) return false;
    this.patch({ selectedPlan: plan, renewalTarget, quote: null });
    const body = parseCreateSubscriptionQuoteV1({ planId: plan.planId, planVersion: plan.version });
    const result = await this.mutate(
      'quote',
      {
        method: 'POST',
        path: '/customer/subscription-quotes',
        body,
        parse: (value) => {
          const quote = this.own(parseSubscriptionQuoteV1(value));
          if (
            quote.planId !== plan.planId ||
            quote.planVersion !== plan.version ||
            quote.planContentHash !== plan.contentHash ||
            quote.status !== 'USABLE' ||
            Date.parse(quote.expiresAt) <= this.now()
          )
            throw new Error('subscription quote context');
          return quote;
        },
      },
      (quote) => this.patch({ quote }),
    );
    return result.ok;
  }
  async purchase(method: 'SHAM_CASH' | 'SYRIATEL_CASH'): Promise<boolean> {
    const { quote, selectedPlan, renewalTarget } = this.snapshot;
    if (
      !this.canWrite() ||
      !quote ||
      !selectedPlan ||
      quote.status !== 'USABLE' ||
      Date.parse(quote.expiresAt) <= this.now()
    ) {
      this.patch({ problem: 'انتهت صلاحية السعر أو لم تُحسم عملية سابقة. اطلب عرض سعر حديثًا.' });
      return false;
    }
    const purchaseBody = parseCreatePurchaseRequestV1({
      planId: quote.planId,
      planVersion: quote.planVersion,
      quoteId: quote.quoteId,
      total: quote.total,
      paymentMethod: method,
    });
    const body = renewalTarget
      ? parseCreateRenewalPurchaseRequestV1({
          ...purchaseBody,
          expectedRevision: renewalTarget.expectedRevision,
        })
      : purchaseBody;
    const key = this.options.newKey();
    this.persist(key, this.snapshot.purchase?.purchaseId ?? null);
    const result = await this.mutate(
      'purchase',
      {
        method: 'POST',
        path: renewalTarget
          ? `/customer/subscriptions/${renewalTarget.subscriptionId}/renewals`
          : '/customer/subscription-purchases',
        body,
        idempotencyKey: key,
        parse: (value) => {
          const purchase = this.own(parsePurchaseV1(value));
          if (
            purchase.planId !== quote.planId ||
            purchase.planVersion !== quote.planVersion ||
            purchase.quoteId !== quote.quoteId ||
            purchase.total.amountMinor !== quote.total.amountMinor ||
            purchase.total.currency !== quote.total.currency ||
            purchase.total.scale !== quote.total.scale ||
            purchase.paymentMethod !== method ||
            (renewalTarget
              ? purchase.renewalOf?.subscriptionId !== renewalTarget.subscriptionId ||
                purchase.renewalOf.periodNo !== renewalTarget.periodNo
              : purchase.renewalOf !== null)
          )
            throw new Error('subscription purchase context');
          return purchase;
        },
      },
      (purchase) => this.acceptPurchase(purchase),
    );
    if (!result.ok && result.error.code !== 'OUTCOME_UNKNOWN')
      this.persist(null, this.snapshot.purchase?.purchaseId ?? null);
    return result.ok;
  }
  private acceptPurchase(purchase: PurchaseV1): void {
    this.persist(null, purchase.purchaseId);
    this.patch({
      purchase,
      purchaseStatus: 'available',
      obligation: null,
      unknownPurchaseKey: null,
      selectedPlan: null,
      renewalTarget: null,
      quote: null,
      problem: null,
    });
  }
  async recoverPurchase(): Promise<void> {
    const key = this.snapshot.unknownPurchaseKey;
    if (!key || !this.snapshot.principal || this.snapshot.busy) return;
    const epoch = this.epoch,
      sequence = ++this.purchaseSequence;
    this.patch({ purchaseStatus: 'loading' });
    const result = await this.client.request({
      method: 'GET',
      path: `/customer/subscription-purchases/by-request/${encodeURIComponent(key)}`,
      parse: (value) => this.own(parsePurchaseV1(value)),
    });
    if (epoch !== this.epoch || sequence !== this.purchaseSequence) return;
    if (result.ok) {
      this.command = null;
      this.patch({ pending: null });
      this.acceptPurchase(result.value);
    } else this.patch({ purchaseStatus: 'unavailable', problem: message(result) });
  }
  async loadPurchase(purchaseId: string): Promise<void> {
    if (
      !this.snapshot.principal ||
      !isId(purchaseId) ||
      this.snapshot.busy ||
      this.snapshot.pending ||
      this.snapshot.unknownPurchaseKey
    )
      return;
    const epoch = this.epoch,
      sequence = ++this.purchaseSequence;
    this.patch({
      purchaseStatus: 'loading',
      ...(this.snapshot.purchase?.purchaseId === purchaseId
        ? {}
        : { purchase: null, obligation: null }),
    });
    const result = await this.client.request({
      method: 'GET',
      path: `/customer/subscription-purchases/${purchaseId}`,
      parse: (value) => {
        const purchase = this.own(parsePurchaseV1(value));
        if (purchase.purchaseId !== purchaseId) throw new Error('purchase identity');
        return purchase;
      },
    });
    if (epoch !== this.epoch || sequence !== this.purchaseSequence) return;
    if (!result.ok) {
      this.patch({ purchaseStatus: 'unavailable', problem: message(result) });
      return;
    }
    this.patch({
      purchase: result.value,
      purchaseStatus: 'available',
      problem: null,
      obligation:
        this.snapshot.obligation?.obligationId === result.value.obligationId
          ? this.snapshot.obligation
          : null,
    });
    this.persist(this.snapshot.unknownPurchaseKey, purchaseId);
    if (result.value.obligationId) {
      const purchase = result.value;
      const obligation = await this.client.request({
        method: 'GET',
        path: `/customer/payments/${purchase.obligationId}`,
        parse: (value) => {
          const read = parseObligationV1(value);
          if (
            read.obligationId !== purchase.obligationId ||
            read.quoteId !== purchase.quoteId ||
            read.amount.currency !== purchase.total.currency ||
            read.amount.amountMinor !== purchase.total.amountMinor ||
            read.amount.scale !== purchase.total.scale
          )
            throw new Error('purchase obligation');
          return read;
        },
      });
      if (epoch === this.epoch && sequence === this.purchaseSequence)
        this.patch({
          obligation: obligation.ok ? obligation.value : null,
          ...(!obligation.ok ? { problem: message(obligation) } : {}),
        });
    }
  }
  async submitReference(providerReference: string): Promise<boolean> {
    const { obligation, purchase } = this.snapshot;
    if (
      !this.canWrite() ||
      !obligation ||
      !purchase ||
      purchase.obligationId !== obligation.obligationId ||
      purchase.status === 'ACTIVATED' ||
      obligation.financialStatus !== 'AWAITING_PAYMENT'
    )
      return false;
    let body;
    try {
      body = parseSubmitAttemptRequestV1({
        expectedRevision: obligation.revision,
        providerReference: providerReference.trim(),
      });
    } catch {
      this.patch({ problem: 'راجع رقم العملية؛ من 4 إلى 64 حرفًا أو رقمًا.' });
      return false;
    }
    const result = await this.mutate(
      'payment-attempt',
      {
        method: 'POST',
        path: `/customer/payments/${obligation.obligationId}/transaction-reference`,
        body,
        parse: (value) => {
          const read = parseObligationV1(value);
          if (
            read.obligationId !== obligation.obligationId ||
            read.quoteId !== obligation.quoteId ||
            read.amount.amountMinor !== obligation.amount.amountMinor ||
            read.amount.currency !== obligation.amount.currency ||
            read.amount.scale !== obligation.amount.scale
          )
            throw new Error('payment reference context');
          return read;
        },
      },
      (obligation) => this.patch({ obligation }),
    );
    return result.ok;
  }
  async requestChange(subscriptionId: string, action: SubscriptionChangeAction): Promise<boolean> {
    if (!this.canWrite()) return false;
    const subscription = this.snapshot.subscriptions.find(
      (item) => item.subscriptionId === subscriptionId,
    );
    if (!subscription) return false;
    const body = parseRequestSubscriptionChangeV1({
      expectedRevision: subscription.revision,
      action,
      reason: 'CUSTOMER_REQUEST',
    });
    const result = await this.mutate(
      'change',
      {
        method: 'POST',
        path: `/customer/subscriptions/${subscriptionId}/changes`,
        body,
        parse: (value) => {
          const change = parseSubscriptionChangeV1(value);
          this.own(change.subscription);
          if (change.subscription.subscriptionId !== subscriptionId || change.action !== action)
            throw new Error('subscription change context');
          return change;
        },
      },
      (change) =>
        this.patch({
          change,
          subscriptions: this.snapshot.subscriptions.map((item) =>
            item.subscriptionId === subscriptionId ? change.subscription : item,
          ),
        }),
    );
    return result.ok;
  }
  async retryPending(): Promise<void> {
    if (this.command && !this.snapshot.busy) await this.execute();
  }
  private async mutate<T>(
    operation: MembershipOperation,
    spec: RequestSpec<T>,
    apply: (value: T) => void,
  ): Promise<ApiResult<T>> {
    if (!this.canWrite()) return unavailable();
    this.command = {
      operation,
      spec: {
        ...spec,
        idempotencyKey: spec.idempotencyKey ?? this.options.newKey(),
      } as RequestSpec<unknown>,
      apply: apply as (value: unknown) => void,
      epoch: this.epoch,
    };
    return this.execute() as Promise<ApiResult<T>>;
  }
  private async execute(): Promise<ApiResult<unknown>> {
    const command = this.command;
    if (!command || command.epoch !== this.epoch) return unavailable();
    this.purchaseSequence++;
    this.subscriptionsSequence++;
    this.patch({
      busy: true,
      pending: command.operation,
      problem: null,
      ...(this.snapshot.purchaseStatus === 'loading'
        ? { purchaseStatus: this.snapshot.purchase ? 'available' : 'idle' }
        : {}),
      ...(this.snapshot.subscriptionsStatus === 'loading' ? { subscriptionsStatus: 'idle' } : {}),
    });
    let result = await this.client.request(command.spec);
    if (!result.ok && result.status >= 500)
      result = { ...result, error: { ...result.error, code: 'OUTCOME_UNKNOWN' } };
    if (command.epoch !== this.epoch) return unavailable();
    if (result.ok) {
      this.command = null;
      this.patch({ busy: false, pending: null });
      command.apply(result.value);
    } else if (result.error.code === 'OUTCOME_UNKNOWN')
      this.patch({
        busy: false,
        problem: message(result),
        ...(command.operation === 'purchase'
          ? { unknownPurchaseKey: command.spec.idempotencyKey ?? null }
          : {}),
      });
    else {
      this.command = null;
      this.patch({ busy: false, pending: null, problem: message(result) });
    }
    return result;
  }
}
