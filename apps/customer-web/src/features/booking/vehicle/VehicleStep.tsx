import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../../shared/Icon';
import { ReferenceArtSprite } from '../../../shared/art/ReferenceArt';
import type { VehicleTypeId } from '../../../state/bookingDraft';
import { useCustomerSession } from '../../../state/CustomerSessionProvider';
import { pathForIntent } from '../../../state/navigationPath';
import {
  applyEditorToDraft,
  blankEditorValues,
  chooseSavedVehicle,
  editorValuesForDraft,
  type VehicleEditorValues,
} from '../../../state/savedVehicles';
import { VehicleEditorSheet } from '../../../widgets/vehicle-editor/VehicleEditorSheet';
import { savedVehicleChoices } from '../../../widgets/vehicle-editor/vehicleEditorModel';
import {
  VEHICLE_STEP,
  changePlate,
  selectVehicleType,
  setSaveVehicle,
  submitVehicleStep,
} from '../../../state/vehicleStep';
import { BookingFooter } from '../BookingFooter';
import { BookingProgress } from '../BookingProgress';
import { bookingFlow } from '../bookingFlow';
import { VehicleStage, VehicleTypeGrid } from './components/VehicleChoice';
import {
  PlateField,
  SaveVehicleCheck,
  SavedVehicleChips,
  VehicleDetailsRow,
} from './components/VehicleDetails';
import { buildVehicleStepViewModel, vehicleSelectionAnnouncement } from './vehicleViewModel';

const DOCUMENT_TITLE = `${bookingFlow[VEHICLE_STEP].label} — WashGo Signature`;
const SELECTION_EASING = 'cubic-bezier(.22,.8,.26,1)';

function motionAllowed(): boolean {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function VehicleStep() {
  const { state, run } = useCustomerSession();
  const navigate = useNavigate();
  const view = useMemo(() => buildVehicleStepViewModel(state), [state]);

  // The field shows the customer's own typing; the draft holds the normalised plate.
  const [typedPlate, setTypedPlate] = useState(view.plate);
  const [plateError, setPlateError] = useState<string | null>(null);
  // Bumped on every refused submission so the field is revealed even when the
  // same message is already showing.
  const [refusals, setRefusals] = useState(0);
  const plateInput = useRef<HTMLInputElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const footerPrice = useRef<HTMLElement>(null);
  const animatedType = useRef(view.selectedType);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = DOCUMENT_TITLE;
    return () => {
      document.title = previousTitle;
    };
  }, []);

  // Brief, interruptible feedback after a size change. Decoration only: skipped
  // under reduced motion and never required to continue.
  useEffect(() => {
    if (animatedType.current === view.selectedType) return;
    animatedType.current = view.selectedType;
    if (!motionAllowed()) return;
    stage.current
      ?.closest('[data-customer-route]')
      ?.querySelector('.signature-car.selected')
      ?.animate(
        [
          { transform: 'scale(.975)' },
          { transform: 'scale(1.015)', offset: 0.6 },
          { transform: 'scale(1)' },
        ],
        { duration: 290, easing: SELECTION_EASING },
      );
    stage.current?.querySelector('.car-art')?.animate(
      [
        { opacity: 0.55, transform: 'translateX(calc(-50% - 12px))' },
        { opacity: 1, transform: 'translateX(-50%)' },
      ],
      { duration: 330, easing: 'ease-out' },
    );
    footerPrice.current?.animate([{ opacity: 0.45 }, { opacity: 1 }], { duration: 230 });
  }, [view.selectedType]);

  const handleSelect = (vehicleType: VehicleTypeId) => {
    const { state: next } = run((current) => ({
      state: selectVehicleType(
        current,
        vehicleType,
        vehicleSelectionAnnouncement(current, vehicleType),
      ),
    }));
    // As in the reference, the field is redrawn from the stored plate.
    setTypedPlate(next.draft.plate);
  };

  const handlePlateChange = (typed: string) => {
    setTypedPlate(typed);
    setPlateError(null);
    run((current) => ({ state: changePlate(current, typed) }));
  };

  // 'draft' edits the car the draft describes; 'new' starts from a blank car.
  const [editor, setEditor] = useState<'draft' | 'new' | null>(null);
  const [editorRound, setEditorRound] = useState(0);

  const openEditor = (mode: 'draft' | 'new') => {
    setEditorRound((round) => round + 1);
    setEditor(mode);
  };

  // Copies a saved car into the draft. Nothing is booked, saved or submitted.
  const handleChoose = (vehicleId: string) => {
    const { state: next } = run((current) => ({ state: chooseSavedVehicle(current, vehicleId) }));
    setTypedPlate(next.draft.plate);
    setEditor(null);
  };

  const submitEditor = (values: VehicleEditorValues) => {
    const carId = editor === 'draft' ? state.draft.carId : null;
    const result = run((current) => applyEditorToDraft(current, carId, values));
    if (result.error) return result.error;
    setTypedPlate(result.state.draft.plate);
    setEditor(null);
    return null;
  };

  const handleNext = () => {
    const result = run(submitVehicleStep);
    if (result.intent) {
      navigate(pathForIntent(result.intent));
      return;
    }
    setPlateError(result.plateError);
    setTypedPlate(result.state.draft.plate);
    setRefusals((count) => count + 1);
  };

  // After the message has rendered, bring the field into view and focus it, so
  // the scroll position accounts for the space the message takes.
  useEffect(() => {
    if (refusals === 0) return;
    const input = plateInput.current;
    if (!input) return;
    input.scrollIntoView({ block: 'center', behavior: motionAllowed() ? 'smooth' : 'instant' });
    input.focus({ preventScroll: true });
  }, [refusals]);

  return (
    <div
      data-customer-route="booking-vehicle"
      data-customer-fixture="booking-vehicle-default"
      data-booking-step="vehicle"
    >
      <ReferenceArtSprite />
      <BookingProgress step={VEHICLE_STEP} />
      <div className="page-heading focused-heading">
        <div className="grow">
          <div className="eyebrow">01 / سيارتك أولًا</div>
          <h1 tabIndex={-1}>أي سيارة ندلّل اليوم؟</h1>
          <p>اختر الحجم. تفاصيلها نضيفها مرة واحدة.</p>
        </div>
        <span className="chapter-icon">
          <Icon name="car" />
        </span>
      </div>
      <SavedVehicleChips
        choices={view.savedChoices}
        onChoose={handleChoose}
        onOther={() => openEditor('new')}
      />
      <VehicleStage art={view.stageArt} name={view.stageName} plate={view.plate} stageRef={stage} />
      <VehicleTypeGrid options={view.options} onSelect={handleSelect} />
      <PlateField
        value={typedPlate}
        error={plateError}
        inputRef={plateInput}
        onChange={handlePlateChange}
        onSubmit={handleNext}
      />
      <VehicleDetailsRow summary={view.detailsSummary} onOpen={() => openEditor('draft')} />
      <SaveVehicleCheck
        checked={view.saveVehicle}
        onChange={(checked) => run((current) => ({ state: setSaveVehicle(current, checked) }))}
      />
      <VehicleEditorSheet
        open={editor !== null}
        formKey={`${editor}-${editorRound}`}
        context="booking"
        initialValues={editor === 'new' ? blankEditorValues : editorValuesForDraft(state.draft)}
        choices={savedVehicleChoices(state.vehicles, state.draft.carId)}
        onChoose={handleChoose}
        onStartNew={() => openEditor('new')}
        onSubmit={submitEditor}
        onClose={() => setEditor(null)}
      />
      <BookingFooter
        total={view.footerTotal}
        minutes={view.footerMinutes}
        nextLabel={bookingFlow[VEHICLE_STEP].nextLabel}
        priceRef={footerPrice}
        onNext={handleNext}
      />
    </div>
  );
}
