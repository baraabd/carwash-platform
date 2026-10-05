import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { currentInstant } from '../../../shared/clock';
import { Icon } from '../../../shared/Icon';
import { ReferenceArtSprite } from '../../../shared/art/ReferenceArt';
import { confirmBooking, draftFingerprint } from '../../../state/bookingConfirmation';
import { useCustomerSession } from '../../../state/CustomerSessionProvider';
import { pathForIntent } from '../../../state/navigationPath';
import { REVIEW_STEP_INDEX, openReviewEdit } from '../../../state/reviewStep';
import { BookingFooter } from '../BookingFooter';
import { BookingProgress } from '../BookingProgress';
import { bookingFlow } from '../bookingFlow';
import { PriceBill } from '../PriceBill';
import { Receipt } from '../../../widgets/order-receipt/Receipt';
import { confirmationCatalog } from './confirmationCatalog';
import {
  CONFIRMATION_DISCLOSURE_TEXT,
  REVIEW_EDIT_ACTIONS,
  buildReviewViewModel,
} from './reviewViewModel';
import './review.css';

const DOCUMENT_TITLE = `${bookingFlow[REVIEW_STEP_INDEX].label} — WashGo Signature`;
const CONFIRMATION_DISCLOSURE_ID = 'review-confirmation-disclosure';

/**
 * Seventh booking screen (the reference's `reviewView()`): the whole draft, the bill
 * and a «تعديل» control per decision. Its final action is the explicit demo
 * confirmation (C014): one command creates an order in this session's memory —
 * not a booking with any service, not a reservation and not a payment.
 */
export function ReviewStep() {
  const { state, run } = useCustomerSession();
  const navigate = useNavigate();
  // Derived from the current draft on every render; there is no summary snapshot.
  const view = buildReviewViewModel(state.draft, state.bookingMode);
  // What the customer is looking at: the command carries it, and the session accepts
  // it at most once and only while the draft is still exactly this one.
  const reviewed = { key: state.draftGeneration, fingerprint: draftFingerprint(state.draft) };

  const confirm = () => {
    const now = currentInstant();
    const result = run((current) =>
      confirmBooking(current, { ...reviewed, now, catalog: confirmationCatalog }),
    );
    // A created order is followed by the route (state.pendingHandoff), in the same
    // render that applies it. A refusal returns to the owning step, replacing Review
    // in history as the reference's updateRoute(true).
    if (result.outcome.kind === 'refused' && result.intent) {
      navigate(pathForIntent(result.intent), { replace: true });
    }
  };

  useEffect(() => {
    const previousTitle = document.title;
    document.title = DOCUMENT_TITLE;
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const edit = (step: number) => {
    const { intent } = run((current) => openReviewEdit(current, step, currentInstant()));
    if (intent) navigate(pathForIntent(intent));
  };

  const editButton = (step: number) => {
    const action = REVIEW_EDIT_ACTIONS[step]!;
    return (
      <button
        className="edit"
        type="button"
        aria-label={action.label}
        onClick={() => edit(action.step)}
      >
        تعديل
      </button>
    );
  };

  return (
    <div
      className="booking-review-step"
      data-customer-route="booking-review"
      data-customer-fixture="booking-review-default"
      data-booking-step="review"
    >
      <ReferenceArtSprite />
      <BookingProgress step={REVIEW_STEP_INDEX} />
      <div className="page-heading focused-heading">
        <div className="grow">
          <div className="eyebrow">{view.eyebrow}</div>
          <h1 tabIndex={-1}>{view.title}</h1>
          <p>{view.description}</p>
        </div>
        <span className="chapter-icon">
          <Icon name="check" />
        </span>
      </div>

      <Receipt view={view} action={editButton} />

      <PriceBill breakdown={view.breakdown} />

      <p className="review-note">
        {view.paymentNote}
        <br />
        <span id={CONFIRMATION_DISCLOSURE_ID}>{CONFIRMATION_DISCLOSURE_TEXT}</span>
      </p>

      <BookingFooter
        total={view.total}
        minutes={view.minutes}
        nextLabel={view.confirmLabel}
        totalCaption="إجمالي التجربة"
        nextIcon="check"
        breakdown={view.breakdown}
        describedBy={CONFIRMATION_DISCLOSURE_ID}
        onNext={confirm}
      />
    </div>
  );
}
