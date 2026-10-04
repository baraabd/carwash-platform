import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { currentInstant } from '../../../shared/clock';
import { Icon } from '../../../shared/Icon';
import { CarArt, ReferenceArtSprite } from '../../../shared/art/ReferenceArt';
import { useCustomerSession } from '../../../state/CustomerSessionProvider';
import { pathForIntent } from '../../../state/navigationPath';
import { REVIEW_STEP_INDEX, openReviewEdit } from '../../../state/reviewStep';
import { BookingFooter } from '../BookingFooter';
import { BookingProgress } from '../BookingProgress';
import { bookingFlow } from '../bookingFlow';
import { PriceBill } from '../PriceBill';
import {
  CONFIRMATION_UNAVAILABLE_TEXT,
  REVIEW_EDIT_ACTIONS,
  TECHNICIAN_NOTE_HEADING,
  NO_PLATE_TEXT,
  buildReviewViewModel,
} from './reviewViewModel';
import './review.css';

const DOCUMENT_TITLE = `${bookingFlow[REVIEW_STEP_INDEX].label} — WashGo Signature`;
const CONFIRMATION_REASON_ID = 'review-confirmation-unavailable';

/**
 * Seventh booking screen (the reference's `reviewView()`): the whole draft, the bill
 * and a «تعديل» control per decision. The final action is shown but unavailable:
 * confirmation belongs to the booking confirmation sprint, so nothing on this
 * screen creates an order, reserves a time, saves a preference or starts a payment.
 */
export function ReviewStep() {
  const { state, run } = useCustomerSession();
  const navigate = useNavigate();
  // Derived from the current draft on every render; there is no summary snapshot.
  const view = buildReviewViewModel(state.draft, state.bookingMode);

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

      <div className="receipt">
        <div className="receipt-top">
          <CarArt art={view.vehicle.art} />
          <div className="grow">
            <h3>{view.vehicle.packageName}</h3>
            <p>{view.vehicle.carLine}</p>
            {view.vehicle.plate !== null ? (
              <span className="plate-mini" dir="auto">
                {view.vehicle.plate}
              </span>
            ) : (
              <small className="tiny muted">{NO_PLATE_TEXT}</small>
            )}
          </div>
          {editButton(0)}
        </div>
        <div className="receipt-line">
          <Icon name="spark" />
          <div className="grow">
            <strong>{view.care.packageName}</strong>
            <p>{view.care.extras}</p>
          </div>
          {editButton(1)}
        </div>
        <div className="receipt-line">
          <Icon name="pin" />
          <div className="grow">
            <strong>{view.place.label}</strong>
            <p>{view.place.address}</p>
            {view.place.accessNote !== null ? <p>{view.place.accessNote}</p> : null}
          </div>
          {editButton(2)}
        </div>
        <div className="receipt-line">
          <Icon name="calendar" />
          <div className="grow">
            <strong>{view.time.when}</strong>
            <p>{view.time.detail}</p>
          </div>
          {editButton(3)}
        </div>
        <div className="receipt-line">
          <Icon name="user" />
          <div className="grow">
            <strong>{view.contact.name}</strong>
            <p className="ltr">{view.contact.phone}</p>
          </div>
          {editButton(4)}
        </div>
        <div className="receipt-line">
          <Icon name={view.payment.icon} />
          <div className="grow">
            <strong>{view.payment.name}</strong>
            <p>{view.payment.detail}</p>
          </div>
          {editButton(5)}
        </div>
        {view.technicianNote !== null ? (
          <div className="receipt-line">
            <Icon name="message" />
            <div className="grow">
              <strong>{TECHNICIAN_NOTE_HEADING}</strong>
              <p>{view.technicianNote}</p>
            </div>
          </div>
        ) : null}
      </div>

      <PriceBill breakdown={view.breakdown} />

      <p className="review-note">
        {view.paymentNote}
        <br />
        <span id={CONFIRMATION_REASON_ID}>{CONFIRMATION_UNAVAILABLE_TEXT}</span>
      </p>

      <BookingFooter
        total={view.total}
        minutes={view.minutes}
        nextLabel={view.confirmLabel}
        totalCaption="إجمالي التجربة"
        nextIcon="check"
        breakdown={view.breakdown}
        unavailableReasonId={CONFIRMATION_REASON_ID}
      />
    </div>
  );
}
