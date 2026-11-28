import { useEffect, useState, type FormEvent } from 'react';
import type { FinancialStatus } from '@carwash/contracts/billing-v1';
import type {
  PurchaseStatus,
  SubscriptionChangeAction,
  SubscriptionChangeStatus,
  SubscriptionStatus,
} from '@carwash/contracts/subscription-v1';
import { useProductionMembership } from '../../data/ProductionMembershipProvider';
import { useCustomerProduction } from '../../data/CustomerProductionProvider';
import { useProductionBooking } from '../../data/ProductionBookingProvider';
import { isMembershipId } from '../../data/productionMembership';
import { damascusSlot } from '../../data/productionDate';
import { formatMoney, PAYMENT_LABELS } from '../../data/productionBookingContracts';
import { Icon } from '../../shared/Icon';
import { Sheet } from '../../shared/Sheet';
import { sizeName } from '../vehicle-editor/vehicleEditorModel';

const PURCHASE_LABELS: Readonly<Record<PurchaseStatus, string>> = {
  PENDING_PAYMENT: 'بانتظار الدفع',
  PAYMENT_UNDER_REVIEW: 'العملية قيد المطابقة',
  PAYMENT_UNKNOWN: 'نتيجة الدفع غير مؤكدة',
  ACTIVATED: 'الاشتراك مفعّل',
  REJECTED: 'لم يُعتمد الشراء',
  EXPIRED: 'انتهت صلاحية الشراء',
};
const SUBSCRIPTION_LABELS: Readonly<Record<SubscriptionStatus, string>> = {
  ACTIVE: 'نشط',
  FROZEN: 'مجمّد',
  EXHAUSTED: 'استهلكت الغسلات',
  EXPIRED: 'انتهت المدة',
  CANCELLED: 'ملغى',
};
const FINANCIAL_LABELS: Readonly<Record<FinancialStatus, string>> = {
  UNPAID: 'لم يبدأ التحصيل',
  AWAITING_CASH: 'بانتظار التحصيل النقدي',
  AWAITING_PAYMENT: 'بانتظار التحويل',
  UNDER_REVIEW: 'بانتظار مطابقة العملية',
  OUTCOME_UNKNOWN: 'نتيجة التحويل غير مؤكدة',
  PAID: 'الدفع موثّق',
  CASH_COLLECTED: 'استلام النقد موثّق',
  VOIDED: 'أُلغي المبلغ المستحق',
};
const CHANGE_LABELS: Readonly<Record<SubscriptionChangeStatus, string>> = {
  APPLIED: 'اعتمد التغيير',
  SCHEDULED: 'جُدول التغيير',
  PENDING_REVIEW: 'الطلب بانتظار المراجعة',
  REJECTED: 'لم يُعتمد التغيير',
};
const ACTION_LABELS: Readonly<Record<SubscriptionChangeAction, string>> = {
  FREEZE: 'طلب تجميد',
  RESUME: 'طلب استئناف',
  CANCEL: 'طلب إلغاء الاشتراك',
};

/** Production-only owner data, inside the approved sheet and field components. */
function MembershipBody({ onSignIn }: { readonly onSignIn: () => void }) {
  const { client, snapshot } = useProductionMembership()!;
  const booking = useProductionBooking()!;
  const [method, setMethod] = useState<'SHAM_CASH' | 'SYRIATEL_CASH'>('SHAM_CASH');
  const [reference, setReference] = useState('');
  const [lookup, setLookup] = useState('');
  const [lookupProblem, setLookupProblem] = useState<string | null>(null);
  const [change, setChange] = useState<{
    subscriptionId: string;
    action: SubscriptionChangeAction;
  } | null>(null);
  const principalId = snapshot.principal?.subjectId;
  useEffect(() => {
    void client.loadPlans();
    if (!booking.snapshot.catalog) void booking.client.loadCatalog();
    if (principalId) void client.loadSubscriptions();
  }, [client, principalId, booking.client]);

  const purchaseId = snapshot.purchase?.purchaseId;
  const purchaseStatus = snapshot.purchase?.status;
  useEffect(() => {
    if (!purchaseId) return;
    let active = true;
    let running = false;
    const refresh = async () => {
      const current = client.getSnapshot();
      if (
        !active ||
        running ||
        document.visibilityState === 'hidden' ||
        current.busy ||
        current.pending ||
        current.unknownPurchaseKey
      )
        return;
      running = true;
      try {
        await client.loadPurchase(purchaseId);
      } finally {
        running = false;
      }
    };
    void refresh();
    if (purchaseStatus === 'ACTIVATED') void client.loadSubscriptions();
    const terminal =
      purchaseStatus === 'ACTIVATED' ||
      purchaseStatus === 'REJECTED' ||
      purchaseStatus === 'EXPIRED';
    const timer = terminal ? null : window.setInterval(() => void refresh(), 5000);
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [client, purchaseId, purchaseStatus]);

  const blocked =
    snapshot.busy || snapshot.pending !== null || snapshot.unknownPurchaseKey !== null;
  const purchase = snapshot.purchase;
  const obligation = snapshot.obligation;
  const quote = snapshot.quote;
  const selectedPlan = snapshot.selectedPlan;
  const lookupPurchase = (event: FormEvent) => {
    event.preventDefault();
    const value = lookup.trim();
    if (!isMembershipId(value)) {
      setLookupProblem('أدخل معرّف الشراء كاملًا من إيصالك.');
      return;
    }
    setLookupProblem(null);
    setReference('');
    void client.loadPurchase(value);
  };
  const submitReference = (event: FormEvent) => {
    event.preventDefault();
    void client.submitReference(reference).then((accepted) => {
      if (accepted) setReference('');
    });
  };

  return (
    <div className="stack" data-customer-memberships>
      <p className="sheet-intro">
        غسلاتك ضمن خطة منشورة. يبدأ الاشتراك بعد توثيق الدفع، وتُراجع تغطية الباقة والموعد عند كل
        حجز.
      </p>
      {!snapshot.principal ? (
        <div className="info-note">
          <Icon name="user" />
          <div className="grow">
            <p>تحتاج الاشتراكات إلى حساب مسجّل. يمكنك الاطلاع على الخطط قبل الدخول.</p>
            <button className="text-btn" type="button" onClick={onSignIn}>
              فتح بياناتي والدخول
            </button>
          </div>
        </div>
      ) : null}
      {snapshot.problem ? (
        <p className="error" role="alert">
          {snapshot.problem}
        </p>
      ) : null}
      {snapshot.pending ? (
        <div className="info-note" role="status">
          <Icon name="info" />
          <div className="grow">
            <p>
              {snapshot.busy
                ? 'جارٍ إرسال الطلب…'
                : 'نتيجة الطلب غير محسومة. بقي الاختيار محفوظًا لإعادة المحاولة نفسها.'}
            </p>
            {!snapshot.busy ? (
              <button
                className="btn secondary full"
                type="button"
                onClick={() => void client.retryPending()}
              >
                إعادة إرسال الطلب نفسه
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {snapshot.unknownPurchaseKey ? (
        <button
          className="btn secondary full"
          type="button"
          disabled={snapshot.busy || snapshot.purchaseStatus === 'loading'}
          onClick={() => void client.recoverPurchase()}
        >
          التحقق من الشراء السابق
        </button>
      ) : null}

      {snapshot.principal ? (
        <section aria-label="اشتراكاتي الحالية">
          <div className="row between">
            <h3>اشتراكاتي</h3>
            <button
              className="text-btn"
              type="button"
              disabled={snapshot.subscriptionsStatus === 'loading' || blocked}
              onClick={() => void client.loadSubscriptions()}
            >
              تحديث
            </button>
          </div>
          {snapshot.subscriptionsStatus === 'loading' ? (
            <p className="input-note" role="status">
              جارٍ قراءة الاشتراكات…
            </p>
          ) : null}
          {snapshot.subscriptionsStatus === 'unavailable' ? (
            <p className="error" role="status">
              تعذّر تحديث اشتراكاتك. البيانات المعروضة هي آخر قراءة ناجحة.
            </p>
          ) : null}
          {snapshot.subscriptionsStatus === 'available' && snapshot.subscriptions.length === 0 ? (
            <p className="input-note">لا توجد اشتراكات مفعّلة أو سابقة لهذا الحساب.</p>
          ) : null}
          {snapshot.subscriptions.map((subscription) => (
            <div className="bill" key={subscription.subscriptionId}>
              <div className="row between">
                <h3>اشتراك {subscription.units.total} غسلات</h3>
                <strong>{SUBSCRIPTION_LABELS[subscription.status]}</strong>
              </div>
              <p className="input-note">
                {subscription.units.available} متاحة · {subscription.units.reserved} محجوزة ·{' '}
                {subscription.units.consumed} مستخدمة
                <br />
                حتى {damascusSlot(subscription.expiresAt)}
              </p>
              <p className="input-note">
                تُحدّد الباقات المشمولة وفق الخطة التي اشتريتها. يتحقق النظام من أهليتها عند اختيار
                الموعد.
              </p>
              {client.canRenew(subscription) ? (
                <button
                  className="text-btn"
                  type="button"
                  disabled={blocked || snapshot.subscriptionsStatus !== 'available'}
                  onClick={() => void client.chooseRenewal(subscription.subscriptionId)}
                >
                  مراجعة شراء فترة جديدة
                </button>
              ) : null}
              {(['FREEZE', 'RESUME', 'CANCEL'] as const)
                .filter((action) =>
                  action === 'RESUME'
                    ? subscription.status === 'FROZEN'
                    : action === 'FREEZE'
                      ? subscription.status === 'ACTIVE'
                      : subscription.status === 'ACTIVE' || subscription.status === 'FROZEN',
                )
                .map((action) => (
                  <button
                    className="text-btn"
                    key={action}
                    type="button"
                    disabled={blocked || snapshot.subscriptionsStatus !== 'available'}
                    onClick={() =>
                      setChange({ subscriptionId: subscription.subscriptionId, action })
                    }
                  >
                    {ACTION_LABELS[action]}
                  </button>
                ))}
              {change?.subscriptionId === subscription.subscriptionId ? (
                <div className="info-note">
                  <Icon name="info" />
                  <div className="grow">
                    <p>
                      {change.action === 'CANCEL'
                        ? 'إلغاء الاشتراك لا يلغي حجوزاتك ولا يعيد مبلغًا تلقائيًا. يُرسل طلبك للمراجعة.'
                        : 'يُرسل طلبك للمراجعة. التجميد لا يمدّد تاريخ انتهاء المدة المدفوعة.'}
                    </p>
                    <button
                      className="btn full"
                      type="button"
                      disabled={blocked}
                      onClick={() => {
                        const request = change;
                        void client
                          .requestChange(request.subscriptionId, request.action)
                          .then((accepted) => {
                            if (accepted) setChange(null);
                          });
                      }}
                    >
                      تأكيد {ACTION_LABELS[change.action]}
                    </button>
                    <button
                      className="btn secondary full"
                      type="button"
                      disabled={blocked}
                      onClick={() => setChange(null)}
                    >
                      رجوع
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
          {snapshot.subscriptionsCursor ? (
            <button
              className="btn secondary full"
              type="button"
              disabled={snapshot.subscriptionsStatus === 'loading'}
              onClick={() => void client.loadSubscriptions(true)}
            >
              عرض المزيد من الاشتراكات
            </button>
          ) : null}
          {snapshot.change ? (
            <p className="info-note" role="status">
              {ACTION_LABELS[snapshot.change.action]}: {CHANGE_LABELS[snapshot.change.status]}. حالة
              الاشتراك المعروضة تأتي من الخدمة.
            </p>
          ) : null}
        </section>
      ) : null}

      {purchase ? (
        <section className="bill" aria-label="متابعة شراء الاشتراك">
          <div className="row between">
            <h3>شراء الاشتراك</h3>
            <strong>{PURCHASE_LABELS[purchase.status]}</strong>
          </div>
          <label className="field">
            <span className="field-label">معرّف الشراء — احتفظ به للمتابعة</span>
            <input
              className="input ltr"
              readOnly
              value={purchase.purchaseId}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <p className="input-note">
            {formatMoney(purchase.total)} · {PAYMENT_LABELS[purchase.paymentMethod]}
          </p>
          {purchase.renewalOf ? (
            <p className="input-note">
              تجديد الاشتراك للفترة {purchase.renewalOf.periodNo}. لا تتاح غسلات الفترة الجديدة قبل
              اعتماد الدفع والتفعيل من الخدمة.
            </p>
          ) : null}
          {snapshot.purchaseStatus === 'unavailable' ? (
            <p className="error" role="status">
              تعذّر تحديث الشراء. هذه آخر حالة معروفة.
            </p>
          ) : null}
          {purchase.status === 'ACTIVATED' ? (
            <p className="info-note" role="status">
              اعتمدت الخدمة التفعيل بعد التحقق من الدفع. يظهر رصيدك في قائمة اشتراكاتي.
            </p>
          ) : (
            <p className="input-note">
              إدخال رقم العملية لا يفعّل الاشتراك. تكتمل المراجعة عبر مطابقة التحويل لدى جهة الدفع.
            </p>
          )}
          {obligation ? (
            <>
              <div className="row between">
                <span>حالة الدفع</span>
                <strong>{FINANCIAL_LABELS[obligation.financialStatus]}</strong>
              </div>
              <div className="row between">
                <span>المبلغ الموثّق</span>
                <strong>{formatMoney(obligation.verified)}</strong>
              </div>
              {obligation.financialStatus === 'AWAITING_PAYMENT' &&
              purchase.status !== 'ACTIVATED' ? (
                <form onSubmit={submitReference}>
                  <p className="input-note">
                    تعليمات التحويل غير متاحة في التطبيق الآن. إذا أجريت التحويل عبر قناة الخدمة،
                    أدخل رقم عمليته للمتابعة.
                  </p>
                  <label className="field">
                    <span className="field-label">رقم عملية التحويل</span>
                    <input
                      className="input ltr"
                      type="text"
                      autoComplete="off"
                      maxLength={64}
                      value={reference}
                      disabled={blocked}
                      onChange={(event) => setReference(event.target.value)}
                    />
                  </label>
                  <button
                    className="btn full"
                    type="submit"
                    disabled={blocked || !reference.trim()}
                  >
                    إرسال رقم العملية للمطابقة
                  </button>
                </form>
              ) : null}
            </>
          ) : (
            <p className="input-note">
              {purchase.obligationId
                ? 'جارٍ قراءة حالة الدفع من الخدمة…'
                : 'لم يظهر التزام مالي بعد. لا تُعد هذه الحالة دفعًا أو تفعيلًا.'}
            </p>
          )}
          <button
            className="btn secondary full"
            type="button"
            disabled={snapshot.purchaseStatus === 'loading' || blocked}
            onClick={() => void client.loadPurchase(purchase.purchaseId)}
          >
            تحديث حالة الشراء والدفع
          </button>
        </section>
      ) : null}

      {quote && selectedPlan ? (
        <section className="bill" aria-label="مراجعة شراء الخطة">
          <h3>{selectedPlan.name}</h3>
          <p className="input-note">
            {selectedPlan.units} غسلات · {selectedPlan.validityDays} يومًا من التفعيل
          </p>
          <p className="input-note">
            {selectedPlan.vehicleTypes.map(sizeName).join(' · ')}
            <br />
            {selectedPlan.packageIds
              .map(
                (id) =>
                  booking.snapshot.catalog?.items.find((item) => item.definitionId === id)?.name
                    .ar ?? 'تفاصيل الباقة غير متاحة',
              )
              .join(' · ')}
          </p>
          <div className="row between">
            <span>الإجمالي المعتمد</span>
            <strong>{formatMoney(quote.total)}</strong>
          </div>
          <p className="input-note">عرض السعر صالح حتى {damascusSlot(quote.expiresAt)}.</p>
          <label className="field">
            <span className="field-label">طريقة الدفع المسبق</span>
            <select
              className="input"
              value={method}
              disabled={blocked}
              onChange={(event) =>
                setMethod(event.target.value === 'SYRIATEL_CASH' ? 'SYRIATEL_CASH' : 'SHAM_CASH')
              }
            >
              <option value="SHAM_CASH">شام كاش</option>
              <option value="SYRIATEL_CASH">سيريتل كاش</option>
            </select>
          </label>
          <p className="input-note">
            {snapshot.renewalTarget
              ? 'هذا الطلب يشتري فترة جديدة للاشتراك المنتهي بدفعة مستقلة. لا تُرحّل الغسلات القديمة ولا يحدث خصم تلقائي. يبدأ الرصيد الجديد بعد توثيق الدفع والتفعيل.'
              : 'هذا الطلب يبدأ شراء اشتراك مدفوع مسبقًا. لن يُفعّل قبل توثيق التحويل.'}
          </p>
          <button
            className="btn full"
            type="button"
            disabled={blocked}
            onClick={() => void client.purchase(method)}
          >
            {snapshot.renewalTarget ? 'تأكيد شراء فترة جديدة' : 'تأكيد طلب شراء الاشتراك'}
          </button>
          <button
            className="btn secondary full"
            type="button"
            disabled={blocked}
            onClick={() =>
              void (snapshot.renewalTarget
                ? client.chooseRenewal(snapshot.renewalTarget.subscriptionId)
                : client.choosePlan(selectedPlan.planId))
            }
          >
            تحديث عرض السعر
          </button>
        </section>
      ) : null}

      <section aria-label="الخطط المنشورة">
        <div className="row between">
          <h3>الخطط المتاحة</h3>
          <button
            className="text-btn"
            type="button"
            disabled={snapshot.plansStatus === 'loading'}
            onClick={() => {
              void client.loadPlans();
              void booking.client.loadCatalog();
            }}
          >
            تحديث
          </button>
        </div>
        {snapshot.plansStatus === 'loading' ? (
          <p className="input-note" role="status">
            جارٍ تحميل الخطط…
          </p>
        ) : null}
        {snapshot.plansStatus === 'unavailable' ? (
          <p className="error" role="status">
            تعذّر تحديث الخطط. لا يمكن اعتماد خطة لم تُقرأ من الخدمة.
          </p>
        ) : null}
        {snapshot.plansStatus === 'available' &&
        snapshot.plans.every((plan) => plan.status !== 'PUBLISHED') ? (
          <p className="input-note">لا توجد خطط منشورة للشراء الآن.</p>
        ) : null}
        {snapshot.plans
          .filter((plan) => plan.status === 'PUBLISHED')
          .map((plan) => {
            const names = plan.packageIds.map(
              (id) =>
                booking.snapshot.catalog?.items.find((item) => item.definitionId === id)?.name.ar,
            );
            const coverageKnown = names.every(Boolean);
            return (
              <div className="bill" key={plan.planId}>
                <div className="row between">
                  <h3>{plan.name}</h3>
                  <strong>{formatMoney(plan.price)}</strong>
                </div>
                <p className="input-note">
                  {plan.units} غسلات · {plan.validityDays} يومًا
                  <br />
                  {plan.vehicleTypes.map(sizeName).join(' · ')}
                  <br />
                  {coverageKnown ? names.join(' · ') : 'تعذّر تحميل تفاصيل الباقات المشمولة.'}
                </p>
                <button
                  className="btn secondary full"
                  type="button"
                  disabled={
                    !snapshot.principal ||
                    blocked ||
                    snapshot.plansStatus !== 'available' ||
                    !coverageKnown
                  }
                  onClick={() => void client.choosePlan(plan.planId)}
                >
                  مراجعة السعر والشراء
                </button>
              </div>
            );
          })}
        {snapshot.plansCursor ? (
          <button
            className="btn secondary full"
            type="button"
            disabled={snapshot.plansStatus === 'loading'}
            onClick={() => void client.loadPlans(true)}
          >
            عرض المزيد من الخطط
          </button>
        ) : null}
      </section>
      {snapshot.principal ? (
        <details>
          <summary>متابعة شراء برقم الإيصال</summary>
          <form onSubmit={lookupPurchase}>
            <label className="field">
              <span className="field-label">معرّف الشراء</span>
              <input
                className="input ltr"
                value={lookup}
                autoComplete="off"
                maxLength={36}
                disabled={blocked}
                onChange={(event) => setLookup(event.target.value)}
              />
            </label>
            {lookupProblem ? (
              <p className="error" role="alert">
                {lookupProblem}
              </p>
            ) : null}
            <button
              className="btn secondary full"
              type="submit"
              disabled={blocked || snapshot.purchaseStatus === 'loading'}
            >
              قراءة الشراء المحفوظ
            </button>
          </form>
        </details>
      ) : null}
    </div>
  );
}

export function CustomerSubscriptionSheet({
  open,
  onClose,
  onSignIn,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSignIn: () => void;
}) {
  const membership = useProductionMembership();
  const customer = useCustomerProduction();
  if (!membership || !customer) return null;
  const session = customer.snapshot.session;
  const identity = session
    ? `${session.subject}:${session.sessionId}:${session.authVersion}`
    : 'anonymous';
  return (
    <Sheet open={open} title="اشتراكاتي" onClose={onClose} contentKey={identity}>
      <MembershipBody key={identity} onSignIn={onSignIn} />
    </Sheet>
  );
}
