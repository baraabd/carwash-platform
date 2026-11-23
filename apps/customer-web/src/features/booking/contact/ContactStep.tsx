import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { useNavigate } from 'react-router-dom';
import { illustrativeCost } from '../../../fixtures/customerCatalogFixture';
import { currentInstant } from '../../../shared/clock';
import { Icon } from '../../../shared/Icon';
import {
  CONTACT_NAME_MAX_LENGTH,
  CONTACT_PHONE_MAX_LENGTH,
  CONTACT_STEP_INDEX,
  NO_CONTACT_ERRORS,
  TECHNICIAN_NOTE_MAX_LENGTH,
  editContactField,
  fillDemoContact,
  submitContactStep,
  type ContactErrors,
  type ContactField,
} from '../../../state/contactStep';
import { useCustomerSession } from '../../../state/CustomerSessionProvider';
import { pathForIntent } from '../../../state/navigationPath';
import { completeReviewEdit } from '../../../state/reviewStep';
import { BookingFooter } from '../BookingFooter';
import { BookingProgress } from '../BookingProgress';
import { bookingFlow, decisionNextLabel } from '../bookingFlow';
import { buildPriceBreakdown } from '../priceBreakdown';
import './contact.css';

const DOCUMENT_TITLE = `${bookingFlow[CONTACT_STEP_INDEX].label} — WashGo Signature`;

function motionAllowed(): boolean {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface ContactFieldProps {
  readonly id: 'name' | 'phone';
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly maxLength: number;
  readonly tel?: boolean;
  readonly error: string | null;
  readonly inputRef: Ref<HTMLInputElement>;
  readonly onChange: (value: string) => void;
}

/** The reference's `field()`: label, required marker, input and its message. */
function ContactInput({
  id,
  label,
  placeholder,
  value,
  maxLength,
  tel = false,
  error,
  inputRef,
  onChange,
}: ContactFieldProps) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        <small>مطلوب</small>
      </span>
      <input
        className={tel ? 'input ltr' : 'input'}
        id={id}
        ref={inputRef}
        type={tel ? 'tel' : 'text'}
        inputMode={tel ? 'tel' : undefined}
        autoComplete="off"
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        aria-invalid={error !== null}
        aria-describedby={error ? `error-${id}` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <p className="error" id={`error-${id}`} role="alert">
          {error}
        </p>
      ) : null}
    </label>
  );
}

/**
 * The approved contact step. Typing edits the unsent draft as typed; the rules
 * run only when the customer presses Next. Nothing is verified, sent or saved.
 */
export function ContactStep() {
  const { state, run } = useCustomerSession();
  const navigate = useNavigate();
  const breakdown = useMemo(() => buildPriceBreakdown(state.draft), [state.draft]);
  const cost = useMemo(() => illustrativeCost(state.draft), [state.draft]);
  const [errors, setErrors] = useState<ContactErrors>(NO_CONTACT_ERRORS);
  // The reference redraws the whole step after a refused Next and after the demo
  // fill, which closes the note disclosure; a new key does the same here.
  const [redraws, setRedraws] = useState(0);
  const [refusal, setRefusal] = useState<{
    readonly field: 'name' | 'phone';
    readonly round: number;
  }>();
  const nameInput = useRef<HTMLInputElement>(null);
  const phoneInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = DOCUMENT_TITLE;
    return () => {
      document.title = previousTitle;
    };
  }, []);

  // Editing a field clears that field's message at once, as in the reference; it
  // says nothing about the new value, which Next checks again.
  const edit = (field: ContactField, value: string) => {
    run((current) => ({ state: editContactField(current, field, value) }));
    if (field === 'contactName' || field === 'contactPhone') {
      setErrors((current) => (current[field] ? { ...current, [field]: null } : current));
    }
  };

  const fillDemo = () => {
    run((current) => ({ state: fillDemoContact(current) }));
    setErrors(NO_CONTACT_ERRORS);
    setRedraws((count) => count + 1);
  };

  const handleNext = () => {
    const result = run((current) =>
      completeReviewEdit(submitContactStep(current), currentInstant()),
    );
    if (result.intent) {
      navigate(pathForIntent(result.intent));
      return;
    }
    setErrors(result.errors);
    setRedraws((count) => count + 1);
    setRefusal((current) => ({
      field: result.firstInvalid === 'contactName' ? 'name' : 'phone',
      round: (current?.round ?? 0) + 1,
    }));
  };

  // After the messages have rendered, bring the first invalid field into view.
  useEffect(() => {
    if (!refusal) return;
    const input = refusal.field === 'name' ? nameInput.current : phoneInput.current;
    if (!input) return;
    input.scrollIntoView({ block: 'center', behavior: motionAllowed() ? 'smooth' : 'instant' });
    input.focus({ preventScroll: true });
  }, [refusal]);

  return (
    <div
      data-customer-route="booking-contact"
      data-customer-fixture="booking-contact-default"
      data-booking-step="contact"
    >
      <BookingProgress step={CONTACT_STEP_INDEX} />
      <div className="page-heading focused-heading">
        <div className="grow">
          <div className="eyebrow">05 / نتعرّف عليك</div>
          <h1 tabIndex={-1}>بأي اسم نستقبلك؟</h1>
          <p>بيانات بسيطة، دون كلمة مرور أو إنشاء حساب.</p>
        </div>
        <span className="chapter-icon">
          <Icon name="user" />
        </span>
      </div>
      <ContactInput
        id="name"
        label="الاسم"
        placeholder="مثال: سامر"
        value={state.draft.contactName}
        maxLength={CONTACT_NAME_MAX_LENGTH}
        error={errors.contactName}
        inputRef={nameInput}
        onChange={(value) => edit('contactName', value)}
      />
      <ContactInput
        id="phone"
        label="رقم التواصل"
        placeholder="09XX XXX XXX"
        value={state.draft.contactPhone}
        maxLength={CONTACT_PHONE_MAX_LENGTH}
        tel
        error={errors.contactPhone}
        inputRef={phoneInput}
        onChange={(value) => edit('contactPhone', value)}
      />
      <div className="row between">
        <p className="input-note">استخدم بيانات تجريبية، لا تُرسل رسالة تحقق.</p>
        <button className="text-btn" type="button" onClick={fillDemo}>
          ملء تجريبي
        </button>
      </div>
      <details className="optional-details" key={redraws}>
        <summary>
          ملاحظة للفني <span className="tiny muted">اختياري</span>
        </summary>
        <label className="sr-only" htmlFor="note">
          ملاحظة للفني
        </label>
        <textarea
          className="input"
          id="note"
          maxLength={TECHNICIAN_NOTE_MAX_LENGTH}
          rows={2}
          placeholder="مثال: السيارة بجانب المدخل الخلفي"
          value={state.draft.note}
          onChange={(event) => edit('note', event.target.value)}
        />
      </details>
      <div className="info-note">
        <Icon name="lock" />
        <span>يُحفظ الحجز في هذا المتصفح فقط. لا تدخل أرقام بطاقات أو بيانات حساسة.</span>
      </div>
      <BookingFooter
        total={cost.total}
        minutes={cost.minutes}
        nextLabel={decisionNextLabel(CONTACT_STEP_INDEX, state.reviewEditing)}
        breakdown={breakdown}
        onNext={handleNext}
      />
    </div>
  );
}
