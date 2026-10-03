import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { illustrativeCost } from '../../../fixtures/customerCatalogFixture';
import { Icon } from '../../../shared/Icon';
import { Price } from '../../../shared/Price';
import {
  PAYMENT_METHODS,
  PAYMENT_REQUIRED_MESSAGE,
  PAYMENT_STEP_INDEX,
  paymentMethodDefinition,
  selectPaymentMethod,
  submitPaymentStep,
} from '../../../state/paymentStep';
import { useCustomerSession } from '../../../state/CustomerSessionProvider';
import { pathForIntent } from '../../../state/navigationPath';
import type { PaymentMethodId } from '../../../state/bookingDraft';
import { BookingFooter } from '../BookingFooter';
import { BookingProgress } from '../BookingProgress';
import { bookingFlow } from '../bookingFlow';
import { buildPriceBreakdown } from '../priceBreakdown';
import './payment.css';

const DOCUMENT_TITLE = `${bookingFlow[PAYMENT_STEP_INDEX].label} — WashGo Signature`;

function WalletArt() {
  return (
    <svg className="pay-hero-art" viewBox="0 0 120 130" aria-hidden="true">
      <defs>
        <linearGradient id="pw-card" x2="0.7" y2="1">
          <stop stopColor="#edf9d2" />
          <stop offset="1" stopColor="#aacb76" />
        </linearGradient>
      </defs>
      <g transform="rotate(12 60 55)">
        <rect x="18" y="10" width="83" height="58" rx="12" fill="#d6ebc1" />
        <rect x="27" y="20" width="64" height="40" rx="7" fill="#93ae78" />
        <circle cx="59" cy="39" r="12" stroke="#eefbdf" strokeWidth="1.8" fill="none" />
        <path
          d="M57 33h5m-5 6h5m-7 7 10-14"
          stroke="#effadd"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
      <path d="M14 44q0-11 11-11h78v68q0 12-13 12H26q-12 0-12-12Z" fill="url(#pw-card)" />
      <path d="M14 46q0-10 12-10h77" stroke="#f7ffe7" strokeWidth="2" fill="none" />
      <path d="M84 62h26v26H84q-9 0-9-13t9-13Z" fill="#3b6147" stroke="#7d9e64" />
      <circle cx="87" cy="75" r="3" fill="#d6f99e" />
      <path d="M28 85h22m-22 6h14" stroke="#6d8953" strokeWidth="2" strokeLinecap="round" />
      <circle cx="100" cy="108" r="15" fill="#d1f58a" stroke="#82a75e" />
      <path
        d="m94 108 4 4 8-9"
        stroke="#1d5136"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function PaymentStep() {
  const { state, run } = useCustomerSession();
  const navigate = useNavigate();
  const cost = useMemo(() => illustrativeCost(state.draft), [state.draft]);
  const breakdown = useMemo(() => buildPriceBreakdown(state.draft), [state.draft]);
  const [error, setError] = useState<string | null>(null);
  const refusalRound = useRef(0);
  const choices = useRef<HTMLFieldSetElement>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = DOCUMENT_TITLE;
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const select = (method: PaymentMethodId) => {
    run((current) => ({ state: selectPaymentMethod(current, method, cost.total) }));
    setError(null);
  };

  const handleNext = () => {
    const result = run(submitPaymentStep);
    if (result.intent) {
      navigate(pathForIntent(result.intent));
      return;
    }
    setError(result.error);
    refusalRound.current += 1;
    requestAnimationFrame(() => {
      choices.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
      choices.current?.focus({ preventScroll: true });
    });
  };

  const selected = paymentMethodDefinition(state.draft.paymentMethod);

  return (
    <div
      className="booking-payment-step"
      data-customer-route="booking-payment"
      data-customer-fixture="booking-payment-default"
      data-booking-step="payment"
    >
      <BookingProgress step={PAYMENT_STEP_INDEX} />
      <div className="page-heading focused-heading">
        <div className="grow">
          <div className="eyebrow">06 / الدفع على راحتك</div>
          <h1 tabIndex={-1}>كيف تحبّ تدفع؟</h1>
          <p>ثلاث طرق واضحة. والاختيار دائمًا لك.</p>
        </div>
        <span className="chapter-icon">
          <Icon name="wallet" />
        </span>
      </div>

      <section className="pay-hero">
        <div>
          <small>إجمالي غسلتك التجريبي</small>
          <strong>
            <Price amount={cost.total} />
          </strong>
          <p>
            السعر نفسه في كل الخيارات.
            <br />
            لا يُحصَّل أي مبلغ داخل هذا النموذج.
          </p>
        </div>
        <WalletArt />
      </section>

      <fieldset
        className="pay-choices"
        id="paymentMethod"
        ref={choices}
        tabIndex={error ? -1 : undefined}
        aria-describedby={error ? 'error-paymentMethod' : undefined}
      >
        <legend className="sr-only">اختر طريقة الدفع</legend>
        {PAYMENT_METHODS.map((method) => {
          const active = method.id === state.draft.paymentMethod;
          return (
            <label
              className={`pay-option ${active ? 'selected' : ''}`}
              data-pay-option={method.id}
              key={method.id}
            >
              <input
                type="radio"
                name="paymentMethod"
                value={method.id}
                checked={active}
                onChange={() => select(method.id)}
              />
              <div className="pay-option-row">
                <span className={`pay-logo ${method.tone}`}>
                  <Icon name={method.icon} />
                </span>
                <div className="pay-option-text">
                  <strong>{method.name}</strong>
                  <p>{method.hint}</p>
                </div>
                <span className="pay-tick">
                  <Icon name="check" />
                </span>
              </div>
              {active ? (
                <div className="pay-selected-note pay-reveal">
                  <Icon name={method.id === 'cash' ? 'check' : 'qr-pay'} />
                  <span>
                    {method.id === 'cash'
                      ? 'لا دفع مسبق. تؤكد الحجز وتكمل يومك.'
                      : 'بعد مراجعة الحجز، يظهر QR الخاص بهذه المحفظة.'}
                  </span>
                </div>
              ) : null}
            </label>
          );
        })}
      </fieldset>

      {error ? (
        <p className="error" id="error-paymentMethod" role="alert">
          {PAYMENT_REQUIRED_MESSAGE}
        </p>
      ) : null}

      <div className="pay-safe">
        <Icon name="lock" />
        <span>
          لا نطلب كلمة مرور المحفظة أو رمز التحقق.
          <br />
          إتمام التحويل يكون داخل تطبيق المحفظة فقط.
        </span>
      </div>

      <details className="pay-how">
        <summary>
          <Icon name="info" />
          عن المبلغ والرسوم
          <Icon name="down" />
        </summary>
        <p className="pay-proof-note">
          المبالغ بالليرة السورية لأغراض العرض فقط، وليست أسعار سوق أو تحويلًا من الريال. رسوم
          مزوّد المحفظة، إن وجدت، تُراجع داخل تطبيقه؛ لم تُفترض رسوم أو إعفاءات هنا.
        </p>
      </details>

      <BookingFooter
        total={cost.total}
        minutes={cost.minutes}
        nextLabel={bookingFlow[PAYMENT_STEP_INDEX].nextLabel}
        breakdown={breakdown}
        onNext={handleNext}
      />

      <span className="sr-only" aria-hidden="true">
        {selected?.short ?? ''}
      </span>
    </div>
  );
}
