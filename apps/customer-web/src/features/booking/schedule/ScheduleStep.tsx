import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { currentInstant } from '../../../shared/clock';
import { Icon } from '../../../shared/Icon';
import { useCustomerSession } from '../../../state/CustomerSessionProvider';
import { pathForIntent } from '../../../state/navigationPath';
import {
  TIME_STEP_INDEX,
  chooseEarliestSlot,
  returnToLocationStep,
  selectScheduleDay,
  selectScheduleTime,
  submitScheduleStep,
  toggleAllTimes,
} from '../../../state/scheduleStep';
import { BookingFooter } from '../BookingFooter';
import { BookingProgress } from '../BookingProgress';
import { bookingFlow } from '../bookingFlow';
import { buildPriceBreakdown } from '../priceBreakdown';
import { buildScheduleStepViewModel } from './scheduleViewModel';
import './schedule.css';

const DOCUMENT_TITLE = `${bookingFlow[TIME_STEP_INDEX].label} — WashGo Signature`;
const SELECTION_EASING = 'cubic-bezier(.22,.8,.26,1)';

function motionAllowed(): boolean {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Brief, interruptible feedback on the tapped control. Decoration only. */
function animateSelection(event: MouseEvent<HTMLElement>) {
  if (!motionAllowed()) return;
  event.currentTarget.animate(
    [
      { transform: 'scale(.975)' },
      { transform: 'scale(1.015)', offset: 0.6 },
      { transform: 'scale(1)' },
    ],
    { duration: 290, easing: SELECTION_EASING },
  );
}

/**
 * The approved time step. The offered days and times are the prototype's demo
 * schedule; choosing one edits the unsent draft and reserves nothing.
 *
 * The clock is read once per render and once per action, and that single instant
 * is what every rule of that render or action is evaluated at. As in the
 * reference, the screen is recomputed when the customer acts, not on a timer.
 */
export function ScheduleStep() {
  const { state, run } = useCustomerSession();
  const navigate = useNavigate();
  const now = currentInstant();
  const view = buildScheduleStepViewModel(state, now);
  const breakdown = useMemo(() => buildPriceBreakdown(state.draft), [state.draft]);
  const [timeError, setTimeError] = useState<string | null>(null);
  // Bumped on every refused submission so the message is revealed even when the
  // same one is already showing.
  const [refusals, setRefusals] = useState(0);
  const errorMessage = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = DOCUMENT_TITLE;
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const follow = (command: typeof returnToLocationStep) => {
    const { intent } = run(command);
    if (intent) navigate(pathForIntent(intent));
  };

  const chooseEarliest = (event: MouseEvent<HTMLElement>) => {
    animateSelection(event);
    const before = state;
    const { state: after } = run((current) => ({
      state: chooseEarliestSlot(current, currentInstant()),
    }));
    if (after !== before) setTimeError(null);
  };

  const chooseDay = (event: MouseEvent<HTMLElement>, day: string) => {
    animateSelection(event);
    run((current) => ({ state: selectScheduleDay(current, day, currentInstant()) }));
    setTimeError(null);
  };

  const chooseTime = (event: MouseEvent<HTMLElement>, time: string) => {
    animateSelection(event);
    const before = state;
    const { state: after } = run((current) => ({
      state: selectScheduleTime(current, time, currentInstant()),
    }));
    if (after !== before) setTimeError(null);
  };

  const handleNext = () => {
    // Judged at the moment of the tap, not when the button was drawn.
    const result = run((current) => submitScheduleStep(current, currentInstant()));
    if (result.intent) {
      navigate(pathForIntent(result.intent));
      return;
    }
    setTimeError(result.timeError);
    setRefusals((count) => count + 1);
  };

  // After the message has rendered, bring it into view and focus it.
  useEffect(() => {
    if (refusals === 0) return;
    const message = errorMessage.current;
    if (!message) return;
    message.scrollIntoView({ block: 'center', behavior: motionAllowed() ? 'smooth' : 'instant' });
    message.focus({ preventScroll: true });
  }, [refusals]);

  return (
    <div
      data-customer-route="booking-time"
      data-customer-fixture="booking-time-default"
      data-booking-step="time"
    >
      <BookingProgress step={TIME_STEP_INDEX} />
      <div className="page-heading focused-heading">
        <div className="grow">
          <div className="eyebrow">04 / وقتك له الأولوية</div>
          <h1 tabIndex={-1}>متى يناسبك نجي؟</h1>
          <p>اختر وقت الوصول. المواعيد هنا للتجربة فقط.</p>
        </div>
        <span className="chapter-icon">
          <Icon name="calendar" />
        </span>
      </div>
      <div className="choice-context">
        <Icon name="pin" small />
        <span className="grow">{view.locationLabel}</span>
        <button className="text-btn" type="button" onClick={() => follow(returnToLocationStep)}>
          تغيير
        </button>
      </div>
      <button
        className="earliest signature-earliest"
        type="button"
        aria-pressed={view.earliestChosen}
        onClick={chooseEarliest}
      >
        <span className="chapter-icon">
          <Icon name="bolt" />
        </span>
        <span className="grow">
          <strong>أقرب موعد متاح</strong>
          <p>{view.earliestText}</p>
        </span>
        {view.earliestChosen ? <Icon name="check" /> : <Icon name="left" small />}
      </button>
      <div className="mini-title">
        أو اختر يومًا يناسبك <small>توقيت دمشق</small>
      </div>
      <div className="dates" role="group" aria-label="اختر اليوم">
        {view.days.map((day) => (
          <button
            key={day.key}
            className={day.selected ? 'date selected' : 'date'}
            type="button"
            data-day={day.key}
            aria-label={day.name}
            aria-pressed={day.selected}
            onClick={(event) => chooseDay(event, day.key)}
          >
            <small>{day.label}</small>
            <strong>{day.day}</strong>
            <span>{day.month}</span>
          </button>
        ))}
      </div>
      <div className="mini-title">
        وقت الوصول <small>{view.careDuration}</small>
      </div>
      <div className="times" role="group" aria-label="الأوقات المتاحة">
        {view.times.map((option) => (
          <button
            key={option.time}
            className={option.selected ? 'time selected' : 'time'}
            type="button"
            data-time={option.time}
            aria-pressed={option.selected}
            onClick={(event) => chooseTime(event, option.time)}
          >
            {option.label}
            {option.selected ? <Icon name="check" small /> : null}
          </button>
        ))}
      </div>
      {view.dayExhausted ? (
        <p className="info-note">لا يوجد وقت متبقٍ لهذا اليوم. اختر يومًا آخر أو أقرب موعد.</p>
      ) : view.canToggleTimes ? (
        <div className="center">
          <button
            className="text-btn"
            type="button"
            aria-expanded={view.showAllTimes}
            onClick={() => run((current) => ({ state: toggleAllTimes(current) }))}
          >
            {view.showAllTimes ? 'عرض أوقات أقل' : 'عرض كل الأوقات'}{' '}
            <Icon name={view.showAllTimes ? 'up' : 'down'} small />
          </button>
        </div>
      ) : null}
      {timeError ? (
        <p className="error" id="error-time" role="alert" tabIndex={-1} ref={errorMessage}>
          {timeError}
        </p>
      ) : null}
      <div
        className={view.summary ? 'selection-summary has-value' : 'selection-summary'}
        aria-live="polite"
      >
        <Icon name={view.summary ? 'check' : 'clock'} />
        <span>{view.summary ?? 'اختر الوقت، ثم نكمل بيانات التواصل.'}</span>
      </div>
      <BookingFooter
        total={view.footerTotal}
        minutes={view.footerMinutes}
        nextLabel={bookingFlow[TIME_STEP_INDEX].nextLabel}
        breakdown={breakdown}
        onNext={handleNext}
      />
    </div>
  );
}
