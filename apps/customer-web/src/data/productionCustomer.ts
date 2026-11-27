import { HttpClient, type ApiResult, type FetchLike, type RequestSpec } from '@carwash/api-clients';
import {
  apiError,
  parsePage,
  parseUtc,
  SESSION_BINDING_HEADER,
  formatSessionBinding,
  type Coordinates,
} from '@carwash/contracts/common';
import {
  isAccessPrincipal,
  isIdentityPermission,
  isIdentityRole,
  type GuestSessionReceipt,
  type IdentitySessionView,
  type ChallengeReceipt,
} from '@carwash/contracts/identity-v1';
import {
  parseCustomerProfileV1,
  parseAddressInputV1,
  parseAddressV1,
  type AddressV1,
  parseProfileInputV1,
  type CustomerProfileV1,
  type ProfileInputV1,
} from '@carwash/contracts/customer-v1';
import { parseVehicleInputV1, parseVehicleV1, type VehicleV1 } from '@carwash/contracts/vehicle-v1';
import type { VehicleEditorValues } from '../state/savedVehicles.ts';
import { FALLBACK_ADDRESS_LABEL, type AddressSheetValues } from '../state/locationStep.ts';
import { currentInstant } from '../shared/clock.ts';

type OwnerRecord = CustomerProfileV1 | VehicleV1 | AddressV1;

export interface ProductionCustomerSnapshot {
  readonly session: IdentitySessionView | null;
  readonly authStatus: 'loading' | 'anonymous' | 'authenticated' | 'unavailable';
  readonly profile: CustomerProfileV1 | null;
  readonly profileStatus: 'available' | 'missing' | 'unavailable';
  readonly vehicles: readonly VehicleV1[];
  readonly vehiclesStatus: 'available' | 'unavailable';
  readonly addresses: readonly AddressV1[];
  readonly addressesStatus: 'available' | 'unavailable';
  readonly loading: boolean;
  readonly busy: boolean;
  readonly pending:
    'profile' | 'vehicle-save' | 'vehicle-archive' | 'address-save' | 'address-archive' | null;
  /** Memory only. Acknowledging this receipt forgets the one-time recovery code. */
  readonly recovery: GuestSessionReceipt | null;
  /** Authentication challenge only; credentials and OTP are never retained here. */
  readonly challenge: (ChallengeReceipt & { readonly receivedAt: number }) | null;
  readonly notice: string | null;
}

interface Options {
  readonly origin: string;
  readonly fetch: FetchLike;
  readonly csrf: () => string;
  readonly newKey: () => string;
}

interface PendingCommand {
  readonly kind: NonNullable<ProductionCustomerSnapshot['pending']>;
  readonly spec: RequestSpec<OwnerRecord>;
  readonly epoch: number;
}

const EMPTY: ProductionCustomerSnapshot = {
  session: null,
  authStatus: 'loading',
  profile: null,
  profileStatus: 'unavailable',
  vehicles: [],
  vehiclesStatus: 'unavailable',
  addresses: [],
  addressesStatus: 'unavailable',
  loading: false,
  busy: false,
  pending: null,
  recovery: null,
  challenge: null,
  notice: null,
};

function failure<T>(status: number, code: Parameters<typeof apiError>[0]): ApiResult<T> {
  return {
    ok: false,
    status,
    error: apiError(code, code, { requestId: 'customer-client', correlationId: 'customer-client' })
      .error,
  };
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('shape');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== [...keys].sort().join(',')) throw new Error('keys');
  return record;
}

export function parseCustomerIdentity(value: unknown): IdentitySessionView {
  const v = object(value, [
    'subject',
    'sessionId',
    'authVersion',
    'principalKind',
    'roles',
    'permissions',
  ]);
  if (
    !isAccessPrincipal(v) ||
    (v.principalKind !== 'account' && v.principalKind !== 'guest') ||
    !Array.isArray(v.roles) ||
    !v.roles.every(isIdentityRole) ||
    !Array.isArray(v.permissions) ||
    !v.permissions.every(isIdentityPermission) ||
    (v.principalKind === 'guest' && v.roles.length !== 0)
  )
    throw new Error('session');
  return {
    subject: v.subject,
    sessionId: v.sessionId,
    authVersion: v.authVersion,
    principalKind: v.principalKind,
    roles: v.roles,
    permissions: v.permissions,
  };
}

function parseGuest(value: unknown): GuestSessionReceipt {
  const v = object(value, ['session', 'recoveryCode', 'guestExpiresAt']);
  const session = parseCustomerIdentity(v.session);
  if (
    session.principalKind !== 'guest' ||
    typeof v.recoveryCode !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(v.recoveryCode)
  ) {
    throw new Error('guest receipt');
  }
  return {
    session,
    recoveryCode: v.recoveryCode,
    guestExpiresAt: parseUtc(v.guestExpiresAt, '$.guestExpiresAt'),
  };
}

export function parseCustomerChallenge(value: unknown): ChallengeReceipt {
  const v = object(value, ['challengeId', 'expiresIn', 'resendAfter']);
  if (
    typeof v.challengeId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v.challengeId,
    ) ||
    typeof v.expiresIn !== 'number' ||
    !Number.isSafeInteger(v.expiresIn) ||
    v.expiresIn < 1 ||
    v.expiresIn > 3600 ||
    typeof v.resendAfter !== 'number' ||
    !Number.isSafeInteger(v.resendAfter) ||
    v.resendAfter < 0 ||
    v.resendAfter > v.expiresIn
  )
    throw new Error('challenge');
  return { challengeId: v.challengeId, expiresIn: v.expiresIn, resendAfter: v.resendAfter };
}

export function productionFailure(result: ApiResult<unknown>): string | null {
  if (result.ok) return null;
  if (result.error.reason === 'VEHICLE_LIMIT_REACHED')
    return 'وصلت إلى الحد المسموح للسيارات المحفوظة. احذف سيارة قبل إضافة أخرى.';
  if (result.error.reason === 'ADDRESS_LIMIT_REACHED')
    return 'وصلت إلى الحد المسموح للعناوين المحفوظة. احذف عنوانًا قبل إضافة آخر.';
  if (result.error.code === 'OUTCOME_UNKNOWN')
    return 'لم نتأكد من نتيجة الحفظ. أعد المحاولة بالطلب نفسه قبل إجراء تعديل آخر.';
  if (result.status === 401) return 'انتهت الجلسة. استعد جلسة الضيف قبل متابعة الحفظ.';
  if (result.status === 403) return 'لا تسمح الجلسة بهذا الإجراء. أعد تحميل البيانات وحاول مجددًا.';
  if (result.status === 412 || result.status === 409)
    return 'تغيّرت البيانات. أغلق نافذة التعديل وافتحها من جديد لمراجعة أحدث نسخة.';
  if (result.status === 404) return 'لم يعد السجل متاحًا في هذه الجلسة. أعد تحميل البيانات.';
  if (result.status === 429) return 'طلبات كثيرة خلال وقت قصير. انتظر قليلًا ثم حاول مجددًا.';
  if (result.status === 400 || result.status === 422)
    return 'راجع الحقول المدخلة. لم يُحفظ هذا التعديل.';
  return 'تعذّر الاتصال بالخدمة. حاول إعادة تحميل البيانات.';
}

/** Read only Identity's intentionally readable CSRF cookie, never the session tokens. */
export function browserCsrf(cookie: string): string {
  for (const part of cookie.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === '__Host-wg_csrf' || name === 'wg_csrf') return value.join('=');
  }
  return '';
}

/**
 * Real customer state. Cookies remain browser-owned; the client never stores
 * tokens, recovery codes or personal data in browser storage. Unknown business
 * writes retain their original body/key/revision in memory until explicit replay.
 * Reload only reads owner records and never repeats a create automatically.
 */
export class ProductionCustomer {
  private readonly options: Options;
  private readonly base: string;
  private readonly client: HttpClient;
  private snapshot: ProductionCustomerSnapshot = EMPTY;
  private readonly listeners = new Set<() => void>();
  private epoch = 0;
  private readSequence = 0;
  private pendingCommand: PendingCommand | null = null;
  private loadPromise: Promise<void> | null = null;

  constructor(options: Options) {
    this.options = options;
    this.base = `${new URL(options.origin).origin}/api/v1`;
    this.client = new HttpClient({
      baseUrl: this.base,
      fetch: options.fetch,
      credentials: 'same-origin',
      headers: () => ({
        'x-csrf-token': options.csrf(),
        ...(this.snapshot.session
          ? { [SESSION_BINDING_HEADER]: formatSessionBinding(this.snapshot.session) }
          : {}),
      }),
    });
  }

  readonly getSnapshot = (): ProductionCustomerSnapshot => this.snapshot;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private patch(values: Partial<ProductionCustomerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...values };
    for (const listener of this.listeners) listener();
  }

  private async auth<T>(
    path: string,
    parse: (value: unknown) => T,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    const mutating = body !== undefined;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await this.options.fetch(`${this.base}/auth/${path}`, {
          method: mutating ? 'POST' : 'GET',
          headers: {
            accept: 'application/json',
            ...(mutating
              ? { 'content-type': 'application/json', 'x-csrf-token': this.options.csrf() }
              : {}),
          },
          credentials: 'same-origin',
          signal: controller.signal,
          ...(mutating ? { body: JSON.stringify(body) } : {}),
        });
        const raw = await response.text();
        if (response.status < 200 || response.status >= 300) {
          const code =
            response.status === 401
              ? 'AUTH_REQUIRED'
              : response.status === 403
                ? 'AUTH_FORBIDDEN'
                : response.status === 429
                  ? 'RATE_LIMITED'
                  : response.status >= 500
                    ? mutating
                      ? 'OUTCOME_UNKNOWN'
                      : 'DEPENDENCY_UNAVAILABLE'
                    : 'REQUEST_INVALID';
          return failure(response.status, code);
        }
        try {
          if (raw.length > 262144) throw new Error('response size');
          return {
            ok: true,
            status: response.status,
            value: parse(raw ? (JSON.parse(raw) as unknown) : null),
            revision: null,
          };
        } catch {
          return failure(502, mutating ? 'OUTCOME_UNKNOWN' : 'UPSTREAM_INVALID');
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return failure(504, mutating ? 'OUTCOME_UNKNOWN' : 'UPSTREAM_TIMEOUT');
    }
  }

  private async prepareCsrf(): Promise<ApiResult<string>> {
    return this.auth('csrf', (value) => {
      const v = object(value, ['csrfToken']);
      if (typeof v.csrfToken !== 'string' || !/^[A-Za-z0-9_.-]{20,512}$/.test(v.csrfToken))
        throw new Error('csrf');
      return v.csrfToken;
    });
  }

  load(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    const promise = this.read().finally(() => {
      if (this.loadPromise === promise) this.loadPromise = null;
    });
    this.loadPromise = promise;
    return promise;
  }

  private async read(): Promise<void> {
    let epoch = this.epoch;
    const sequence = ++this.readSequence;
    const current = () => epoch === this.epoch && sequence === this.readSequence;
    this.patch({ loading: true });
    let session = await this.auth('session', parseCustomerIdentity);
    // A rotated/expired access cookie may still have a live refresh session.
    // Never create a guest while loading; refresh is attempted at most once.
    if (!session.ok && session.status === 401 && this.options.csrf() && current()) {
      const csrf = await this.prepareCsrf();
      if (csrf.ok && current()) session = await this.auth('refresh', parseCustomerIdentity, {});
    }
    if (!current()) return;
    if (!session.ok) {
      if (session.status === 401) {
        ++this.epoch;
        this.pendingCommand = null;
        this.patch({ ...EMPTY, authStatus: 'anonymous' });
      } else {
        // Hide private data during an authentication outage, but retain the
        // previous identity and pending key so recovery cannot duplicate a write.
        this.patch({
          ...EMPTY,
          session: this.snapshot.session,
          pending: this.pendingCommand?.kind ?? null,
          authStatus: 'unavailable',
        });
      }
      return;
    }
    const old = this.snapshot.session;
    const changed =
      !old ||
      old.subject !== session.value.subject ||
      old.principalKind !== session.value.principalKind ||
      old.sessionId !== session.value.sessionId ||
      old.authVersion !== session.value.authVersion;
    if (changed) {
      epoch = ++this.epoch;
      this.pendingCommand = null;
      this.patch({ ...EMPTY, session: session.value, authStatus: 'authenticated', loading: true });
    } else this.patch({ session: session.value, authStatus: 'authenticated' });
    const [profile, vehicles, addresses] = await Promise.all([
      this.client.request({
        method: 'GET',
        path: '/customer/profile',
        parse: parseCustomerProfileV1,
      }),
      this.readVehicles(current),
      this.readAddresses(current),
    ]);
    if (!current()) return;
    const ownProfile =
      profile.ok &&
      profile.value.status === 'ACTIVE' &&
      profile.value.principal.kind === session.value.principalKind &&
      profile.value.principal.subjectId === session.value.subject;
    this.patch({
      profile: ownProfile && profile.ok ? profile.value : null,
      profileStatus: ownProfile
        ? 'available'
        : !profile.ok && profile.status === 404 && profile.error.reason === 'PROFILE_NOT_FOUND'
          ? 'missing'
          : 'unavailable',
      vehicles: vehicles.ok ? vehicles.value : this.snapshot.vehicles,
      vehiclesStatus: vehicles.ok ? 'available' : 'unavailable',
      addresses: addresses.ok ? addresses.value : this.snapshot.addresses,
      addressesStatus: addresses.ok ? 'available' : 'unavailable',
      loading: false,
    });
  }

  private async readVehicles(current: () => boolean): Promise<ApiResult<readonly VehicleV1[]>> {
    const items: VehicleV1[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      if (!current()) return failure(401, 'AUTH_REQUIRED');
      const result = await this.client.request({
        method: 'GET',
        path: '/customer/vehicles',
        query: { limit: 100, cursor },
        parse: (value) => parsePage(value, '$', parseVehicleV1),
      });
      if (!current()) return failure(401, 'AUTH_REQUIRED');
      if (!result.ok) return result;
      for (const vehicle of result.value.items) {
        if (vehicle.archived || items.some((item) => item.vehicleId === vehicle.vehicleId))
          return failure(502, 'UPSTREAM_INVALID');
        items.push(vehicle);
      }
      if (result.value.nextCursor === null) return { ...result, value: items };
      if (cursors.has(result.value.nextCursor)) return failure(502, 'UPSTREAM_INVALID');
      cursor = result.value.nextCursor;
      cursors.add(cursor);
    }
    return failure(502, 'UPSTREAM_INVALID');
  }

  private async readAddresses(current: () => boolean): Promise<ApiResult<readonly AddressV1[]>> {
    const items: AddressV1[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      if (!current()) return failure(401, 'AUTH_REQUIRED');
      const result = await this.client.request({
        method: 'GET',
        path: '/customer/addresses',
        query: { limit: 100, cursor },
        parse: (value) => parsePage(value, '$', parseAddressV1),
      });
      if (!current()) return failure(401, 'AUTH_REQUIRED');
      if (!result.ok) {
        if (result.status === 404 && result.error.reason === 'PROFILE_NOT_FOUND')
          return { ok: true, status: 200, value: [], revision: null };
        return result;
      }
      for (const address of result.value.items) {
        if (address.archived || items.some((item) => item.addressId === address.addressId))
          return failure(502, 'UPSTREAM_INVALID');
        items.push(address);
      }
      if (result.value.nextCursor === null) return { ...result, value: items };
      if (cursors.has(result.value.nextCursor)) return failure(502, 'UPSTREAM_INVALID');
      cursor = result.value.nextCursor;
      cursors.add(cursor);
    }
    return failure(502, 'UPSTREAM_INVALID');
  }

  async saveAddress(
    addressId: string | null,
    values: AddressSheetValues,
    expectedRevision: number | null,
    point?: Coordinates,
  ): Promise<ApiResult<OwnerRecord>> {
    if (this.snapshot.addressesStatus !== 'available')
      return failure(503, 'DEPENDENCY_UNAVAILABLE');
    const previous =
      addressId === null
        ? undefined
        : this.snapshot.addresses.find((value) => value.addressId === addressId);
    if (addressId !== null && !previous) return failure(404, 'NOT_FOUND');
    if ((previous?.revision ?? null) !== expectedRevision) return failure(412, 'REVISION_CONFLICT');
    let body;
    try {
      body = parseAddressInputV1({
        label: values.addressLabel.trim() || FALLBACK_ADDRESS_LABEL,
        details: values.locationNote.trim() || null,
        location: point
          ? { mode: 'coordinates', point, description: values.address.trim() || null }
          : previous?.location.mode === 'coordinates'
            ? { ...previous.location, description: values.address.trim() || null }
            : { mode: 'manual', description: values.address.trim() },
      });
    } catch {
      return failure(400, 'REQUEST_INVALID');
    }
    return this.mutate('address-save', {
      method: addressId === null ? 'POST' : 'PATCH',
      path:
        addressId === null
          ? '/customer/addresses'
          : `/customer/addresses/${encodeURIComponent(addressId)}`,
      body,
      ...(expectedRevision === null ? {} : { expectedRevision }),
      parse: parseAddressV1,
    });
  }

  async archiveAddress(
    addressId: string,
    expectedRevision: number,
  ): Promise<ApiResult<OwnerRecord>> {
    if (this.snapshot.addressesStatus !== 'available')
      return failure(503, 'DEPENDENCY_UNAVAILABLE');
    const previous = this.snapshot.addresses.find((value) => value.addressId === addressId);
    if (!previous) return failure(404, 'NOT_FOUND');
    if (previous.revision !== expectedRevision) return failure(412, 'REVISION_CONFLICT');
    return this.mutate('address-archive', {
      method: 'POST',
      path: `/customer/addresses/${encodeURIComponent(addressId)}/archive`,
      body: {},
      expectedRevision,
      parse: parseAddressV1,
    });
  }

  async guest(recoveryCode?: string): Promise<ApiResult<GuestSessionReceipt>> {
    if (this.snapshot.busy || this.snapshot.loading || this.snapshot.authStatus !== 'anonymous')
      return failure(409, 'CONFLICT');
    if (recoveryCode !== undefined && !/^[A-Za-z0-9_-]{43}$/.test(recoveryCode.trim()))
      return failure(400, 'REQUEST_INVALID');
    const epoch = ++this.epoch;
    this.loadPromise = null;
    this.patch({ busy: true, notice: null });
    const csrf = await this.prepareCsrf();
    if (epoch !== this.epoch) return failure(401, 'AUTH_REQUIRED');
    const result = csrf.ok
      ? await this.auth(
          recoveryCode === undefined ? 'guest-sessions' : 'guest-sessions/recover',
          parseGuest,
          recoveryCode === undefined ? {} : { recoveryCode: recoveryCode.trim() },
        )
      : csrf;
    if (epoch !== this.epoch) return failure(401, 'AUTH_REQUIRED');
    this.patch({ busy: false });
    if (!result.ok) {
      // An ambiguous guest operation is not blindly repeated: reload session
      // first, since cookies might already have been issued or rotated.
      if (result.error.code === 'OUTCOME_UNKNOWN') {
        await this.load();
        this.patch({
          notice:
            'لم نتأكد من نتيجة إنشاء أو استعادة الجلسة. أعد تحميل الجلسة قبل المحاولة؛ لا يُعرض رمز استعادة لم نتلقّه.',
        });
      }
      return result;
    }
    this.patch({
      ...EMPTY,
      session: result.value.session,
      authStatus: 'authenticated',
      recovery: result.value,
    });
    await this.load();
    return result;
  }

  acknowledgeRecovery(): void {
    this.patch({ recovery: null });
  }

  async account(
    mode: 'login' | 'register',
    email: string,
    password: string,
  ): Promise<ApiResult<ChallengeReceipt>> {
    if (this.snapshot.busy || this.snapshot.loading || this.snapshot.authStatus !== 'anonymous')
      return failure(409, 'CONFLICT');
    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      password.length < 12 ||
      password.length > 128
    )
      return failure(400, 'REQUEST_INVALID');
    const epoch = ++this.epoch;
    this.loadPromise = null;
    this.patch({ busy: true, notice: null, challenge: null });
    const csrf = await this.prepareCsrf();
    if (epoch !== this.epoch) return failure(401, 'AUTH_REQUIRED');
    const result = csrf.ok
      ? await this.auth(mode, parseCustomerChallenge, { email: email.trim(), password })
      : csrf;
    if (epoch !== this.epoch) return failure(401, 'AUTH_REQUIRED');
    this.patch({
      busy: false,
      challenge: result.ok ? { ...result.value, receivedAt: currentInstant().getTime() } : null,
    });
    return result;
  }

  async resendChallenge(): Promise<ApiResult<ChallengeReceipt>> {
    const challenge = this.snapshot.challenge;
    if (!challenge || this.snapshot.busy || this.snapshot.authStatus !== 'anonymous')
      return failure(409, 'CONFLICT');
    if (currentInstant().getTime() < challenge.receivedAt + challenge.resendAfter * 1000)
      return failure(429, 'RATE_LIMITED');
    const epoch = this.epoch;
    this.patch({ busy: true, notice: null });
    const result = await this.auth('challenges/resend', parseCustomerChallenge, {
      challengeId: challenge.challengeId,
    });
    if (epoch !== this.epoch) return failure(401, 'AUTH_REQUIRED');
    this.patch({
      busy: false,
      ...(result.ok
        ? { challenge: { ...result.value, receivedAt: currentInstant().getTime() } }
        : {}),
    });
    return result;
  }

  cancelChallenge(): void {
    if (!this.snapshot.busy) this.patch({ challenge: null });
  }

  async verifyChallenge(code: string): Promise<ApiResult<IdentitySessionView>> {
    const challenge = this.snapshot.challenge;
    if (!challenge || this.snapshot.busy || this.snapshot.authStatus !== 'anonymous')
      return failure(409, 'CONFLICT');
    if (!/^\d{6}$/.test(code)) return failure(400, 'REQUEST_INVALID');
    const epoch = this.epoch;
    this.patch({ busy: true, notice: null });
    const result = await this.auth('challenges/verify', parseCustomerIdentity, {
      challengeId: challenge.challengeId,
      code,
    });
    if (epoch !== this.epoch) return failure(401, 'AUTH_REQUIRED');
    this.patch({ busy: false });
    if (result.ok) {
      this.patch({ ...EMPTY, session: result.value, authStatus: 'authenticated' });
      await this.load();
    } else if (result.error.code === 'OUTCOME_UNKNOWN') {
      // Verification might already have issued a cookie. Read it before offering
      // another attempt; a lost response never becomes a locally signed-in state.
      await this.load();
    }
    return result;
  }

  async signOut(): Promise<ApiResult<null>> {
    const epoch = ++this.epoch;
    this.loadPromise = null;
    this.pendingCommand = null;
    this.patch({ ...EMPTY, authStatus: 'anonymous', busy: true });
    const csrf = await this.prepareCsrf();
    if (epoch !== this.epoch) return failure(401, 'AUTH_REQUIRED');
    const result = csrf.ok ? await this.auth('logout', () => null, {}) : csrf;
    if (epoch !== this.epoch) return failure(401, 'AUTH_REQUIRED');
    this.patch({
      busy: false,
      authStatus: result.ok ? 'anonymous' : 'unavailable',
      notice: result.ok
        ? null
        : 'تعذّر تأكيد إنهاء الجلسة. أعد تحميل الجلسة وتحقق قبل مغادرة جهاز مشترك.',
    });
    return result;
  }

  async saveProfile(
    input: ProfileInputV1,
    expectedRevision: number | null,
  ): Promise<ApiResult<OwnerRecord>> {
    let body: ProfileInputV1;
    try {
      body = parseProfileInputV1(input);
    } catch {
      return failure(400, 'REQUEST_INVALID');
    }
    if (this.snapshot.profileStatus === 'unavailable')
      return failure(503, 'DEPENDENCY_UNAVAILABLE');
    if ((this.snapshot.profile?.revision ?? null) !== expectedRevision)
      return failure(412, 'REVISION_CONFLICT');
    return this.mutate('profile', {
      method: expectedRevision === null ? 'PUT' : 'PATCH',
      path: '/customer/profile',
      body,
      ...(expectedRevision === null ? {} : { expectedRevision }),
      parse: parseCustomerProfileV1,
    });
  }

  async saveVehicle(
    vehicleId: string | null,
    values: VehicleEditorValues,
    expectedRevision: number | null,
  ): Promise<ApiResult<OwnerRecord>> {
    if (this.snapshot.vehiclesStatus !== 'available') return failure(503, 'DEPENDENCY_UNAVAILABLE');
    const previous =
      vehicleId === null
        ? undefined
        : this.snapshot.vehicles.find((value) => value.vehicleId === vehicleId);
    if (vehicleId !== null && !previous) return failure(404, 'NOT_FOUND');
    if ((previous?.revision ?? null) !== expectedRevision) return failure(412, 'REVISION_CONFLICT');
    const optional = (value: string) => value.trim() || null;
    let body;
    try {
      body = parseVehicleInputV1({
        type: values.type,
        make: previous?.make ?? null,
        model: previous?.model ?? null,
        color: optional(values.color),
        nickname: optional(values.carName),
        plate: values.plate.trim()
          ? { text: values.plate, region: previous?.plate?.region ?? null }
          : null,
      });
    } catch {
      return failure(400, 'REQUEST_INVALID');
    }
    return this.mutate('vehicle-save', {
      method: vehicleId === null ? 'POST' : 'PATCH',
      path:
        vehicleId === null
          ? '/customer/vehicles'
          : `/customer/vehicles/${encodeURIComponent(vehicleId)}`,
      body,
      ...(expectedRevision === null ? {} : { expectedRevision }),
      parse: parseVehicleV1,
    });
  }

  async archiveVehicle(
    vehicleId: string,
    expectedRevision: number,
  ): Promise<ApiResult<OwnerRecord>> {
    const current = this.snapshot.vehicles.find((value) => value.vehicleId === vehicleId);
    if (!current) return failure(404, 'NOT_FOUND');
    if (current.revision !== expectedRevision) return failure(412, 'REVISION_CONFLICT');
    return this.mutate('vehicle-archive', {
      method: 'POST',
      path: `/customer/vehicles/${encodeURIComponent(vehicleId)}/archive`,
      body: {},
      expectedRevision,
      parse: parseVehicleV1,
    });
  }

  private async mutate(
    kind: PendingCommand['kind'],
    spec: Omit<PendingCommand['spec'], 'idempotencyKey'>,
  ): Promise<ApiResult<OwnerRecord>> {
    if (!this.snapshot.session || this.snapshot.authStatus !== 'authenticated')
      return failure(401, 'AUTH_REQUIRED');
    if (this.snapshot.busy || this.snapshot.loading || this.pendingCommand)
      return failure(409, 'CONFLICT');
    const command: PendingCommand = {
      kind,
      spec: { ...spec, idempotencyKey: this.options.newKey() },
      epoch: this.epoch,
    };
    this.pendingCommand = command;
    return this.execute(command);
  }

  retryPending(): Promise<ApiResult<OwnerRecord>> {
    if (!this.snapshot.session || this.snapshot.authStatus !== 'authenticated')
      return Promise.resolve(failure(401, 'AUTH_REQUIRED'));
    if (!this.pendingCommand || this.snapshot.busy || this.snapshot.loading)
      return Promise.resolve(failure(409, 'CONFLICT'));
    return this.execute(this.pendingCommand);
  }

  private async execute(command: PendingCommand): Promise<ApiResult<OwnerRecord>> {
    this.patch({ busy: true, pending: command.kind, notice: null });
    const csrf = await this.prepareCsrf();
    if (command.epoch !== this.epoch) return failure(401, 'AUTH_REQUIRED');
    const result = csrf.ok ? await this.client.request(command.spec) : csrf;
    if (command.epoch !== this.epoch) return failure(401, 'AUTH_REQUIRED');
    if (!result.ok && (result.error.code === 'OUTCOME_UNKNOWN' || result.status >= 500)) {
      this.patch({ busy: false, notice: productionFailure(failure(504, 'OUTCOME_UNKNOWN')) });
      return failure(504, 'OUTCOME_UNKNOWN');
    }
    this.pendingCommand = null;
    this.patch({ busy: false, pending: null });
    if (result.ok) {
      if ('customerId' in result.value) {
        const session = this.snapshot.session;
        if (
          !session ||
          result.value.principal.kind !== session.principalKind ||
          result.value.principal.subjectId !== session.subject ||
          result.value.status !== 'ACTIVE'
        ) {
          this.pendingCommand = command;
          this.patch({ pending: command.kind });
          return failure(502, 'OUTCOME_UNKNOWN');
        }
        this.patch({ profile: result.value, profileStatus: 'available' });
        const body = command.spec.body as ProfileInputV1;
        if (
          result.value.contact.displayName !== body.displayName ||
          result.value.contact.phone !== body.phone ||
          result.value.preferences.locale !== body.locale
        )
          return failure(409, 'CONFLICT');
      } else if ('vehicleId' in result.value) {
        const vehicle = result.value;
        const expectedId =
          command.kind === 'vehicle-archive'
            ? command.spec.path.split('/').at(-2)
            : command.spec.method === 'PATCH'
              ? command.spec.path.split('/').at(-1)
              : null;
        if (
          (expectedId && expectedId !== vehicle.vehicleId) ||
          vehicle.archived !== (command.kind === 'vehicle-archive')
        ) {
          this.pendingCommand = command;
          this.patch({ pending: command.kind });
          return failure(502, 'OUTCOME_UNKNOWN');
        }
        const present = this.snapshot.vehicles.some(
          (value) => value.vehicleId === vehicle.vehicleId,
        );
        this.patch({
          vehicles: vehicle.archived
            ? this.snapshot.vehicles.filter((value) => value.vehicleId !== vehicle.vehicleId)
            : present
              ? this.snapshot.vehicles.map((value) =>
                  value.vehicleId === vehicle.vehicleId ? vehicle : value,
                )
              : [...this.snapshot.vehicles, vehicle],
          vehiclesStatus: 'available',
        });
      } else {
        const address = result.value;
        const archived = command.kind === 'address-archive';
        const expectedId = archived
          ? command.spec.path.split('/').at(-2)
          : command.spec.method === 'PATCH'
            ? command.spec.path.split('/').at(-1)
            : null;
        const input = archived ? null : parseAddressInputV1(command.spec.body);
        if (
          (expectedId && expectedId !== address.addressId) ||
          address.archived !== archived ||
          (input &&
            (input.label !== address.label ||
              input.details !== address.details ||
              JSON.stringify(input.location) !== JSON.stringify(address.location)))
        ) {
          this.pendingCommand = command;
          this.patch({ pending: command.kind });
          return failure(502, 'OUTCOME_UNKNOWN');
        }
        const present = this.snapshot.addresses.some(
          (value) => value.addressId === address.addressId,
        );
        this.patch({
          addresses: archived
            ? this.snapshot.addresses.filter((value) => value.addressId !== address.addressId)
            : present
              ? this.snapshot.addresses.map((value) =>
                  value.addressId === address.addressId ? address : value,
                )
              : [...this.snapshot.addresses, address],
          addressesStatus: 'available',
        });
      }
      this.patch({
        notice:
          command.kind === 'profile'
            ? 'حُفظت بيانات التواصل في الخدمة.'
            : command.kind === 'address-save'
              ? 'حُفظ العنوان في الخدمة.'
              : command.kind === 'address-archive'
                ? 'أُزيل العنوان من العناوين المحفوظة. الحجوزات السابقة لا تتغيّر.'
                : command.kind === 'vehicle-archive'
                  ? 'أُزيلت السيارة من السيارات المحفوظة. الحجوزات السابقة لا تتغيّر.'
                  : 'حُفظت السيارة في الخدمة.',
      });
    } else if (result.status === 412 || result.status === 404 || result.status === 401)
      await this.load();
    return result;
  }
}
