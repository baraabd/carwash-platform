import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../../shared/Icon';
import { useCustomerSession } from '../../../state/CustomerSessionProvider';
import {
  LOCATION_STEP_INDEX,
  addressSheetValuesForDraft,
  announce,
  applyAddressSheet,
  chooseSampleLocation,
  notify,
  submitLocationStep,
  type AddressSheetValues,
  type SamplePlaceKind,
} from '../../../state/locationStep';
import { pathForIntent } from '../../../state/navigationPath';
import { BookingFooter } from '../BookingFooter';
import { BookingProgress } from '../BookingProgress';
import { bookingFlow } from '../bookingFlow';
import { buildPriceBreakdown } from '../priceBreakdown';
import { AddressSheet } from './components/AddressSheet';
import { LocationCard, LocationShortcuts } from './components/LocationCard';
import { buildLocationStepViewModel } from './locationViewModel';
import './location.css';

const DOCUMENT_TITLE = `${bookingFlow[LOCATION_STEP_INDEX].label} — WashGo Signature`;
const SELECTION_EASING = 'cubic-bezier(.22,.8,.26,1)';

function motionAllowed(): boolean {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function LocationStep() {
  const { state, run } = useCustomerSession();
  const navigate = useNavigate();
  const view = useMemo(() => buildLocationStepViewModel(state), [state]);
  const breakdown = useMemo(() => buildPriceBreakdown(state.draft), [state.draft]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  // Bumped on every refused submission so the message is revealed even when the
  // same one is already showing.
  const [refusals, setRefusals] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const animatedShortcut = useRef(view.selectedShortcut);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = DOCUMENT_TITLE;
    return () => {
      document.title = previousTitle;
    };
  }, []);

  // Brief, interruptible feedback after a sample place is chosen. Decoration
  // only: skipped under reduced motion and never required to continue.
  useEffect(() => {
    if (animatedShortcut.current === view.selectedShortcut) return;
    animatedShortcut.current = view.selectedShortcut;
    if (!motionAllowed()) return;
    root.current
      ?.querySelector('.place-shortcut.selected')
      ?.animate(
        [
          { transform: 'scale(.975)' },
          { transform: 'scale(1.015)', offset: 0.6 },
          { transform: 'scale(1)' },
        ],
        { duration: 290, easing: SELECTION_EASING },
      );
  }, [view.selectedShortcut]);

  const chooseSample = (kind: SamplePlaceKind) => {
    run((current) => ({ state: chooseSampleLocation(current, kind) }));
    setAddressError(null);
  };

  // Copies the sheet's values into the draft. Nothing is saved or submitted.
  const submitSheet = (values: AddressSheetValues) => {
    const result = run((current) => applyAddressSheet(current, values));
    if (result.error) return result.error;
    setAddressError(null);
    setSheetOpen(false);
    return null;
  };

  const handleNext = () => {
    const result = run(submitLocationStep);
    if (result.intent) {
      navigate(pathForIntent(result.intent));
      return;
    }
    setAddressError(result.addressError);
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
      ref={root}
      data-customer-route="booking-location"
      data-customer-fixture="booking-location-default"
      data-booking-step="location"
    >
      <BookingProgress step={LOCATION_STEP_INDEX} />
      <div className="page-heading focused-heading">
        <div className="grow">
          <div className="eyebrow">03 / أنت تختار المكان</div>
          <h1 tabIndex={-1}>أين نأتي لسيارتك؟</h1>
          <p>في البيت أو العمل. اللمعة تصلك.</p>
        </div>
        <span className="chapter-icon">
          <Icon name="pin" />
        </span>
      </div>
      <LocationCard
        label={view.cardLabel}
        title={view.cardTitle}
        preview={view.cardPreview}
        hasAddress={view.hasAddress}
        onOpen={() => setSheetOpen(true)}
      />
      {addressError ? (
        <p className="error" id="error-address" role="alert" tabIndex={-1} ref={errorMessage}>
          {addressError}
        </p>
      ) : null}
      <LocationShortcuts shortcuts={view.shortcuts} onChoose={chooseSample} />
      <div className="info-note location-tip">
        <Icon name="info" />
        <span>
          لتسهيل الوصول، أضف الشارع ومكان الوقوف. يمكنك كتابة العنوان دون السماح بتحديد موقعك.
        </span>
      </div>
      {view.locationNote ? (
        <div className="selection-summary">
          <Icon name="message" /> {view.locationNote}
        </div>
      ) : null}
      <AddressSheet
        open={sheetOpen}
        initialValues={addressSheetValuesForDraft(state.draft)}
        onSubmit={submitSheet}
        onNotice={(message) => run((current) => ({ state: notify(current, message) }))}
        onAnnounce={(message) => run((current) => ({ state: announce(current, message) }))}
        onClose={() => setSheetOpen(false)}
      />
      <BookingFooter
        total={view.footerTotal}
        minutes={view.footerMinutes}
        nextLabel={bookingFlow[LOCATION_STEP_INDEX].nextLabel}
        breakdown={breakdown}
        onNext={handleNext}
      />
    </div>
  );
}
