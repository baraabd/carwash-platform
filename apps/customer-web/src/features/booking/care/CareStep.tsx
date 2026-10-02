import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { packageFixtures } from '../../../fixtures/customerCatalogFixture';
import { Icon } from '../../../shared/Icon';
import type { CarePackageId } from '../../../state/bookingDraft';
import {
  CARE_STEP_INDEX,
  returnToVehicleStep,
  selectCarePackage,
  submitCareStep,
} from '../../../state/careStep';
import { useCustomerSession } from '../../../state/CustomerSessionProvider';
import { pathForIntent } from '../../../state/navigationPath';
import { BookingFooter } from '../BookingFooter';
import { BookingProgress } from '../BookingProgress';
import { bookingFlow } from '../bookingFlow';
import { buildPriceBreakdown } from '../priceBreakdown';
import { CareContext, CarePackageList, ExtrasRow } from './components/CarePackageList';
import { buildCareStepViewModel } from './careViewModel';
import './care.css';

const DOCUMENT_TITLE = `${bookingFlow[CARE_STEP_INDEX].label} — WashGo Signature`;
const SELECTION_EASING = 'cubic-bezier(.22,.8,.26,1)';

function motionAllowed(): boolean {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function CareStep() {
  const { state, run } = useCustomerSession();
  const navigate = useNavigate();
  const view = useMemo(() => buildCareStepViewModel(state), [state]);
  const breakdown = useMemo(() => buildPriceBreakdown(state.draft), [state.draft]);
  const root = useRef<HTMLDivElement>(null);
  const footerPrice = useRef<HTMLElement>(null);
  const animatedPackage = useRef(view.selectedPackage);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = DOCUMENT_TITLE;
    return () => {
      document.title = previousTitle;
    };
  }, []);

  // Brief, interruptible feedback after a package change. Decoration only: skipped
  // under reduced motion and never required to continue.
  useEffect(() => {
    if (animatedPackage.current === view.selectedPackage) return;
    animatedPackage.current = view.selectedPackage;
    if (!motionAllowed()) return;
    root.current
      ?.querySelector('.service-option.selected')
      ?.animate(
        [
          { transform: 'scale(.975)' },
          { transform: 'scale(1.015)', offset: 0.6 },
          { transform: 'scale(1)' },
        ],
        { duration: 290, easing: SELECTION_EASING },
      );
    footerPrice.current?.animate([{ opacity: 0.45 }, { opacity: 1 }], { duration: 230 });
  }, [view.selectedPackage]);

  const handleSelect = (service: CarePackageId) => {
    run((current) => ({
      state: selectCarePackage(current, service, packageFixtures[service].includes),
    }));
  };

  const follow = (command: typeof submitCareStep) => {
    const { intent } = run(command);
    if (intent) navigate(pathForIntent(intent));
  };

  return (
    <div
      ref={root}
      data-customer-route="booking-care"
      data-customer-fixture="booking-care-default"
      data-booking-step="care"
    >
      <BookingProgress step={CARE_STEP_INDEX} />
      <div className="page-heading focused-heading">
        <div className="grow">
          <div className="eyebrow">02 / عناية على ذوقك</div>
          <h1 tabIndex={-1}>كيف تحبّ لمعتها؟</h1>
          <p>ثلاث باقات واضحة. اختر ما تحتاجه فقط.</p>
        </div>
        <span className="chapter-icon">
          <Icon name="spark" />
        </span>
      </div>
      <CareContext carLabel={view.carLabel} onChangeVehicle={() => follow(returnToVehicleStep)} />
      <CarePackageList options={view.options} onSelect={handleSelect} />
      <ExtrasRow summary={view.extrasSummary} amount={view.extrasAmount} />
      <BookingFooter
        total={view.footerTotal}
        minutes={view.footerMinutes}
        nextLabel={bookingFlow[CARE_STEP_INDEX].nextLabel}
        breakdown={breakdown}
        priceRef={footerPrice}
        onNext={() => follow(submitCareStep)}
      />
    </div>
  );
}
