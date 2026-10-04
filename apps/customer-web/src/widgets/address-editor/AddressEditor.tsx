import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../../shared/Icon';
import { Sheet } from '../../shared/Sheet';
import { spawnTapWave } from '../../shared/tapWave';
import {
  ADDRESS_LABEL_MAX_LENGTH,
  ADDRESS_MAX_LENGTH,
  LOCATION_NOTE_MAX_LENGTH,
  MAP_CENTRE,
  MAP_POINT_ANNOUNCEMENT,
  applyGeolocationOutcome,
  applySampleToSheet,
  moveSheetPin,
  setSheetMapPoint,
  type AddressSheetValues,
  type SamplePlaceKind,
} from '../../state/locationStep';
import { applySavedAddressToSheet, type SavedAddress } from '../../state/savedAddresses';
import { requestDevicePositionClass } from './deviceLocation';
import { IllustrativeMap } from './IllustrativeMap';
import './address-editor.css';

/** Sheet title shared by both contexts, as in the reference. */
export const ADDRESS_EDITOR_TITLE = 'مكان سيارتك، بكل بساطة.';

/**
 * Where the editor is used. `booking` describes the place of the unsent draft:
 * it offers the saved addresses and the save preference, and its button applies.
 * `account` edits one saved address: no chips, no preference, its button saves.
 */
export type AddressEditorContext = 'booking' | 'account';

export interface AddressEditorFormProps {
  readonly context: AddressEditorContext;
  readonly initialValues: AddressSheetValues;
  /** Saved addresses offered as chips in the booking context. */
  readonly savedAddresses?: readonly SavedAddress[];
  /** Applies the values; returns the address message when they are refused. */
  readonly onSubmit: (values: AddressSheetValues) => string | null;
  readonly onNotice: (message: string) => void;
  readonly onAnnounce: (message: string) => void;
}

/**
 * The approved address form with its illustrative map. Its values are temporary:
 * they start from `initialValues` when the form mounts and leave it only through
 * the submit button, so unmounting it (close, Escape, another record) discards
 * them. Mount it with a `key` per editing session.
 */
export function AddressEditorForm({
  context,
  initialValues,
  savedAddresses = [],
  onSubmit,
  onNotice,
  onAnnounce,
}: AddressEditorFormProps) {
  const [values, setValues] = useState(initialValues);
  // The pin is drawn where it was put; the place keeps the rounded position.
  const [pin, setPin] = useState<{ readonly x: number; readonly y: number }>(
    initialValues.place ?? MAP_CENTRE,
  );
  // A sample or saved address redraws the map from scratch, as in the reference.
  const [mapRound, setMapRound] = useState(0);
  const [error, setError] = useState('');
  // Bumped on every refused submission, so the field is focused again even when
  // the same message is already showing.
  const [refusals, setRefusals] = useState(0);
  const [locating, setLocating] = useState(false);
  const addressInput = useRef<HTMLInputElement>(null);
  // True while this editing session is on screen. A location answer that arrives
  // after it ended belongs to no editor and is dropped.
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const placePin = (result: ReturnType<typeof setSheetMapPoint>) => {
    setValues(result.values);
    setPin(result.position);
    onAnnounce(MAP_POINT_ANNOUNCEMENT);
  };

  const refill = (next: AddressSheetValues) => {
    setValues(next);
    setPin(next.place ?? MAP_CENTRE);
    setMapRound((round) => round + 1);
    setError('');
  };

  const fillSample = (kind: SamplePlaceKind) => refill(applySampleToSheet(values, kind));

  // Fills the temporary values only; the draft changes when the form is submitted.
  const fillSaved = (record: SavedAddress) => refill(applySavedAddressToSheet(values, record));

  // Runs only from the customer's tap on "موقعي الحالي": never on load, never
  // when the sheet opens. Only the outcome comes back — no coordinates.
  const locate = async () => {
    setLocating(true);
    const outcome = await requestDevicePositionClass();
    // The editor may have been closed or replaced while the browser was asking.
    if (!mounted.current) return;
    setLocating(false);
    // Applied to the latest values: the customer may have typed meanwhile.
    setValues((current) => applyGeolocationOutcome(current, outcome).values);
    if (outcome === 'in-range') setPin(MAP_CENTRE);
    onNotice(applyGeolocationOutcome(values, outcome).notice);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const refusal = onSubmit(values);
    if (refusal) {
      setError(refusal);
      setRefusals((count) => count + 1);
    }
  };

  // Focus the field once the message has rendered, so the sheet scrolls for the
  // layout that includes it.
  useEffect(() => {
    if (refusals > 0) addressInput.current?.focus();
  }, [refusals]);

  const booking = context === 'booking';

  return (
    <>
      <p className="sheet-intro">اكتب العنوان مباشرة، أو حرّك الخريطة وانقر لوضع الدبوس.</p>
      {booking && savedAddresses.length > 0 ? (
        <div className="chips" role="group" aria-label="عناوين محفوظة">
          {savedAddresses.map((record) => (
            <button
              key={record.id}
              type="button"
              className="chip"
              data-saved-address={record.id}
              onClick={() => fillSaved(record)}
            >
              <Icon name="pin" />
              {record.label}
            </button>
          ))}
        </div>
      ) : null}
      <IllustrativeMap
        key={mapRound}
        pin={pin}
        locating={locating}
        onPoint={(x, y) => placePin(setSheetMapPoint(values, x, y))}
        onNudge={(dx, dy) => placePin(moveSheetPin(values, dx, dy))}
        onLocate={() => void locate()}
      />
      <p className="map-help">
        <Icon name="pin" />
        <span id="pin-description">{values.place?.label || 'الخريطة توضيحية وليست للملاحة'}</span>
      </p>
      <form id="address-form" noValidate onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">
            العنوان بالتفصيل <small>مطلوب</small>
          </span>
          <input
            className="input"
            id="sheet-address"
            name="address"
            ref={addressInput}
            maxLength={ADDRESS_MAX_LENGTH}
            autoComplete="off"
            placeholder="الحي، الشارع، المبنى ومكان السيارة"
            value={values.address}
            onChange={(event) => setValues({ ...values, address: event.target.value })}
          />
        </label>
        <div className="chips" style={{ marginTop: '10px' }}>
          <button type="button" className="chip" onClick={() => fillSample('home')}>
            <Icon name="home" />
            منزل تجريبي
          </button>
          <button type="button" className="chip" onClick={() => fillSample('work')}>
            <Icon name="work" />
            عمل تجريبي
          </button>
        </div>
        <div className="two-fields">
          <label className="field">
            <span className="field-label">اسم العنوان</span>
            <input
              className="input"
              name="addressLabel"
              maxLength={ADDRESS_LABEL_MAX_LENGTH}
              placeholder="المنزل / العمل"
              value={values.addressLabel}
              onChange={(event) => setValues({ ...values, addressLabel: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">ملاحظة الوصول</span>
            <input
              className="input"
              name="locationNote"
              maxLength={LOCATION_NOTE_MAX_LENGTH}
              placeholder="أمام البوابة"
              value={values.locationNote}
              onChange={(event) => setValues({ ...values, locationNote: event.target.value })}
            />
          </label>
        </div>
        {booking ? (
          <label className="checkbox-row">
            <input
              type="checkbox"
              name="saveAddress"
              checked={values.saveAddress}
              onChange={(event) => setValues({ ...values, saveAddress: event.target.checked })}
            />
            احفظ العنوان على جهازي للحجز القادم.
          </label>
        ) : null}
        <p className="error" id="address-error" role="alert">
          {error}
        </p>
        <button className="btn full gap-top" type="submit" onPointerDown={spawnTapWave}>
          {booking ? 'اعتماد هذا المكان' : 'حفظ العنوان'} <Icon name="check" small />
        </button>
      </form>
    </>
  );
}

interface AddressEditorSheetProps extends Omit<AddressEditorFormProps, 'context'> {
  readonly open: boolean;
  readonly onClose: () => void;
}

/** The editor in its own sheet, describing the place of the booking draft. */
export function AddressEditorSheet({ open, onClose, ...form }: AddressEditorSheetProps) {
  return (
    <Sheet open={open} title={ADDRESS_EDITOR_TITLE} onClose={onClose}>
      <AddressEditorForm context="booking" {...form} />
    </Sheet>
  );
}
