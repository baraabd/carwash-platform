import { HttpClient, type ApiResult, type FetchLike, type RequestSpec } from '@carwash/api-clients';
import {
  apiError,
  parseCoordinates,
  parsePage,
  type PrincipalRef,
  type PaymentMethod,
  type VehicleType,
} from '@carwash/contracts/common';
import { parseCatalogV1, type CatalogV1 } from '@carwash/contracts/catalog-v1';
import { parseQuoteRequestV1, parseQuoteV1, type QuoteV1 } from '@carwash/contracts/pricing-v1';
import {
  parseServiceabilityDecisionV1,
  type ServiceabilityDecisionV1,
} from '@carwash/contracts/geo-v1';
import {
  parseAvailabilityV1,
  parseHoldV1,
  type AvailabilityV1,
  type HoldV1,
} from '@carwash/contracts/scheduling-v1';
import {
  parseObligationV1,
  parseInitializePaymentRequestV1,
  parseSubmitAttemptRequestV1,
  parseObligationRefundsV1,
  type ObligationV1,
  type ObligationRefundsV1,
} from '@carwash/contracts/billing-v1';
import { parseVehicleInputV1, type VehicleV1 } from '@carwash/contracts/vehicle-v1';
import type { AddressV1 } from '@carwash/contracts/customer-v1';
import type { IdentitySessionView } from '@carwash/contracts/identity-v1';
import {
  parseSubscriptionV1,
  parseEligibilityV1,
  parseCheckEligibilityRequestV1,
  type SubscriptionV1,
} from '@carwash/contracts/subscription-v1';
import { currentInstant } from '../shared/clock.ts';
import {
  parseProductionBooking,
  parseProductionBookings,
  parseBookingChange,
  parseBookingChanges,
  type ProductionBooking,
  type ProductionBookingChange,
} from './productionBookingContracts.ts';

type VehicleSelection =
  | {
      readonly source: 'saved';
      readonly vehicleId: string;
      readonly revision: number;
      readonly type: VehicleType;
      readonly model: string | null;
      readonly color: string | null;
      readonly plate: string;
    }
  | {
      readonly source: 'inline';
      readonly type: VehicleType;
      readonly model: string | null;
      readonly color: string | null;
      readonly plate: string;
    };

export interface ProductionBookingDraft {
  readonly vehicle: VehicleSelection;
  readonly packageId: string | null;
  readonly extras: readonly string[];
  readonly address: AddressV1 | null;
  readonly contact: { readonly name: string; readonly phone: string; readonly notes: string };
  readonly paymentMethod: PaymentMethod | null;
  readonly subscription: {
    readonly subscriptionId: string;
    readonly expectedRevision: number;
  } | null;
}
export type JourneyOperation =
  'quote' | 'hold' | 'release' | 'booking' | 'cancellation' | 'payment-method' | 'payment-attempt';
export interface ProductionBookingSnapshot {
  readonly principal: PrincipalRef | null;
  readonly catalog: CatalogV1 | null;
  readonly catalogStatus: 'loading' | 'available' | 'unavailable';
  readonly draft: ProductionBookingDraft;
  readonly quote: QuoteV1 | null;
  readonly serviceability: ServiceabilityDecisionV1 | null;
  readonly availability: AvailabilityV1 | null;
  readonly earliestAvailability: AvailabilityV1 | null;
  readonly earliestStatus: 'idle' | 'loading' | 'available' | 'unavailable';
  readonly hold: HoldV1 | null;
  readonly subscriptions: readonly SubscriptionV1[];
  readonly subscriptionsStatus: 'idle' | 'loading' | 'available' | 'unavailable';
  readonly subscriptionsCursor: string | null;
  readonly bookings: readonly ProductionBooking[];
  readonly bookingsStatus: 'idle' | 'loading' | 'available' | 'unavailable';
  readonly nextCursor: string | null;
  readonly selectedBooking: ProductionBooking | null;
  readonly handoffBookingId: string | null;
  readonly detailStatus: 'idle' | 'loading' | 'available' | 'unavailable' | 'missing';
  readonly obligation: ObligationV1 | null;
  readonly refunds: ObligationRefundsV1 | null;
  readonly paymentStatus: 'idle' | 'loading' | 'available' | 'unavailable';
  readonly changes: readonly ProductionBookingChange[];
  readonly busy: boolean;
  readonly loading: boolean;
  readonly pending: JourneyOperation | null;
  readonly unknownCreateKey: string | null;
  readonly problem: string | null;
}

interface RecoveryStore {
  read(principal: PrincipalRef): string | null;
  write(principal: PrincipalRef, key: string): void;
  clear(principal: PrincipalRef): void;
}
interface Options {
  readonly origin: string;
  readonly fetch: FetchLike;
  readonly csrf: () => string;
  readonly newKey: () => string;
  readonly now?: () => number;
  /** Only an opaque create key. Never contact, location, password, OTP or tokens. */
  readonly recovery?: RecoveryStore;
}
interface Pending {
  readonly operation: JourneyOperation;
  readonly spec: RequestSpec<unknown>;
  readonly apply: (value: unknown) => void;
  readonly epoch: number;
}
function blankDraft(): ProductionBookingDraft {
  return {
    vehicle: { source: 'inline', type: 'sedan', model: null, color: null, plate: '' },
    packageId: null,
    extras: [],
    address: null,
    contact: { name: '', phone: '', notes: '' },
    paymentMethod: null,
    subscription: null,
  };
}
function empty(): ProductionBookingSnapshot {
  return {
    principal: null,
    catalog: null,
    catalogStatus: 'loading',
    draft: blankDraft(),
    quote: null,
    serviceability: null,
    availability: null,
    earliestAvailability: null,
    earliestStatus: 'idle',
    hold: null,
    subscriptions: [],
    subscriptionsStatus: 'idle',
    subscriptionsCursor: null,
    bookings: [],
    bookingsStatus: 'idle',
    nextCursor: null,
    selectedBooking: null,
    handoffBookingId: null,
    detailStatus: 'idle',
    obligation: null,
    refunds: null,
    paymentStatus: 'idle',
    changes: [],
    busy: false,
    loading: false,
    pending: null,
    unknownCreateKey: null,
    problem: null,
  };
}
function failure<T>(
  code: Parameters<typeof apiError>[0] = 'REQUEST_INVALID',
  status = 400,
): ApiResult<T> {
  return {
    ok: false,
    status,
    error: apiError(code, code, {
      requestId: 'customer-journey',
      correlationId: 'customer-journey',
    }).error,
  };
}
function samePrincipal(a: PrincipalRef, b: PrincipalRef): boolean {
  return a.kind === b.kind && a.subjectId === b.subjectId;
}
function problemFor(result: ApiResult<unknown>): string | null {
  if (result.ok) return null;
  if (result.error.code === 'OUTCOME_UNKNOWN')
    return 'لم نتأكد من نتيجة الطلب. أعد المحاولة بالطلب نفسه أو تحقّق من حجوزاتك قبل أي طلب جديد.';
  if (result.status === 401) return 'انتهت الجلسة. سجّل الدخول أو استعد جلسة الضيف للمتابعة.';
  if (result.status === 409 || result.status === 412)
    return 'تغيّرت البيانات أو لم يعد الاختيار متاحًا. أعد تحميل أحدث البيانات قبل المتابعة.';
  if (result.status === 429) return 'انتظر قليلًا قبل المحاولة مجددًا.';
  if (result.status === 400 || result.status === 422)
    return 'راجع بياناتك واختيارات الحجز قبل المتابعة.';
  return 'تعذّر الوصول إلى الخدمة. لم نفترض نجاح الطلب. حاول مجددًا.';
}

/** Owner-backed journey. All mutations are single-flight and explicitly replay the exact key/body. */
export class ProductionBookingClient {
  private snapshot = empty();
  private readonly listeners = new Set<() => void>();
  private readonly client: HttpClient;
  private readonly publicClient: HttpClient;
  private pending: Pending | null = null;
  private epoch = 0;
  private identityKey: string | null = null;
  private readSequence = 0;
  private availabilitySequence = 0;
  private earliestSequence = 0;
  private detailSequence = 0;
  private paymentSequence = 0;
  private readonly now: () => number;
  private readonly options: Options;
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
  readonly getSnapshot = (): ProductionBookingSnapshot => this.snapshot;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private patch(values: Partial<ProductionBookingSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...values };
    for (const listener of this.listeners) listener();
  }
  bindSession(session: IdentitySessionView | null): void {
    const identity = session
      ? `${session.principalKind}:${session.subject}:${session.sessionId}:${session.authVersion}`
      : null;
    if (identity === this.identityKey) return;
    ++this.epoch;
    this.pending = null;
    this.identityKey = identity;
    const principal = session ? { kind: session.principalKind, subjectId: session.subject } : null;
    let recovery: string | null = null;
    if (principal) {
      try {
        recovery = this.options.recovery?.read(principal) ?? null;
      } catch {
        /* storage may be disabled */
      }
      if (recovery && !/^[A-Za-z0-9_-]{16,128}$/.test(recovery)) recovery = null;
    }
    this.patch({
      ...empty(),
      catalog: this.snapshot.catalog,
      catalogStatus: this.snapshot.catalogStatus,
      principal,
      unknownCreateKey: recovery,
    });
    if (recovery) void this.recoverCreate();
  }
  private own(booking: ProductionBooking): ProductionBooking {
    if (!this.snapshot.principal || !samePrincipal(booking.beneficiary, this.snapshot.principal))
      throw new Error('foreign booking');
    return booking;
  }
  async loadCatalog(): Promise<void> {
    const result = await this.publicClient.request({
      method: 'GET',
      path: '/customer/packages',
      parse: parseCatalogV1,
    });
    this.patch({
      catalog: result.ok ? result.value : null,
      catalogStatus: result.ok ? 'available' : 'unavailable',
    });
  }
  private canEdit(): boolean {
    return (
      !this.snapshot.busy &&
      !this.snapshot.loading &&
      !this.pending &&
      !this.snapshot.unknownCreateKey
    );
  }
  setContact(contact: ProductionBookingDraft['contact']): void {
    if (this.canEdit()) this.patch({ draft: { ...this.snapshot.draft, contact }, problem: null });
  }
  setPaymentMethod(paymentMethod: PaymentMethod): void {
    if (this.canEdit())
      this.patch({
        draft: { ...this.snapshot.draft, paymentMethod, subscription: null },
        problem: null,
      });
  }
  async selectVehicle(vehicle: VehicleSelection): Promise<boolean> {
    if (JSON.stringify(vehicle) === JSON.stringify(this.snapshot.draft.vehicle)) return true;
    if (!this.canEdit() || !(await this.releaseHold()) || !this.canEdit()) return false;
    try {
      parseVehicleInputV1({
        type: vehicle.type,
        make: null,
        model: vehicle.model,
        color: vehicle.color,
        nickname: null,
        plate: vehicle.plate.trim() ? { text: vehicle.plate, region: null } : null,
      });
    } catch {
      this.patch({ problem: 'راجع بيانات السيارة. اللوحة اختيارية، وبحد أقصى 12 حرفًا.' });
      return false;
    }
    this.patch({
      draft: { ...this.snapshot.draft, vehicle, packageId: null, extras: [], subscription: null },
      quote: null,
      availability: null,
      problem: null,
    });
    return true;
  }
  async selectSavedVehicle(vehicle: VehicleV1): Promise<boolean> {
    return this.selectVehicle({
      source: 'saved',
      vehicleId: vehicle.vehicleId,
      revision: vehicle.revision,
      type: vehicle.type,
      model: vehicle.nickname ?? vehicle.model,
      color: vehicle.color,
      plate: vehicle.plate?.text ?? '',
    });
  }
  async selectCare(packageId: string, extras: readonly string[] = []): Promise<boolean> {
    if (!this.canEdit() || !(await this.releaseHold()) || !this.canEdit()) return false;
    const items = this.snapshot.catalog?.items ?? [];
    const type = this.snapshot.draft.vehicle.type;
    const available = (id: string, kind: 'PACKAGE' | 'EXTRA') =>
      items.some(
        (item) =>
          item.definitionId === id &&
          item.kind === kind &&
          item.status === 'PUBLISHED' &&
          item.vehicleTypes.includes(type),
      );
    if (
      !available(packageId, 'PACKAGE') ||
      new Set(extras).size !== extras.length ||
      extras.some((id) => !available(id, 'EXTRA'))
    )
      return false;
    this.patch({
      draft: { ...this.snapshot.draft, packageId, extras: [...extras], subscription: null },
      quote: null,
      availability: null,
      problem: null,
    });
    return (await this.quote()) !== null;
  }
  async selectAddress(address: AddressV1): Promise<boolean> {
    if (!this.canEdit() || !(await this.releaseHold()) || !this.canEdit()) return false;
    this.patch({
      draft: { ...this.snapshot.draft, address, subscription: null },
      quote: null,
      serviceability: null,
      availability: null,
      problem: null,
    });
    if (address.location.mode !== 'coordinates') {
      this.patch({
        problem:
          'هذا العنوان محفوظ نصيًا. حدّد الإحداثيات للتحقق من وصول الخدمة قبل اختيار الموعد.',
      });
      return false;
    }
    const epoch = this.epoch;
    const point = parseCoordinates(address.location.point, '$.point');
    this.patch({ loading: true });
    const result = await this.client.request({
      method: 'POST',
      path: '/customer/serviceability',
      safe: true,
      body: { point },
      parse: parseServiceabilityDecisionV1,
    });
    if (epoch !== this.epoch) return false;
    this.patch({ loading: false });
    if (!result.ok) {
      this.patch({ problem: problemFor(result) });
      return false;
    }
    const decision = result.value;
    if (
      decision.point.latitude !== point.latitude ||
      decision.point.longitude !== point.longitude ||
      Date.parse(decision.expiresAt) <= this.now()
    ) {
      this.patch({ problem: 'تعذّر التحقق من صلاحية نتيجة تغطية العنوان.' });
      return false;
    }
    this.patch({ serviceability: decision });
    if (decision.decision !== 'SERVICEABLE') {
      this.patch({
        problem:
          decision.decision === 'OUTSIDE_ZONE'
            ? 'العنوان خارج نطاق الخدمة الحالي. اختر عنوانًا آخر.'
            : 'تعذّر تحديد تغطية هذا العنوان. حاول لاحقًا.',
      });
      return false;
    }
    return (await this.quote()) !== null;
  }
  async quote(): Promise<QuoteV1 | null> {
    const { principal, draft, serviceability } = this.snapshot;
    if (!principal || !draft.packageId || !this.canEdit()) return null;
    const zoneId =
      serviceability?.decision === 'SERVICEABLE' &&
      Date.parse(serviceability.expiresAt) > this.now()
        ? serviceability.zoneId
        : null;
    const body = parseQuoteRequestV1({
      beneficiary: principal,
      vehicleType: draft.vehicle.type,
      zoneId,
      selections: [draft.packageId, ...draft.extras].map((definitionId) => ({
        definitionId,
        quantity: 1,
      })),
    });
    const result = await this.mutate(
      'quote',
      {
        method: 'POST',
        path: '/customer/quotes',
        body,
        parse: (value) => {
          const quote = parseQuoteV1(value);
          const selected = quote.lines.filter(
            (line) => line.kind === 'PACKAGE' || line.kind === 'EXTRA',
          );
          if (
            !samePrincipal(quote.beneficiary, principal) ||
            quote.vehicleType !== draft.vehicle.type ||
            quote.zoneId !== zoneId ||
            quote.status !== 'USABLE' ||
            Date.parse(quote.expiresAt) <= this.now() ||
            selected.length !== body.selections.length ||
            body.selections.some(
              (selection) =>
                !selected.some(
                  (line) =>
                    line.definitionId === selection.definitionId &&
                    line.quantity === selection.quantity,
                ),
            )
          )
            throw new Error('quote context');
          return quote;
        },
      },
      (quote) =>
        this.patch({
          quote,
          availability: null,
          earliestAvailability: null,
          earliestStatus: 'idle',
        }),
    );
    return result.ok ? result.value : null;
  }
  async loadAvailability(date: string): Promise<void> {
    const { quote, serviceability } = this.snapshot;
    if (
      !quote ||
      !serviceability?.zoneId ||
      serviceability.decision !== 'SERVICEABLE' ||
      Date.parse(quote.expiresAt) <= this.now()
    ) {
      this.patch({ problem: 'حدّث عرض السعر وتغطية العنوان قبل اختيار الموعد.' });
      return;
    }
    const epoch = this.epoch,
      sequence = ++this.availabilitySequence;
    this.patch({ loading: true, availability: null, problem: null });
    const result = await this.publicClient.request({
      method: 'GET',
      path: '/customer/availability',
      query: { zoneId: serviceability.zoneId, date, durationMinutes: quote.durationMinutes },
      parse: parseAvailabilityV1,
    });
    if (epoch !== this.epoch || sequence !== this.availabilitySequence) return;
    const correct =
      result.ok &&
      result.value.zoneId === serviceability.zoneId &&
      result.value.date === date &&
      result.value.durationMinutes === quote.durationMinutes;
    this.patch({
      loading: false,
      availability: correct && result.ok ? result.value : null,
      problem: correct
        ? null
        : result.ok
          ? 'تعذّر مطابقة المواعيد مع اختيارك.'
          : problemFor(result),
    });
  }
  async loadEarliest(): Promise<void> {
    const { quote, serviceability } = this.snapshot;
    if (
      !quote ||
      serviceability?.decision !== 'SERVICEABLE' ||
      !serviceability.zoneId ||
      Date.parse(quote.expiresAt) <= this.now() ||
      Date.parse(serviceability.expiresAt) <= this.now()
    )
      return;
    const epoch = this.epoch,
      sequence = ++this.earliestSequence;
    this.patch({ earliestStatus: 'loading', earliestAvailability: null });
    const result = await this.publicClient.request({
      method: 'GET',
      path: '/customer/availability/earliest',
      query: { zoneId: serviceability.zoneId, durationMinutes: quote.durationMinutes },
      parse: (value) => {
        const read = parseAvailabilityV1(value);
        if (read.zoneId !== serviceability.zoneId || read.durationMinutes !== quote.durationMinutes)
          throw new Error('earliest context');
        return read;
      },
    });
    if (
      epoch !== this.epoch ||
      sequence !== this.earliestSequence ||
      this.snapshot.quote?.quoteId !== quote.quoteId ||
      this.snapshot.serviceability?.decisionId !== serviceability.decisionId
    )
      return;
    this.patch({
      earliestStatus: result.ok ? 'available' : 'unavailable',
      earliestAvailability: result.ok ? result.value : null,
    });
  }
  async chooseEarliest(): Promise<HoldV1 | null> {
    const { earliestAvailability, earliestStatus } = this.snapshot;
    if (
      !this.canEdit() ||
      earliestStatus !== 'available' ||
      !earliestAvailability?.earliest ||
      Date.parse(earliestAvailability.earliest.startsAt) <= this.now()
    )
      return null;
    this.patch({ availability: earliestAvailability });
    return this.chooseSlot(earliestAvailability.earliest.startsAt);
  }
  async chooseSlot(startsAt: string): Promise<HoldV1 | null> {
    if (!this.canEdit() || !(await this.releaseHold()) || !this.canEdit()) return null;
    const { principal, quote, availability, serviceability } = this.snapshot;
    if (
      !principal ||
      !quote ||
      !serviceability?.zoneId ||
      availability?.zoneId !== serviceability.zoneId ||
      availability.durationMinutes !== quote.durationMinutes ||
      !availability?.slots.some((slot) => slot.startsAt === startsAt) ||
      Date.parse(startsAt) <= this.now() ||
      Date.parse(quote.expiresAt) <= this.now() ||
      Date.parse(serviceability.expiresAt) <= this.now()
    ) {
      this.patch({
        problem: 'انتهت صلاحية السعر أو الموعد. حدّث البيانات ثم اختر الموعد من جديد.',
      });
      return null;
    }
    const body = {
      beneficiary: principal,
      zoneId: serviceability.zoneId,
      startsAt,
      durationMinutes: quote.durationMinutes,
      quoteRef: { quoteId: quote.quoteId, revision: quote.revision },
    };
    const result = await this.mutate(
      'hold',
      {
        method: 'POST',
        path: '/customer/booking-holds',
        body,
        parse: (value) => {
          const hold = parseHoldV1(value);
          if (
            !samePrincipal(hold.beneficiary, principal) ||
            hold.zoneId !== body.zoneId ||
            hold.startsAt !== startsAt ||
            Date.parse(hold.endsAt) - Date.parse(hold.startsAt) !==
              quote.durationMinutes * 60_000 ||
            hold.quoteRef.quoteId !== quote.quoteId ||
            hold.quoteRef.revision !== quote.revision ||
            hold.state !== 'HELD' ||
            Date.parse(hold.expiresAt) <= this.now()
          )
            throw new Error('hold context');
          return hold;
        },
      },
      (hold) => this.patch({ hold, draft: { ...this.snapshot.draft, subscription: null } }),
    );
    return result.ok ? result.value : null;
  }
  async releaseHold(): Promise<boolean> {
    const hold = this.snapshot.hold;
    if (!hold || hold.state !== 'HELD') return true;
    if (!this.canEdit()) return false;
    if (Date.parse(hold.expiresAt) <= this.now()) {
      this.patch({ hold: null, draft: { ...this.snapshot.draft, subscription: null } });
      return true;
    }
    const result = await this.mutate(
      'release',
      {
        method: 'POST',
        path: `/customer/booking-holds/${hold.holdId}/release`,
        body: { expectedRevision: hold.revision, reason: 'CUSTOMER_CHANGED' },
        parse: (value) => {
          const released = parseHoldV1(value);
          if (
            released.holdId !== hold.holdId ||
            !samePrincipal(released.beneficiary, hold.beneficiary) ||
            !['RELEASED', 'EXPIRED'].includes(released.state)
          )
            throw new Error('hold release');
          return released;
        },
      },
      () => this.patch({ hold: null, draft: { ...this.snapshot.draft, subscription: null } }),
    );
    return result.ok;
  }
  async loadSubscriptions(more = false): Promise<void> {
    const { principal, subscriptionsCursor, subscriptionsStatus } = this.snapshot;
    if (
      principal?.kind !== 'account' ||
      subscriptionsStatus === 'loading' ||
      (more && !subscriptionsCursor)
    )
      return;
    const epoch = this.epoch;
    this.patch({ subscriptionsStatus: 'loading' });
    const result = await this.client.request({
      method: 'GET',
      path: '/customer/subscriptions',
      query: { limit: 50, ...(more ? { cursor: subscriptionsCursor! } : {}) },
      parse: (value) => {
        const page = parsePage(value, '$', parseSubscriptionV1);
        if (
          page.items.some((item) => !samePrincipal(item.beneficiary, principal)) ||
          new Set(page.items.map((item) => item.subscriptionId)).size !== page.items.length
        )
          throw new Error('subscription owner');
        return page;
      },
    });
    if (epoch !== this.epoch) return;
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
        : { problem: problemFor(result) }),
    });
  }
  async selectSubscription(subscriptionId: string): Promise<boolean> {
    const { principal, draft, quote, hold, subscriptions } = this.snapshot;
    if (
      !this.canEdit() ||
      principal?.kind !== 'account' ||
      !hold ||
      !quote ||
      !draft.packageId ||
      !subscriptions.some((item) => item.subscriptionId === subscriptionId)
    )
      return false;
    if (
      quote.lines.length !== 1 ||
      quote.lines[0]?.kind !== 'PACKAGE' ||
      quote.lines[0]?.quantity !== 1 ||
      draft.extras.length
    ) {
      this.patch({
        problem: 'تغطية الاشتراك متاحة لباقة واحدة دون إضافات. عدّل العناية أو اختر طريقة دفع.',
      });
      return false;
    }
    const epoch = this.epoch;
    const body = parseCheckEligibilityRequestV1({
      packageId: draft.packageId,
      vehicleType: draft.vehicle.type,
      scheduledFor: hold.startsAt,
    });
    this.patch({ loading: true, problem: null, draft: { ...draft, subscription: null } });
    const result = await this.client.request({
      method: 'POST',
      path: `/customer/subscriptions/${subscriptionId}/eligibility`,
      safe: true,
      body,
      parse: (value) => {
        const eligibility = parseEligibilityV1(value);
        if (eligibility.subscriptionId !== subscriptionId) throw new Error('eligibility context');
        return eligibility;
      },
    });
    if (epoch !== this.epoch) return false;
    this.patch({ loading: false });
    if (!result.ok) {
      this.patch({ problem: problemFor(result) });
      return false;
    }
    if (!result.value.eligible) {
      const reason = {
        SUBSCRIPTION_NOT_ACTIVE: 'هذا الاشتراك غير نشط.',
        SUBSCRIPTION_FROZEN: 'هذا الاشتراك مجمّد.',
        PERIOD_ENDED: 'انتهت فترة الاشتراك.',
        SCHEDULE_OUTSIDE_PERIOD: 'الموعد خارج فترة الاشتراك.',
        PACKAGE_NOT_COVERED: 'هذه العناية أو السيارة غير مشمولة بالاشتراك.',
        ENTITLEMENT_EXHAUSTED: 'لا توجد غسلات متاحة في الاشتراك.',
      };
      this.patch({
        problem: result.value.reason ? reason[result.value.reason] : 'تعذّر اعتماد تغطية الاشتراك.',
      });
      return false;
    }
    this.patch({
      draft: {
        ...this.snapshot.draft,
        paymentMethod: null,
        subscription: { subscriptionId, expectedRevision: result.value.revision },
      },
      problem: null,
    });
    return true;
  }
  prerequisites(): number {
    const { draft, quote, hold, serviceability } = this.snapshot;
    if (!draft.packageId) return 1;
    if (
      !draft.address ||
      !serviceability ||
      serviceability.decision !== 'SERVICEABLE' ||
      Date.parse(serviceability.expiresAt) <= this.now()
    )
      return 2;
    if (
      !quote ||
      quote.status !== 'USABLE' ||
      Date.parse(quote.expiresAt) <= this.now() ||
      quote.zoneId !== serviceability.zoneId
    )
      return 2;
    if (!hold || hold.state !== 'HELD' || Date.parse(hold.expiresAt) <= this.now()) return 3;
    if (!normalizeContact(draft.contact)) return 4;
    if (!draft.paymentMethod && !draft.subscription) return 5;
    return 6;
  }
  async confirm(): Promise<ProductionBooking | null> {
    const { principal, draft, quote, hold } = this.snapshot;
    if (!this.canEdit() || !principal || !quote || !hold || this.prerequisites() !== 6) {
      this.patch({ problem: 'راجع صلاحية السعر والموعد وبيانات الحجز قبل التأكيد.' });
      return null;
    }
    const vehicle = draft.vehicle;
    const body = {
      quote: { quoteId: quote.quoteId, revision: quote.revision },
      hold: { holdId: hold.holdId, revision: hold.revision },
      vehicle:
        vehicle.source === 'saved'
          ? { source: 'saved', vehicleId: vehicle.vehicleId, revision: vehicle.revision }
          : {
              source: 'inline',
              inline: {
                type: vehicle.type,
                make: null,
                model: vehicle.model,
                color: vehicle.color,
                plate: vehicle.plate.trim()
                  ? { text: vehicle.plate.trim().toUpperCase(), region: null }
                  : null,
              },
            },
      address: { addressId: draft.address!.addressId, revision: draft.address!.revision },
      contact: normalizeContact(draft.contact),
      ...(draft.paymentMethod ? { paymentMethod: draft.paymentMethod } : {}),
      ...(draft.subscription ? { subscription: draft.subscription } : {}),
    };
    const key = this.options.newKey();
    this.persistCreate(key);
    const result = await this.mutate(
      'booking',
      {
        method: 'POST',
        path: '/customer/bookings',
        body,
        idempotencyKey: key,
        parse: (value) => {
          const booking = this.own(parseProductionBooking(value));
          if (
            booking.quote.quoteId !== quote.quoteId ||
            booking.quote.revision !== quote.revision ||
            booking.slot.holdId !== hold.holdId ||
            booking.slot.zoneId !== hold.zoneId ||
            booking.slot.startsAt !== hold.startsAt ||
            booking.slot.endsAt !== hold.endsAt ||
            booking.address.addressId !== draft.address!.addressId ||
            booking.address.addressRevision !== draft.address!.revision ||
            (!draft.subscription && booking.paymentMethod !== draft.paymentMethod) ||
            booking.financialSource !== (draft.subscription ? 'SUBSCRIPTION' : 'DIRECT') ||
            booking.contact.name !== body.contact!.name ||
            booking.contact.phone !== body.contact!.phone ||
            booking.contact.notes !== body.contact!.notes ||
            booking.vehicle.source !== vehicle.source ||
            booking.vehicle.type !== vehicle.type ||
            (vehicle.source === 'saved' &&
              (booking.vehicle.vehicleId !== vehicle.vehicleId ||
                booking.vehicle.vehicleRevision !== vehicle.revision)) ||
            (vehicle.source === 'inline' &&
              (booking.vehicle.model !== vehicle.model ||
                booking.vehicle.color !== vehicle.color ||
                (booking.vehicle.plate?.text ?? '') !== vehicle.plate.trim().toUpperCase())) ||
            booking.total.amountMinor !== quote.total.amountMinor ||
            booking.total.currency !== quote.total.currency ||
            booking.total.scale !== quote.total.scale
          )
            throw new Error('booking context');
          return booking;
        },
      },
      (booking) => this.acceptBooking(booking),
    );
    if (!result.ok && result.error.code !== 'OUTCOME_UNKNOWN') this.clearCreate();
    return result.ok ? result.value : null;
  }
  private persistCreate(key: string): void {
    if (this.snapshot.principal)
      try {
        this.options.recovery?.write(this.snapshot.principal, key);
      } catch {
        /* memory still guards this session */
      }
    this.patch({ unknownCreateKey: key });
  }
  private clearCreate(): void {
    if (this.snapshot.principal)
      try {
        this.options.recovery?.clear(this.snapshot.principal);
      } catch {
        /* harmless stale key is resolved by owner */
      }
    this.patch({ unknownCreateKey: null });
  }
  private acceptBooking(booking: ProductionBooking): void {
    this.clearCreate();
    this.patch({
      selectedBooking: booking,
      handoffBookingId: booking.bookingId,
      detailStatus: 'available',
      draft: blankDraft(),
      hold: null,
      quote: null,
      serviceability: null,
      availability: null,
      earliestAvailability: null,
      earliestStatus: 'idle',
      bookings: [
        booking,
        ...this.snapshot.bookings.filter((item) => item.bookingId !== booking.bookingId),
      ],
    });
  }
  acknowledgeHandoff(): void {
    if (this.snapshot.handoffBookingId) this.patch({ handoffBookingId: null });
  }
  async recoverCreate(): Promise<ProductionBooking | null> {
    const key = this.snapshot.unknownCreateKey;
    if (!key || !this.snapshot.principal || this.snapshot.busy) return null;
    const epoch = this.epoch;
    this.patch({ loading: true });
    const result = await this.client.request({
      method: 'GET',
      path: `/customer/bookings/by-request/${encodeURIComponent(key)}`,
      parse: (value) => this.own(parseProductionBooking(value)),
    });
    if (epoch !== this.epoch) return null;
    this.patch({ loading: false });
    if (result.ok) {
      this.pending = null;
      this.patch({ pending: null, problem: null });
      this.acceptBooking(result.value);
      return result.value;
    }
    // A 404 can race a still-running command. Keep the fence; never call it a failed create.
    this.patch({
      problem: 'نتيجة تأكيد سابق ما زالت غير معروفة. تحقّق من الحجز مجددًا قبل إنشاء حجز آخر.',
    });
    return null;
  }
  async loadBookings(more = false): Promise<void> {
    if (!this.snapshot.principal) return;
    const epoch = this.epoch,
      sequence = ++this.readSequence;
    const cursor = more ? (this.snapshot.nextCursor ?? undefined) : undefined;
    if (more && !cursor) return;
    this.patch({ bookingsStatus: 'loading', problem: null });
    const result = await this.client.request({
      method: 'GET',
      path: '/customer/bookings',
      query: { limit: 50, cursor },
      parse: (value) => {
        const page = parseProductionBookings(value);
        page.items.forEach((item) => this.own(item));
        return page;
      },
    });
    if (epoch !== this.epoch || sequence !== this.readSequence) return;
    if (!result.ok) {
      this.patch({ bookingsStatus: 'unavailable', problem: problemFor(result) });
      return;
    }
    const rows = more ? [...this.snapshot.bookings, ...result.value.items] : result.value.items;
    this.patch({
      bookings: [...new Map(rows.map((row) => [row.bookingId, row])).values()],
      nextCursor: result.value.nextCursor,
      bookingsStatus: 'available',
    });
  }
  async loadBooking(bookingId: string): Promise<void> {
    if (!this.snapshot.principal || !validId(bookingId)) return;
    const epoch = this.epoch,
      sequence = ++this.detailSequence;
    const same = this.snapshot.selectedBooking?.bookingId === bookingId;
    this.patch({
      detailStatus: 'loading',
      ...(same
        ? {}
        : {
            selectedBooking: null,
            obligation: null,
            refunds: null,
            paymentStatus: 'idle',
            changes: [],
          }),
    });
    const result = await this.client.request({
      method: 'GET',
      path: `/customer/bookings/${bookingId}`,
      parse: (value) => {
        const booking = this.own(parseProductionBooking(value));
        if (booking.bookingId !== bookingId) throw new Error('booking id');
        return booking;
      },
    });
    if (epoch !== this.epoch || sequence !== this.detailSequence) return;
    if (!result.ok) {
      this.patch({
        detailStatus: result.status === 404 ? 'missing' : 'unavailable',
        problem: problemFor(result),
      });
      return;
    }
    this.patch({
      selectedBooking: result.value,
      detailStatus: 'available',
      problem: null,
      bookings: this.snapshot.bookings.map((item) =>
        item.bookingId === bookingId ? result.value : item,
      ),
    });
  }
  async loadPayment(bookingId: string): Promise<void> {
    if (!this.snapshot.principal || !validId(bookingId)) return;
    const booking = this.snapshot.selectedBooking;
    if (!booking || booking.bookingId !== bookingId) return;
    if (booking.financialSource === 'SUBSCRIPTION') {
      this.patch({ obligation: null, refunds: null, paymentStatus: 'available' });
      return;
    }
    const epoch = this.epoch,
      sequence = ++this.paymentSequence;
    this.patch({ paymentStatus: 'loading' });
    const result = await this.client.request({
      method: 'GET',
      path: `/customer/bookings/${bookingId}/obligation`,
      parse: (value) => {
        const obligation = parseObligationV1(value);
        if (
          obligation.quoteId !== booking.quote.quoteId ||
          (booking.obligationId !== null && obligation.obligationId !== booking.obligationId) ||
          obligation.amount.currency !== booking.total.currency ||
          obligation.amount.amountMinor !== booking.total.amountMinor ||
          obligation.amount.scale !== booking.total.scale
        )
          throw new Error('obligation booking context');
        return obligation;
      },
    });
    if (
      epoch !== this.epoch ||
      sequence !== this.paymentSequence ||
      this.snapshot.selectedBooking?.bookingId !== bookingId
    )
      return;
    this.patch({
      obligation: result.ok ? result.value : this.snapshot.obligation,
      paymentStatus: result.ok ? 'available' : 'unavailable',
    });
    if (result.ok) {
      const refunds = await this.client.request({
        method: 'GET',
        path: `/customer/payments/${result.value.obligationId}/refunds`,
        parse: parseObligationRefundsV1,
      });
      if (
        epoch === this.epoch &&
        sequence === this.paymentSequence &&
        this.snapshot.selectedBooking?.bookingId === bookingId
      )
        this.patch({
          refunds:
            refunds.ok && refunds.value.obligationId === result.value.obligationId
              ? refunds.value
              : null,
        });
    }
  }
  async changePayment(method: PaymentMethod): Promise<boolean> {
    const obligation = this.snapshot.obligation;
    if (!obligation || this.snapshot.paymentStatus !== 'available') return false;
    const body = parseInitializePaymentRequestV1({ expectedRevision: obligation.revision, method });
    const result = await this.mutate(
      'payment-method',
      {
        method: 'POST',
        path: `/customer/payments/${obligation.obligationId}/method`,
        body,
        parse: (value) => {
          const updated = parseObligationV1(value);
          if (
            updated.obligationId !== obligation.obligationId ||
            updated.quoteId !== obligation.quoteId
          )
            throw new Error('payment id');
          return updated;
        },
      },
      (updated) => this.patch({ obligation: updated, paymentStatus: 'available' }),
    );
    return result.ok;
  }
  async submitPaymentReference(providerReference: string): Promise<boolean> {
    const obligation = this.snapshot.obligation;
    if (!obligation || this.snapshot.paymentStatus !== 'available') return false;
    let body;
    try {
      body = parseSubmitAttemptRequestV1({
        expectedRevision: obligation.revision,
        providerReference: providerReference.trim(),
      });
    } catch {
      this.patch({ problem: 'رقم العملية من 4 إلى 64 حرفًا أو رقمًا، ويسمح بالشرطة.' });
      return false;
    }
    const result = await this.mutate(
      'payment-attempt',
      {
        method: 'POST',
        path: `/customer/payments/${obligation.obligationId}/transaction-reference`,
        body,
        parse: (value) => {
          const updated = parseObligationV1(value);
          if (
            updated.obligationId !== obligation.obligationId ||
            updated.quoteId !== obligation.quoteId
          )
            throw new Error('payment id');
          return updated;
        },
      },
      (updated) => this.patch({ obligation: updated, paymentStatus: 'available' }),
    );
    return result.ok;
  }
  async cancelBooking(): Promise<boolean> {
    const booking = this.snapshot.selectedBooking;
    if (!booking || this.snapshot.detailStatus !== 'available') return false;
    const result = await this.mutate(
      'cancellation',
      {
        method: 'POST',
        path: `/customer/bookings/${booking.bookingId}/cancellation`,
        body: { expectedRevision: booking.revision, reason: 'CUSTOMER_REQUEST' },
        parse: (value) => {
          const change = parseBookingChange(value);
          if (change.bookingId !== booking.bookingId || change.kind !== 'CANCELLATION')
            throw new Error('change context');
          return change;
        },
      },
      (change) =>
        this.patch({
          changes: [
            change,
            ...this.snapshot.changes.filter((item) => item.changeId !== change.changeId),
          ],
        }),
    );
    if (result.ok) await this.loadBooking(booking.bookingId);
    return result.ok;
  }
  async loadChanges(bookingId: string): Promise<void> {
    if (!this.snapshot.principal || !validId(bookingId)) return;
    const epoch = this.epoch;
    const result = await this.client.request({
      method: 'GET',
      path: `/customer/bookings/${bookingId}/changes`,
      parse: (value) => {
        const changes = parseBookingChanges(value);
        if (changes.some((item) => item.bookingId !== bookingId))
          throw new Error('changes context');
        return changes;
      },
    });
    if (epoch === this.epoch && this.snapshot.selectedBooking?.bookingId === bookingId && result.ok)
      this.patch({ changes: result.value });
  }
  async repeat(booking: ProductionBooking): Promise<boolean> {
    if (!this.canEdit() || !(await this.releaseHold()) || !this.canEdit()) return false;
    const packageLine = booking.quote.lines.find((line) => line.kind === 'PACKAGE');
    const available = this.snapshot.catalog?.items ?? [];
    const packageId =
      packageLine &&
      available.some(
        (item) => item.definitionId === packageLine.definitionId && item.status === 'PUBLISHED',
      )
        ? packageLine.definitionId
        : null;
    const extras = booking.quote.lines
      .filter(
        (line) =>
          line.kind === 'EXTRA' &&
          line.definitionId &&
          available.some(
            (item) => item.definitionId === line.definitionId && item.status === 'PUBLISHED',
          ),
      )
      .map((line) => line.definitionId!);
    // Copy only the customer's stable choices. New quote, address revision and slot must be read again.
    this.patch({
      draft: {
        ...blankDraft(),
        vehicle: {
          source: 'inline',
          type: booking.vehicle.type,
          model: booking.vehicle.model,
          color: booking.vehicle.color,
          plate: booking.vehicle.plate?.text ?? '',
        },
        packageId,
        extras,
        contact: { ...booking.contact, notes: booking.contact.notes ?? '' },
        paymentMethod: booking.paymentMethod,
      },
      quote: null,
      hold: null,
      availability: null,
      serviceability: null,
      problem: null,
    });
    return true;
  }
  private async mutate<T>(
    operation: JourneyOperation,
    spec: RequestSpec<T>,
    apply: (value: T) => void,
  ): Promise<ApiResult<T>> {
    if (!this.snapshot.principal || this.snapshot.busy || this.pending)
      return failure('CONFLICT', 409);
    const request = { ...spec, idempotencyKey: spec.idempotencyKey ?? this.options.newKey() };
    this.pending = {
      operation,
      spec: request as RequestSpec<unknown>,
      apply: apply as (value: unknown) => void,
      epoch: this.epoch,
    };
    return this.executePending() as Promise<ApiResult<T>>;
  }
  private async executePending(): Promise<ApiResult<unknown>> {
    const pending = this.pending;
    if (!pending || this.snapshot.busy) return failure('CONFLICT', 409);
    this.patch({ busy: true, problem: null });
    const received = await this.client.request(pending.spec);
    const result =
      !received.ok && received.status >= 500
        ? failure('OUTCOME_UNKNOWN', received.status)
        : received;
    if (pending.epoch !== this.epoch) return failure('AUTH_REQUIRED', 401);
    this.patch({ busy: false });
    if (!result.ok && result.error.code === 'OUTCOME_UNKNOWN') {
      this.patch({ pending: pending.operation, problem: problemFor(result) });
      return result;
    }
    this.pending = null;
    this.patch({ pending: null, problem: problemFor(result) });
    if (result.ok) pending.apply(result.value);
    else if (pending.operation === 'booking') this.clearCreate();
    return result;
  }
  async retryPending(): Promise<void> {
    await this.executePending();
  }
}

function validId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export function normalizeContact(
  value: ProductionBookingDraft['contact'],
): { name: string; phone: string; notes: string | null } | null {
  const name = value.name.normalize('NFC').trim().replace(/\s+/g, ' ');
  const compact = value.phone.replace(/[\s().-]/g, '');
  const phone = /^09\d{8}$/.test(compact)
    ? `+963${compact.slice(1)}`
    : /^9\d{8}$/.test(compact)
      ? `+963${compact}`
      : /^00963\d{9}$/.test(compact)
        ? `+${compact.slice(2)}`
        : compact;
  const notes = value.notes.trim() || null;
  if (
    [...name].length < 2 ||
    [...name].length > 80 ||
    !/^\+[1-9]\d{7,14}$/.test(phone) ||
    (phone.startsWith('+963') && !/^\+9639\d{8}$/.test(phone)) ||
    (notes?.length ?? 0) > 500 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(`${name}${notes ?? ''}`)
  )
    return null;
  return { name, phone, notes };
}
