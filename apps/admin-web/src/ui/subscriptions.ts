import { CURRENCIES } from '@carwash/contracts/common';
import { VEHICLE_TYPES, type CatalogV1 } from '@carwash/contracts/catalog-v1';
import {
  parsePublishPlanRequestV1,
  type PlanV1,
  type PublishPlanRequestV1,
  type SubscriptionV1,
} from '@carwash/contracts/subscription-v1';
import { publishedCatalog } from '../api/catalog-coverage';
import {
  subscriptionPlans,
  publishSubscriptionPlan,
  subscriptionById,
  pendingSubscriptionChanges,
  decideSubscriptionChange,
  subscriptionFundingRecovery,
  retrySubscriptionFunding,
} from '../api/subscriptions';
import { UUID, idempotencyKey } from '../api/http';
import { formatMoney, parseAmount } from '../domain/finance';
import { shortRef } from '../domain/bookings';
import { append, h, replace } from './dom';
import { copy } from './i18n';
import { closeModal, openModal, toast } from './shell';
import { failureMessage, formatInstant } from './states';
import {
  ensureScreen,
  frame,
  freeze,
  input,
  invalid,
  label,
  readFailure,
  select,
  status,
  tr,
  vehicleName,
} from './domain-screen';

interface Wiring {
  readonly unauthenticated: () => void;
  readonly permissions: () => readonly string[];
  readonly subject: () => string | null;
}
let wiring: Wiring = {
  unauthenticated: () => undefined,
  permissions: () => [],
  subject: () => null,
};
let generation = 0,
  lookupGeneration = 0;
let pendingPlan: { planId: string; body: PublishPlanRequestV1; key: string } | null = null;
const pendingDecisions = new Map<
  string,
  { subscriptionId: string; approve: boolean; key: string }
>();
const pendingRecoveries = new Map<string, { expectedAttempts: number; key: string }>();
const canManage = (): boolean => wiring.permissions().includes('subscription.manage');
export function wireSubscriptionScreens(value: Wiring): void {
  wiring = value;
  ensureScreen('subscriptions');
}
export function invalidateSubscriptionScreens(clearPrivate = false): void {
  generation++;
  if (clearPrivate) {
    pendingPlan = null;
    pendingDecisions.clear();
    pendingRecoveries.clear();
    document.getElementById('subscriptions')?.replaceChildren();
  }
}
const actionLabel = (value: string): string =>
  ({
    FREEZE: tr('تجميد', 'Freeze'),
    RESUME: tr('استئناف', 'Resume'),
    CANCEL: tr('إلغاء', 'Cancel'),
  })[value] ?? value;
const subscriptionState = (value: SubscriptionV1['status']): string =>
  ({
    ACTIVE: tr('نشط', 'Active'),
    FROZEN: tr('مجمّد', 'Frozen'),
    EXHAUSTED: tr('مستنفد', 'Exhausted'),
    EXPIRED: tr('منتهي', 'Expired'),
    CANCELLED: tr('ملغى', 'Cancelled'),
  })[value];
function subscriptionDetails(value: SubscriptionV1): HTMLElement {
  return h(
    'dl',
    { class: 'detail-list domain-details' },
    h('dt', {}, tr('الهوية المستفيدة', 'Beneficiary')),
    h('dd', {}, shortRef(value.beneficiary.subjectId)),
    h('dt', {}, tr('الحالة', 'State')),
    h('dd', {}, subscriptionState(value.status)),
    h('dt', {}, tr('إصدار الخطة المشتراة', 'Purchased plan version')),
    h('dd', {}, `${shortRef(value.planId)} · ${value.planVersion}`),
    h('dt', {}, tr('الغسلات المتاحة', 'Available washes')),
    h('dd', {}, String(value.units.available)),
    h('dt', {}, tr('المحجوزة', 'Reserved')),
    h('dd', {}, String(value.units.reserved)),
    h('dt', {}, tr('المستهلكة', 'Consumed')),
    h('dd', {}, String(value.units.consumed)),
    h('dt', {}, tr('بداية الفترة', 'Starts')),
    h('dd', {}, formatInstant(value.startsAt)),
    h('dt', {}, tr('انتهاء الفترة', 'Expires')),
    h('dd', {}, formatInstant(value.expiresAt)),
  );
}

function retryRecovery(item: { subscriptionId: string; attempts: number }): void {
  const current = generation;
  let active = true,
    busy = false;
  const problem = h('p', { role: 'alert', class: 'field-error' });
  const submit = h(
    'button',
    { class: 'primary', type: 'button' },
    tr('تأكيد إعادة المحاولة', 'Confirm retry'),
  );
  submit.addEventListener('click', () => {
    if (busy || !active || current !== generation || !canManage()) return;
    const intent = pendingRecoveries.get(item.subscriptionId) ?? {
      expectedAttempts: item.attempts,
      key: idempotencyKey(),
    };
    pendingRecoveries.set(item.subscriptionId, intent);
    busy = true;
    submit.disabled = true;
    void retrySubscriptionFunding(item.subscriptionId, intent.expectedAttempts, intent.key).then(
      (result) => {
        if (!active || current !== generation) return;
        busy = false;
        submit.disabled = false;
        if (!result.ok) {
          if (result.failure === 'UNAUTHENTICATED') {
            wiring.unauthenticated();
            return;
          }
          if (result.failure !== 'UNKNOWN_OUTCOME') pendingRecoveries.delete(item.subscriptionId);
          problem.textContent = failureMessage(result.failure);
          submit.textContent = copy().retry;
          if (result.failure === 'CONFLICT') submit.disabled = true;
          return;
        }
        pendingRecoveries.delete(item.subscriptionId);
        closeModal();
        toast(tr('جُدولت محاولة التسوية.', 'Settlement retry scheduled.'));
        void showSubscriptions();
      },
    );
  });
  openModal({
    title: tr('إعادة محاولة تسوية الاشتراك', 'Retry subscription settlement'),
    body: [
      h(
        'p',
        {},
        tr(
          'يعيد هذا الإجراء جدولة المحاولة للاشتراك الملغى. تبقى الحجوزات القائمة وقواعد التمويل قيد التحقق ولا يُنفذ استرداد مالي.',
          'This reschedules the cancelled subscription release. Existing reservations and funding rules are rechecked; no refund is issued.',
        ),
      ),
      problem,
    ],
    foot: [submit],
    onClose: () => {
      active = false;
    },
  });
}
function publishDialog(planId: string, body: PublishPlanRequestV1): void {
  const current = generation;
  let active = true,
    busy = false;
  const message = h('p', { role: 'alert', class: 'field-error' });
  const submit = h(
    'button',
    { class: 'primary', type: 'button' },
    pendingPlan
      ? tr('إعادة الطلب نفسه', 'Retry the same request')
      : tr('نشر الخطة', 'Publish plan'),
  );
  submit.addEventListener('click', () => {
    if (busy || !canManage()) return;
    const intent = pendingPlan ?? { planId, body, key: idempotencyKey() };
    pendingPlan = intent;
    busy = true;
    submit.disabled = true;
    void publishSubscriptionPlan(intent.planId, intent.body, intent.key).then((result) => {
      if (!active || current !== generation) return;
      busy = false;
      submit.disabled = false;
      if (!result.ok) {
        if (result.failure === 'UNAUTHENTICATED') {
          wiring.unauthenticated();
          return;
        }
        if (result.failure !== 'UNKNOWN_OUTCOME') pendingPlan = null;
        message.textContent = failureMessage(result.failure);
        if (result.failure === 'CONFLICT') submit.disabled = true;
        else submit.textContent = copy().retry;
        return;
      }
      pendingPlan = null;
      closeModal();
      toast(tr('نُشر إصدار الخطة.', 'Plan version published.'));
      void showSubscriptions();
    });
  });
  openModal({
    title: tr('مراجعة خطة الاشتراك', 'Review subscription plan'),
    body: [
      h('h3', {}, body.name),
      h(
        'p',
        {},
        `${body.units} ${tr('غسلات', 'washes')} · ${body.validityDays} ${tr('يومًا', 'days')} · ${formatMoney(body.price)}`,
      ),
      h(
        'p',
        {},
        `${body.packageIds.length} ${tr('باقات مشمولة', 'covered packages')} · ${body.vehicleTypes.map(vehicleName).join(' · ')}`,
      ),
      h(
        'p',
        { class: 'muted' },
        tr(
          'هذا إصدار جديد للمشتريات القادمة. الاستحقاقات المشتراة سابقًا لا تتغير.',
          'This version applies to future purchases. Existing purchased entitlements remain unchanged.',
        ),
      ),
      message,
    ],
    foot: [submit],
    onClose: () => {
      active = false;
    },
  });
}
function planForm(catalog: CatalogV1, existing: PlanV1 | null): void {
  if (pendingPlan || !canManage()) return;
  const name = input(existing?.name ?? ''),
    units = input(String(existing?.units ?? ''), 'number'),
    days = input(String(existing?.validityDays ?? ''), 'number');
  units.min = '1';
  units.max = '1000';
  days.min = '1';
  days.max = '3660';
  const currency = select(
    Object.keys(CURRENCIES).map((value) => [value, value, value] as const),
    existing?.price.currency,
  );
  const amount = input();
  amount.dir = 'ltr';
  amount.inputMode = 'decimal';
  if (existing) {
    const digits = existing.price.amountMinor.padStart(existing.price.scale + 1, '0');
    amount.value = `${digits.slice(0, -existing.price.scale)}.${digits.slice(-existing.price.scale)}`;
  }
  const state = select(
    [
      ['PUBLISHED', 'متاحة للشراء', 'Available for purchase'],
      ['RETIRED', 'متوقفة للمشتريات الجديدة', 'Retired for new purchases'],
    ],
    existing?.status,
  );
  const packages = catalog.items
    .filter(
      (item) =>
        item.kind === 'PACKAGE' &&
        (item.status === 'PUBLISHED' || existing?.packageIds.includes(item.definitionId)),
    )
    .map((item) => ({
      item,
      field: h('input', {
        type: 'checkbox',
        checked: existing?.packageIds.includes(item.definitionId) ?? false,
      }),
    }));
  const vehicles = VEHICLE_TYPES.map((type) => ({
    type,
    field: h('input', {
      type: 'checkbox',
      checked: existing?.vehicleTypes.includes(type) ?? false,
    }),
  }));
  const message = h('p', { role: 'alert', class: 'field-error' });
  const form = h(
    'form',
    { class: 'domain-form action-form' },
    label('اسم الخطة', 'Plan name', name),
    label('عدد الغسلات', 'Wash units', units),
    label('صلاحية الفترة بالأيام', 'Validity in days', days),
    label('العملة', 'Currency', currency),
    label('السعر الكامل للخطة', 'Full plan price', amount),
    label('حالة الخطة', 'Plan state', state),
    h(
      'fieldset',
      { class: 'domain-choices' },
      h('legend', {}, tr('الباقات المشمولة', 'Covered packages')),
      ...packages.map(({ item, field }) => h('label', {}, field, item.name.ar)),
    ),
    h(
      'fieldset',
      { class: 'domain-choices' },
      h('legend', {}, tr('السيارات المشمولة', 'Covered vehicles')),
      ...vehicles.map(({ type, field }) => h('label', {}, field, vehicleName(type))),
    ),
    message,
  );
  const submit = h(
    'button',
    { class: 'primary', type: 'button' },
    tr('مراجعة الخطة', 'Review plan'),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.click();
  });
  submit.addEventListener('click', () => {
    try {
      const price = parseAmount(
        amount.value,
        currency.value,
        CURRENCIES[currency.value as keyof typeof CURRENCIES],
      );
      if (!price.ok) throw new Error('amount');
      const body = parsePublishPlanRequestV1({
        expectedRevision: existing?.version ?? 0,
        status: state.value,
        name: name.value.trim(),
        units: Number(units.value),
        validityDays: Number(days.value),
        price: price.value,
        packageIds: packages
          .filter((item) => item.field.checked)
          .map((item) => item.item.definitionId),
        vehicleTypes: vehicles.filter((item) => item.field.checked).map((item) => item.type),
      });
      freeze(form, true);
      publishDialog(existing?.planId ?? crypto.randomUUID(), body);
    } catch {
      invalid(message);
    }
  });
  openModal({
    title: tr(
      existing ? 'تعديل خطة الاشتراك' : 'خطة اشتراك جديدة',
      existing ? 'Edit subscription plan' : 'New subscription plan',
    ),
    body: [form],
    foot: [submit],
  });
}

async function decide(change: {
  changeId: string;
  subscriptionId: string;
  expectedRevision: number;
  action: string;
}): Promise<void> {
  const current = generation,
    request = ++lookupGeneration;
  let active = true;
  openModal({
    title: tr('تحميل الاشتراك', 'Loading subscription'),
    body: [h('p', {}, copy().loading)],
    foot: [],
    onClose: () => {
      active = false;
    },
  });
  const result = await subscriptionById(change.subscriptionId);
  if (!active || current !== generation || request !== lookupGeneration) return;
  if (!result.ok) {
    closeModal();
    if (result.failure === 'UNAUTHENTICATED') wiring.unauthenticated();
    else toast(failureMessage(result.failure));
    return;
  }
  const value = result.value,
    stored = pendingDecisions.get(change.changeId);
  const answer = select(
    [
      ['yes', 'اعتماد التغيير', 'Approve change'],
      ['no', 'رفض التغيير', 'Reject change'],
    ],
    stored ? (stored.approve ? 'yes' : 'no') : 'yes',
  );
  answer.disabled = Boolean(stored);
  const message = h('p', { class: 'field-error', role: 'alert' });
  const submit = h(
    'button',
    {
      class: 'primary',
      type: 'button',
      disabled:
        value.beneficiary.subjectId === wiring.subject() ||
        (!stored && value.revision !== change.expectedRevision),
    },
    stored
      ? tr('إعادة الطلب نفسه', 'Retry the same request')
      : tr('تسجيل القرار', 'Record decision'),
  );
  let alive = true,
    busy = false;
  submit.addEventListener('click', () => {
    if (busy || !canManage() || value.beneficiary.subjectId === wiring.subject()) return;
    const intent = pendingDecisions.get(change.changeId) ?? {
      subscriptionId: change.subscriptionId,
      approve: answer.value === 'yes',
      key: idempotencyKey(),
    };
    pendingDecisions.set(change.changeId, intent);
    answer.disabled = submit.disabled = busy = true;
    void decideSubscriptionChange(
      intent.subscriptionId,
      change.changeId,
      intent.approve,
      intent.key,
    ).then((response) => {
      if (!alive || current !== generation) return;
      busy = false;
      submit.disabled = false;
      if (!response.ok) {
        if (response.failure === 'UNAUTHENTICATED') {
          wiring.unauthenticated();
          return;
        }
        if (response.failure !== 'UNKNOWN_OUTCOME') pendingDecisions.delete(change.changeId);
        message.textContent = failureMessage(response.failure);
        answer.disabled = pendingDecisions.has(change.changeId);
        if (response.failure === 'CONFLICT') submit.disabled = true;
        return;
      }
      pendingDecisions.delete(change.changeId);
      closeModal();
      toast(
        response.value.status === 'APPLIED'
          ? tr('طبّق النظام التغيير.', 'The owner applied the change.')
          : tr('سُجّل قرار المراجعة.', 'Review decision recorded.'),
      );
      void showSubscriptions();
    });
  });
  openModal({
    title: `${tr('طلب تغيير الاشتراك', 'Subscription change request')}: ${actionLabel(change.action)}`,
    body: [
      h(
        'div',
        { class: 'domain-form' },
        subscriptionDetails(value),
        h(
          'p',
          { class: 'muted' },
          tr(
            'التجميد لا يمدد الفترة المدفوعة. الإلغاء لا يلغي الحجوزات ولا ينفذ استردادًا ماليًا.',
            'Freezing does not extend the paid period. Cancellation does not cancel bookings or issue a refund.',
          ),
        ),
        value.revision !== change.expectedRevision
          ? h(
              'p',
              { role: 'alert' },
              tr(
                'تغير إصدار الاشتراك بعد الطلب؛ يلزم تحديث المراجعة.',
                'The subscription changed after this request; refresh the review.',
              ),
            )
          : null,
        value.beneficiary.subjectId === wiring.subject()
          ? h(
              'p',
              { role: 'alert' },
              tr(
                'يلزم موظف آخر لمراجعة اشتراكك.',
                'Another staff member must review your subscription.',
              ),
            )
          : label('القرار', 'Decision', answer),
        message,
      ),
    ],
    foot: [submit],
    onClose: () => {
      alive = false;
    },
  });
}

export async function showSubscriptions(): Promise<void> {
  const current = ++generation;
  const view = frame(
    'subscriptions',
    tr('الاشتراكات', 'Subscriptions'),
    tr(
      'خطط منشورة وطلبات تغيير الاستحقاقات المشتراة.',
      'Published plans and change requests for purchased entitlements.',
    ),
  );
  view.refresh.addEventListener('click', () => void showSubscriptions());
  status(view.content, copy().loading);
  const [plans, catalog, changes, recoveries] = await Promise.all([
    subscriptionPlans(),
    publishedCatalog(),
    pendingSubscriptionChanges(),
    subscriptionFundingRecovery(),
  ]);
  if (current !== generation) return;
  if (readFailure(view.content, plans, wiring.unauthenticated) || !plans.ok) return;
  const grid = h('div', { class: 'grid section-grid' });
  const addPlans = (items: readonly PlanV1[]): void => {
    for (const item of items) {
      const card = h(
        'div',
        { class: 'card simple' },
        h('h3', {}, item.name),
        h(
          'p',
          {},
          `${item.units} ${tr('غسلات', 'washes')} · ${item.validityDays} ${tr('يومًا', 'days')}`,
        ),
        h('p', {}, formatMoney(item.price)),
        h(
          'p',
          {},
          `${tr('الإصدار', 'Version')} ${item.version} · ${item.status === 'PUBLISHED' ? tr('متاحة للشراء', 'Available') : tr('متوقفة', 'Retired')}`,
        ),
      );
      if (catalog.ok && canManage() && !pendingPlan) {
        const edit = h(
          'button',
          { class: 'ghost', type: 'button' },
          tr('إصدار جديد', 'New version'),
        );
        edit.addEventListener('click', () => planForm(catalog.value, item));
        card.append(edit);
      }
      grid.append(card);
    }
  };
  addPlans(plans.value.items);
  replace(view.content, grid);
  if (pendingPlan) {
    const saved = pendingPlan;
    const retry = h(
      'button',
      { class: 'primary', type: 'button' },
      tr('متابعة نشر الخطة', 'Recover plan publication'),
    );
    retry.addEventListener('click', () => publishDialog(saved.planId, saved.body));
    view.actions.append(retry);
  } else if (catalog.ok && canManage()) {
    const create = h(
      'button',
      { class: 'primary', type: 'button' },
      tr('+ خطة اشتراك', '+ Subscription plan'),
    );
    create.addEventListener('click', () => planForm(catalog.value, null));
    view.actions.append(create);
  }
  if (!catalog.ok)
    append(
      view.content,
      h(
        'p',
        { role: 'alert' },
        tr(
          'تعذرت قراءة تعريفات الباقات اللازمة لنشر خطة.',
          'The catalog needed for plan publication is unavailable.',
        ),
      ),
    );
  let next = plans.value.nextCursor;
  if (next) {
    const more = h('button', { class: 'ghost', type: 'button' }, copy().loadMore);
    view.more.append(more);
    more.addEventListener('click', () => {
      if (!next) return;
      more.disabled = true;
      void subscriptionPlans(next).then((result) => {
        if (current !== generation) return;
        more.disabled = false;
        if (!result.ok) {
          toast(failureMessage(result.failure));
          return;
        }
        addPlans(result.value.items);
        next = result.value.nextCursor;
        more.hidden = !next;
      });
    });
  }
  const queue = h(
    'section',
    { class: 'card panel lookup-panel' },
    h('h2', {}, tr('طلبات التغيير', 'Change requests')),
  );
  view.content.append(queue);
  if (changes.ok) {
    if (!changes.value.length)
      queue.append(
        h('p', {}, tr('لا توجد طلبات بانتظار المراجعة.', 'No change requests await review.')),
      );
    for (const item of changes.value) {
      const review = h('button', { class: 'ghost', type: 'button' }, tr('مراجعة', 'Review'));
      review.addEventListener('click', () => void decide(item));
      queue.append(
        h(
          'div',
          { class: 'toolbar' },
          h(
            'span',
            {},
            `${shortRef(item.subscriptionId)} · ${actionLabel(item.action)} · ${formatInstant(item.requestedAt)}`,
          ),
          review,
        ),
      );
    }
  } else if (changes.failure === 'UNAUTHENTICATED') {
    wiring.unauthenticated();
    return;
  } else queue.append(h('p', { role: 'alert' }, failureMessage(changes.failure)));
  const recovery = h(
    'section',
    { class: 'card panel lookup-panel' },
    h('h2', {}, tr('متابعة تسوية الاشتراكات الملغاة', 'Cancelled subscription settlement')),
    h(
      'p',
      { class: 'muted' },
      tr(
        'ينتظر تحرير التمويل تسوية الحجوزات القائمة. اكتمال التحرير لا يعني تنفيذ استرداد مالي.',
        'Funding release waits for existing bookings to settle. A completed release is not a refund.',
      ),
    ),
  );
  view.content.append(recovery);
  if (recoveries.ok) {
    if (!recoveries.value.items.length)
      recovery.append(
        h('p', {}, tr('لا توجد محاولات تسوية مسجلة.', 'No settlement attempts are recorded.')),
      );
    const labels = {
      PENDING: tr('بانتظار المحاولة', 'Pending'),
      RETRYING: tr('إعادة المحاولة مجدولة', 'Retry scheduled'),
      WAITING_RESERVATIONS: tr('بانتظار تسوية الحجوزات', 'Waiting for reservations'),
      ATTENTION_REQUIRED: tr('يحتاج إلى متابعة', 'Needs attention'),
      RELEASED: tr('حُرّر التمويل', 'Funding released'),
    };
    for (const item of recoveries.value.items) {
      const row = h(
        'div',
        { class: 'toolbar' },
        h('span', {}, `${shortRef(item.subscriptionId)} · ${labels[item.status]}`),
        h(
          'span',
          { class: 'muted' },
          `${tr('المحاولات', 'Attempts')}: ${item.attempts}/${item.attemptLimit} · ${tr('المحجوز', 'Reserved')}: ${item.reservedUnits}`,
        ),
      );
      if (
        canManage() &&
        (item.status === 'ATTENTION_REQUIRED' || pendingRecoveries.has(item.subscriptionId))
      ) {
        const retry = h(
          'button',
          { class: 'ghost', type: 'button' },
          tr('مراجعة إعادة المحاولة', 'Review retry'),
        );
        retry.addEventListener('click', () => retryRecovery(item));
        row.append(retry);
      }
      recovery.append(row);
    }
  } else if (recoveries.failure === 'UNAUTHENTICATED') {
    wiring.unauthenticated();
    return;
  } else recovery.append(h('p', { role: 'alert' }, failureMessage(recoveries.failure)));
  const id = input();
  id.dir = 'ltr';
  id.placeholder = tr('رقم الاشتراك الكامل', 'Full subscription reference');
  id.setAttribute('aria-label', id.placeholder);
  const lookup = h(
    'button',
    { class: 'ghost', type: 'submit' },
    tr('عرض الاشتراك', 'Read subscription'),
  );
  const details = h('div', { 'aria-live': 'polite' });
  const form = h('form', { class: 'toolbar' }, id, lookup);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!UUID.test(id.value.trim())) {
      status(details, copy().invalid);
      return;
    }
    const request = ++lookupGeneration;
    lookup.disabled = true;
    void subscriptionById(id.value.trim()).then((result) => {
      if (current !== generation || request !== lookupGeneration) return;
      lookup.disabled = false;
      if (readFailure(details, result, wiring.unauthenticated) || !result.ok) return;
      replace(details, subscriptionDetails(result.value));
    });
  });
  view.content.append(
    h(
      'section',
      { class: 'card panel lookup-panel' },
      h('h2', {}, tr('استعلام عن اشتراك', 'Subscription lookup')),
      form,
      details,
    ),
  );
}
