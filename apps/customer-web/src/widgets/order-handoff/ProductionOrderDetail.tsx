import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import type { FinancialStatus } from '@carwash/contracts/billing-v1';
import { useProductionBooking } from '../../data/ProductionBookingProvider';
import { useCustomerProduction } from '../../data/CustomerProductionProvider';
import {
  BOOKING_LABELS,
  PAYMENT_LABELS,
  formatMoney,
  isProductionBookingId,
  type ProductionBooking,
} from '../../data/productionBookingContracts';
import { Icon } from '../../shared/Icon';
import { Sheet } from '../../shared/Sheet';
import { ReferenceArtSprite } from '../../shared/art/ReferenceArt';
import { CustomerProfileSheet } from '../customer-access/CustomerProfileSheet';
import { JourneyNotice } from '../customer-access/JourneyNotice';
import { sizeName } from '../vehicle-editor/vehicleEditorModel';
import { bookingSlotLabel } from './ProductionOrders';
import './production-orders.css';

export const PAYMENT_FOOTER_SLOT_ID = 'customer-payment-footer-slot';
const FINANCIAL_LABELS: Readonly<Record<FinancialStatus, string>> = {
  UNPAID: 'لم يبدأ التحصيل',
  AWAITING_CASH: 'الكاش مستحق بعد الغسيل',
  AWAITING_PAYMENT: 'بانتظار التحويل',
  UNDER_REVIEW: 'بانتظار مطابقة العملية',
  OUTCOME_UNKNOWN: 'نتيجة الدفع غير مؤكدة',
  PAID: 'الدفع موثّق',
  CASH_COLLECTED: 'استلام الكاش موثّق',
  VOIDED: 'أُلغي المبلغ المستحق',
};
const METHOD_OPTIONS = [
  { method: 'CASH_ON_COMPLETION', tone: 'cash', icon: 'banknote' },
  { method: 'SHAM_CASH', tone: 'sham', icon: 'wallet' },
  { method: 'SYRIATEL_CASH', tone: 'syriatel', icon: 'signal-pay' },
] as const;

function FinancialPill({ status }: { readonly status: FinancialStatus }) {
  const settled = status === 'PAID' || status === 'CASH_COLLECTED';
  return (
    <span
      className={`pay-status-pill ${settled ? 'success' : status === 'VOIDED' ? 'neutral' : status === 'OUTCOME_UNKNOWN' ? 'error' : ''}`}
    >
      <Icon name={settled ? 'check' : status === 'VOIDED' ? 'close' : 'clock'} small />
      {FINANCIAL_LABELS[status]}
    </span>
  );
}
function Summary({ booking }: { readonly booking: ProductionBooking }) {
  const { snapshot } = useProductionBooking()!;
  const packageLabel =
    snapshot.catalog?.items.find((item) =>
      booking.quote.lines.some(
        (line) => line.kind === 'PACKAGE' && line.definitionId === item.definitionId,
      ),
    )?.name.ar ?? 'العناية المحجوزة';
  const rows = [
    {
      icon: 'car' as const,
      title: booking.vehicle.model ?? sizeName(booking.vehicle.type),
      hint: [booking.vehicle.plate?.text, booking.vehicle.color].filter(Boolean).join(' · '),
    },
    {
      icon: 'spark' as const,
      title: packageLabel,
      hint: booking.quote.durationMinutes ? `${booking.quote.durationMinutes} دقيقة للعناية` : '',
    },
    {
      icon: 'pin' as const,
      title: booking.address.location.description ?? 'موقع السيارة المحفوظ',
      hint: booking.address.details ?? '',
    },
    {
      icon: 'calendar' as const,
      title: bookingSlotLabel(booking.schedule?.startsAt ?? booking.slot.startsAt),
      hint: 'توقيت دمشق',
    },
    { icon: 'user' as const, title: booking.contact.name, hint: booking.contact.phone },
  ];
  return (
    <div className="receipt">
      {rows.map((row) => (
        <div className="receipt-line" key={row.icon}>
          <Icon name={row.icon} />
          <div className="grow">
            <strong>{row.title}</strong>
            <p dir="auto">{row.hint}</p>
          </div>
        </div>
      ))}
      <div className="receipt-line">
        <Icon name="wallet" />
        <div className="grow">
          <strong>
            {booking.financialSource === 'SUBSCRIPTION'
              ? 'من رصيد الاشتراك'
              : PAYMENT_LABELS[booking.paymentMethod]}
          </strong>
          <p>
            {booking.financialSource === 'SUBSCRIPTION'
              ? 'قيمة العناية المشمولة'
              : 'الخيار عند إنشاء الحجز'}
          </p>
        </div>
        <strong>{formatMoney(booking.total)}</strong>
      </div>
    </div>
  );
}

function PaymentCard({ booking }: { readonly booking: ProductionBooking }) {
  const { snapshot } = useProductionBooking()!;
  const navigate = useNavigate();
  const obligation = snapshot.obligation;
  const method = obligation?.activeIntent?.method ?? booking.paymentMethod;
  const option = METHOD_OPTIONS.find((item) => item.method === method)!;
  if (booking.financialSource === 'SUBSCRIPTION')
    return (
      <section className="pay-status-card" aria-label="تغطية الحجز">
        <div className="row">
          <span className="pay-logo">
            <Icon name="wallet" />
          </span>
          <div className="grow">
            <h3>من رصيد الاشتراك</h3>
            <p>
              {booking.entitlementReservationId
                ? 'يرتبط هذا الحجز بحجز استحقاق لدى خدمة الاشتراكات.'
                : 'جارٍ التحقق من استحقاق الاشتراك.'}
            </p>
            <span className="pay-status-pill neutral">
              {booking.confirmation === 'CONFIRMED' ? 'تغطية اشتراك' : 'التغطية قيد المعالجة'}
            </span>
          </div>
        </div>
      </section>
    );
  return (
    <section className="pay-status-card" aria-label="حالة دفع الطلب">
      <div className="row">
        <span className={`pay-logo ${option.tone}`}>
          <Icon name={option.icon} />
        </span>
        <div className="grow">
          <h3>{PAYMENT_LABELS[method]}</h3>
          {obligation ? (
            <>
              <p>حالة الدفع منفصلة عن تقدم الغسلة.</p>
              <FinancialPill status={obligation.financialStatus} />
            </>
          ) : (
            <p>
              {snapshot.paymentStatus === 'loading'
                ? 'جارٍ تحميل حالة الدفع…'
                : 'تعذّر تأكيد حالة الدفع. لم نفترض وصول أي مبلغ.'}
            </p>
          )}
          {snapshot.paymentStatus === 'unavailable' && obligation ? (
            <p role="status">آخر حالة معروفة؛ تعذّر تحديثها الآن.</p>
          ) : null}
          <div>
            <button
              className="text-btn"
              type="button"
              onClick={() => navigate(`/pay/${booking.bookingId}`)}
            >
              تفاصيل الدفع والمتابعة <Icon name="left" small />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Tracking({ booking }: { readonly booking: ProductionBooking }) {
  const { client, snapshot } = useProductionBooking()!;
  const navigate = useNavigate();
  const [cancel, setCancel] = useState(false);
  const [details, setDetails] = useState(false);
  const terminal = ['COMPLETED', 'CANCELLED', 'EXPIRED', 'REJECTED'].includes(booking.status);
  const stages = [
    { statuses: ['CONFIRMED', 'ASSIGNED'], name: 'الحجز مؤكّد', icon: 'check' as const },
    { statuses: ['EN_ROUTE'], name: 'في الطريق', icon: 'van' as const },
    { statuses: ['ARRIVED'], name: 'وصلنا', icon: 'pin' as const },
    { statuses: ['IN_PROGRESS'], name: 'العناية', icon: 'spark' as const },
    { statuses: ['COMPLETED'], name: 'اللمعة', icon: 'check' as const },
  ];
  const current = stages.findIndex((stage) => stage.statuses.includes(booking.status));
  const blocked =
    snapshot.busy || snapshot.pending !== null || snapshot.detailStatus !== 'available';
  return (
    <>
      <div className="success-head">
        <div className="success-icon">
          <Icon
            name={
              booking.status === 'CANCELLED' || booking.status === 'REJECTED'
                ? 'close'
                : booking.confirmation === 'PENDING'
                  ? 'clock'
                  : 'check'
            }
          />
        </div>
        <h1 tabIndex={-1}>
          {booking.confirmation === 'NEEDS_ATTENTION'
            ? 'الحجز يحتاج متابعة.'
            : BOOKING_LABELS[booking.status]}
        </h1>
        <p>
          {booking.confirmation === 'PENDING'
            ? 'وصل طلب التأكيد. ننتظر اكتمال التحقق من الموعد والحساب المالي.'
            : booking.status === 'REJECTED'
              ? 'تعذّر إكمال التأكيد. راجع حالة الحساب المالي قبل طلب جديد.'
              : booking.status === 'CANCELLED'
                ? 'تم إلغاء الحجز. الاسترداد، إن وُجد، له حالة مستقلة أدناه.'
                : 'نعرض الحالة المسجلة لدى الخدمة، وتُحدّث أثناء فتح الصفحة.'}
        </p>
        <span className="order-id">{booking.bookingId}</span>
      </div>
      <PaymentCard booking={booking} />
      {current >= 0 ? (
        <section className="tracking-card" aria-label="متابعة الطلب">
          <div className="tracking-top">
            <strong>{BOOKING_LABELS[booking.status]}</strong>
            <span className="tiny muted">
              {new Date(booking.updatedAt).toLocaleTimeString('ar-SY', {
                timeZone: 'Asia/Damascus',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
          </div>
          <div className="timeline">
            {stages.map((stage, index) => (
              <div
                className={`timeline-item ${index < current ? 'done' : index === current ? 'current' : ''}`}
                key={stage.name}
                aria-current={index === current ? 'step' : undefined}
              >
                <span>
                  <Icon name={index < current ? 'check' : stage.icon} />
                </span>
                {stage.name}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {booking.pendingChange ? (
        <p className="info-note" role="status">
          {booking.pendingChange.kind === 'CANCELLATION'
            ? 'طلب الإلغاء قيد المعالجة.'
            : 'تغيير الموعد قيد المعالجة.'}{' '}
          {booking.pendingChange.attention ? 'تحتاج المعالجة إلى متابعة من فريق الخدمة.' : ''}
        </p>
      ) : null}
      {snapshot.changes
        .filter((change) => change.state !== 'IN_PROGRESS')
        .slice(0, 3)
        .map((change) => (
          <p className="input-note" key={change.changeId}>
            {change.kind === 'CANCELLATION' ? 'الإلغاء' : 'تغيير الموعد'}:{' '}
            {change.state === 'COMPLETED'
              ? 'اكتملت المعالجة'
              : change.state === 'REFUSED'
                ? 'تعذّر قبول الطلب بسبب حالة التنفيذ'
                : 'لم يكتمل التغيير'}
            .
            {change.settlement === 'REFUND_PENDING'
              ? ' طلب الاسترداد قيد المعالجة، ولم يُثبت رجوع المال بعد.'
              : ''}
          </p>
        ))}
      <div className="order-mini">
        <span>{booking.vehicle.model ?? sizeName(booking.vehicle.type)}</span>
        <strong>{formatMoney(booking.total)}</strong>
      </div>
      {booking.vehicle.plate ? (
        <div className="row between">
          <span className="tiny muted">لوحة السيارة للتعرّف عليها</span>
          <span className="plate-mini" dir="auto">
            {booking.vehicle.plate.text}
          </span>
        </div>
      ) : null}
      <div className="row between">
        <button className="text-btn" type="button" onClick={() => setDetails(true)}>
          تفاصيل الحجز
        </button>
        {!terminal && !booking.pendingChange ? (
          <button
            className="text-btn danger"
            type="button"
            disabled={blocked || booking.confirmation !== 'CONFIRMED'}
            onClick={() => setCancel(true)}
          >
            إلغاء الحجز
          </button>
        ) : null}
      </div>
      {terminal ? (
        <button
          className="btn full gap-top"
          type="button"
          disabled={blocked}
          onClick={() =>
            void client.repeat(booking).then((ready) => {
              if (ready) navigate('/book/0');
            })
          }
        >
          حجز جديد بنفس التفاصيل <Icon name="refresh" small />
        </button>
      ) : null}
      <Sheet open={details} title="كل تفاصيل غسلتك." onClose={() => setDetails(false)}>
        <Summary booking={booking} />
        <button className="btn full gap-top" type="button" onClick={() => setDetails(false)}>
          العودة إلى الغسلة
        </button>
      </Sheet>
      <Sheet open={cancel} title="هل تريد إلغاء الحجز؟" onClose={() => setCancel(false)}>
        <p className="sheet-intro">
          تتحقق الخدمة من إمكانية الإلغاء بحسب تقدم التنفيذ. قبول الطلب لا يعني اكتمال الإلغاء أو
          رجوع أي مبلغ فورًا.
        </p>
        <JourneyNotice />
        <button
          className="btn full"
          type="button"
          disabled={blocked}
          onClick={() =>
            void client.cancelBooking().then((accepted) => {
              if (accepted) setCancel(false);
            })
          }
        >
          طلب إلغاء الحجز
        </button>
        <button className="btn secondary full" type="button" onClick={() => setCancel(false)}>
          الاحتفاظ بالحجز
        </button>
      </Sheet>
    </>
  );
}

function Checkout({ booking }: { readonly booking: ProductionBooking }) {
  const { client, snapshot } = useProductionBooking()!;
  const navigate = useNavigate();
  const [reference, setReference] = useState('');
  const [proof, setProof] = useState(false);
  const [changing, setChanging] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const obligation = snapshot.obligation;
  const blocked =
    snapshot.busy || snapshot.pending !== null || snapshot.paymentStatus !== 'available';
  useEffect(() => {
    setSlot(document.getElementById(PAYMENT_FOOTER_SLOT_ID));
  }, []);
  if (booking.financialSource === 'SUBSCRIPTION')
    return (
      <>
        <div className="page-heading">
          <h1 tabIndex={-1}>حجز من رصيد الاشتراك.</h1>
          <p>
            {booking.entitlementReservationId
              ? 'تتابع خدمة الاشتراكات الاستحقاق المرتبط بهذا الحجز.'
              : 'لم يكتمل تأكيد الاستحقاق بعد.'}
          </p>
        </div>
        <div className="info-note">
          <Icon name="wallet" />
          <span>لا ننشئ مطالبة دفع إضافية لهذا الحجز. التغطية لا تعني تسجيل تحصيل مالي جديد.</span>
        </div>
        <Summary booking={booking} />
        <button
          className="btn full gap-top"
          type="button"
          onClick={() => navigate(`/order/${booking.bookingId}`)}
        >
          متابعة غسلتك
        </button>
      </>
    );
  if (!obligation)
    return (
      <>
        <div className="page-heading">
          <h1 tabIndex={-1}>حالة الدفع.</h1>
        </div>
        <p className="info-note">
          {snapshot.paymentStatus === 'loading'
            ? 'جارٍ تحميل حساب الحجز…'
            : 'لم تتوفر حالة موثّقة للدفع بعد. أعد التحقق من حساب الحجز.'}
        </p>
        <button
          className="btn full"
          type="button"
          onClick={() => void client.loadPayment(booking.bookingId)}
        >
          تحديث حالة الدفع
        </button>
      </>
    );
  const status = obligation.financialStatus;
  const method = obligation.activeIntent?.method ?? booking.paymentMethod;
  const settled = status === 'PAID' || status === 'CASH_COLLECTED';
  const claimAllowed =
    obligation.status === 'OPEN' &&
    obligation.activeIntent?.status === 'AWAITING_CUSTOMER_PAYMENT' &&
    method !== 'CASH_ON_COMPLETION' &&
    !['CANCELLED', 'REJECTED', 'EXPIRED'].includes(booking.status);
  const methodAllowed =
    obligation.status === 'OPEN' &&
    (obligation.activeIntent === null ||
      ['AWAITING_CUSTOMER_PAYMENT', 'AWAITING_CASH_COLLECTION'].includes(
        obligation.activeIntent.status,
      )) &&
    obligation.attempts.length === 0 &&
    !['CANCELLED', 'REJECTED', 'EXPIRED'].includes(booking.status);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (blocked) return;
    void client.submitPaymentReference(reference).then((ok) => {
      if (ok) {
        setReference('');
        setProof(false);
      }
    });
  };
  return (
    <>
      <div className="pay-flow-status">
        <div className={`pay-orbit ${settled ? 'success' : ''}`}>
          <Icon name={settled ? 'check' : status === 'AWAITING_CASH' ? 'banknote' : 'clock'} />
        </div>
        <h1 tabIndex={-1}>
          {status === 'AWAITING_CASH' ? (
            <>
              نغسلها أولًا.
              <br />
              والكاش بعدها.
            </>
          ) : (
            FINANCIAL_LABELS[status]
          )}
        </h1>
        <p>
          {status === 'UNDER_REVIEW' || status === 'OUTCOME_UNKNOWN' ? (
            <>
              إرسال رقم العملية لا يعني وصول المبلغ.
              <br />
              <strong>لا تعِد التحويل، حتى لا تدفع مرتين.</strong>
            </>
          ) : settled ? (
            'أكدت الخدمة استلام المبلغ. تفاصيل التحصيل موثّقة أدناه.'
          ) : status === 'AWAITING_CASH' ? (
            'يبقى المبلغ مستحقًا حتى يسجل الفني استلامه بعد الغسيل.'
          ) : (
            'حالة الدفع تأتي من الحساب المالي للحجز.'
          )}
        </p>
      </div>
      <div className="pay-mini-receipt">
        <div className="pay-receipt-line total">
          <span>إجمالي الحجز</span>
          <strong>{formatMoney(obligation.amount)}</strong>
        </div>
        <div className="pay-receipt-line">
          <span>طريقة الدفع</span>
          <strong>{PAYMENT_LABELS[method]}</strong>
        </div>
        <div className="pay-receipt-line">
          <span>الحالة</span>
          <FinancialPill status={status} />
        </div>
        <div className="pay-receipt-line">
          <span>المبلغ الموثّق</span>
          <strong>{formatMoney(obligation.verified)}</strong>
        </div>
        <div className="pay-receipt-line">
          <span>المبلغ المتبقي</span>
          <strong>{formatMoney(obligation.outstanding)}</strong>
        </div>
        <div className="pay-receipt-line">
          <span>مرجع الطلب</span>
          <strong className="ltr">{booking.bookingId}</strong>
        </div>
        {obligation.attempts.map((attempt) => (
          <div className="pay-receipt-line" key={attempt.attemptId}>
            <span>رقم العملية المرسل</span>
            <strong dir="ltr">
              {attempt.reference} ·{' '}
              {attempt.status === 'MATCHED'
                ? 'مطابق'
                : attempt.status === 'MISMATCHED'
                  ? 'غير مطابق'
                  : attempt.status === 'UNKNOWN'
                    ? 'غير محسوم'
                    : 'قيد المراجعة'}
            </strong>
          </div>
        ))}
      </div>
      {snapshot.paymentStatus === 'unavailable' ? (
        <p className="error" role="alert">
          تعذّر تحديث الحساب المالي. هذه آخر حالة معروفة؛ أعد التحقق قبل أي إجراء.
        </p>
      ) : null}
      {claimAllowed ? (
        <div className="info-note">
          <Icon name="info" />
          <span>
            بيانات مستفيد موثّقة غير متاحة هنا حاليًا. لا ترسل تحويلًا جديدًا من هذه الصفحة. إذا
            حوّلت مسبقًا إلى حساب الخدمة، يمكنك إرسال رقم العملية للمراجعة.
          </span>
        </div>
      ) : null}
      {status === 'AWAITING_CASH' ? (
        <div className="info-note">
          <Icon name="info" />
          <span>اكتمال الغسيل لا يغيّر حالة الدفع تلقائيًا.</span>
        </div>
      ) : null}
      {snapshot.refunds && snapshot.refunds.items.length > 0 ? (
        <div className="pay-mini-receipt">
          <h3>حالة الاسترداد</h3>
          {snapshot.refunds.items.map((refund) => (
            <div className="pay-receipt-line" key={refund.refundId}>
              <span>
                {refund.status === 'SUCCEEDED'
                  ? 'استرداد موثّق'
                  : refund.status === 'FAILED'
                    ? 'تعذّر الاسترداد'
                    : refund.status === 'OUTCOME_UNKNOWN'
                      ? 'نتيجة الاسترداد غير محسومة'
                      : 'طلب استرداد قيد المعالجة'}
              </span>
              <strong>{formatMoney(refund.amount)}</strong>
            </div>
          ))}
        </div>
      ) : null}
      <div className="row between">
        <button
          className="text-btn"
          type="button"
          disabled={snapshot.busy}
          onClick={() => void client.loadPayment(booking.bookingId)}
        >
          تحديث حالة الدفع
        </button>
        {methodAllowed ? (
          <button
            className="text-btn"
            type="button"
            disabled={blocked}
            onClick={() => setChanging(true)}
          >
            تغيير طريقة الدفع
          </button>
        ) : null}
      </div>
      <div className="pay-safe">
        <Icon name="lock" />
        <span>
          لا تدخل كلمة مرور المحفظة أو رمز OTP. يعتمد التأكيد على التحصيل الموثّق من الخدمة.
        </span>
      </div>
      <Sheet open={proof} title="رقم العملية للمراجعة." onClose={() => setProof(false)}>
        <p className="sheet-intro">
          أرسل رقم العملية كما ظهر في محفظتك بعد التحويل. تقديم الرقم لا يثبت وصول المبلغ، ولا
          يستدعي تحويلًا آخر.
        </p>
        <form onSubmit={submit}>
          <label className="field">
            <span className="field-label">رقم العملية</span>
            <input
              className="input ltr"
              name="providerReference"
              maxLength={64}
              autoComplete="off"
              value={reference}
              disabled={blocked}
              onChange={(event) => setReference(event.target.value)}
            />
          </label>
          <JourneyNotice />
          <button className="btn full gap-top" type="submit" disabled={blocked}>
            إرسال للمراجعة
          </button>
        </form>
      </Sheet>
      <Sheet
        open={changing}
        title="تغيير الطريقة، دون دفع مرتين."
        onClose={() => setChanging(false)}
      >
        <p className="sheet-intro">
          تابع فقط إذا <strong>لم تُجرِ أي تحويل</strong>. إذا حولت فعلًا، احتفظ بالطريقة الحالية
          وأرسل رقم العملية للمراجعة.
        </p>
        {METHOD_OPTIONS.filter((item) => item.method !== method).map((option) => (
          <button
            key={option.method}
            className="pay-change-option"
            type="button"
            disabled={blocked}
            onClick={() =>
              void client.changePayment(option.method).then((ok) => {
                if (ok) setChanging(false);
              })
            }
          >
            <span className={`pay-logo ${option.tone}`}>
              <Icon name={option.icon} />
            </span>
            <span>
              <strong>{PAYMENT_LABELS[option.method]}</strong>
              <small>لم أحوّل مالًا · استخدم هذه الطريقة</small>
            </span>
          </button>
        ))}
        <JourneyNotice />
        <button
          className="btn secondary full gap-top"
          type="button"
          onClick={() => setChanging(false)}
        >
          الاحتفاظ بالطريقة الحالية
        </button>
      </Sheet>
      {slot
        ? createPortal(
            <footer className="pay-footer">
              <button
                className="btn"
                type="button"
                disabled={claimAllowed && blocked}
                onClick={() =>
                  claimAllowed ? setProof(true) : navigate(`/order/${booking.bookingId}`)
                }
              >
                <Icon name={claimAllowed ? 'receipt-pay' : 'arrow'} small />
                {claimAllowed ? 'أرسلت التحويل · طلب مراجعة' : 'متابعة غسلتك'}
              </button>
              <small>
                {status === 'UNDER_REVIEW' || status === 'OUTCOME_UNKNOWN'
                  ? 'لا تُجرِ تحويلًا ثانيًا أثناء المراجعة.'
                  : 'يمكنك العودة إلى حالة الدفع من حجوزاتي.'}
              </small>
            </footer>,
            slot,
          )
        : null}
    </>
  );
}

/** Reload reads persisted owner records. No draft or local order is trusted as an order. */
export function ProductionOrderDetail({ kind }: { readonly kind: 'tracking' | 'payment' }) {
  const { orderId = '' } = useParams();
  const { client, snapshot } = useProductionBooking()!;
  const customer = useCustomerProduction()!;
  const [access, setAccess] = useState(false);
  const inFlight = useRef(false);
  const principal = snapshot.principal?.subjectId;
  const validId = isProductionBookingId(orderId);
  useEffect(() => {
    if (!principal || !validId) return;
    let disposed = false;
    const refresh = async () => {
      if (disposed || inFlight.current || document.visibilityState === 'hidden') return;
      inFlight.current = true;
      try {
        await client.loadBooking(orderId);
        if (!disposed)
          await Promise.all([client.loadPayment(orderId), client.loadChanges(orderId)]);
      } finally {
        inFlight.current = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    const onVisible = () => void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [client, orderId, principal, validId]);
  const booking = snapshot.selectedBooking?.bookingId === orderId ? snapshot.selectedBooking : null;
  return (
    <div data-customer-route={kind} data-runtime="production">
      <ReferenceArtSprite />
      {!principal ? (
        <>
          <div className="page-heading">
            <h1 tabIndex={-1}>تفاصيل حجزك.</h1>
          </div>
          <p className="info-note">سجّل الدخول أو استعد جلسة الضيف التي أنشأت هذا الحجز.</p>
          <button
            className="btn full"
            type="button"
            disabled={customer.snapshot.loading}
            onClick={() => setAccess(true)}
          >
            الدخول إلى الحجز
          </button>
          <CustomerProfileSheet open={access} onClose={() => setAccess(false)} />
        </>
      ) : !validId || snapshot.detailStatus === 'missing' ? (
        <>
          <div className="page-heading">
            <h1 tabIndex={-1}>الحجز غير متاح.</h1>
          </div>
          <p className="info-note">تحقق من رابط الحجز والجلسة المستخدمة.</p>
        </>
      ) : booking ? (
        kind === 'tracking' ? (
          <Tracking booking={booking} />
        ) : (
          <Checkout booking={booking} />
        )
      ) : (
        <p className="info-note" role="status">
          {snapshot.detailStatus === 'unavailable'
            ? 'تعذّر تحميل تفاصيل الحجز.'
            : 'جارٍ تحميل الحجز…'}
        </p>
      )}
      {snapshot.detailStatus === 'unavailable' && booking ? (
        <p className="error" role="alert">
          تعذّر تحديث حالة الحجز. تُعرض آخر حالة معروفة.
        </p>
      ) : null}
      {principal && validId ? (
        <button
          className="text-btn full gap-top"
          type="button"
          disabled={snapshot.busy}
          onClick={() => void client.loadBooking(orderId)}
        >
          تحديث الحجز
        </button>
      ) : null}
      <JourneyNotice />
    </div>
  );
}
