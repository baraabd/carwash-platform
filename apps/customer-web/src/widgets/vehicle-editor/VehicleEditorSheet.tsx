import { useRef, useState, type FormEvent } from 'react';
import { Icon } from '../../shared/Icon';
import { Sheet } from '../../shared/Sheet';
import { spawnTapWave } from '../../shared/tapWave';
import { CarArt } from '../../shared/art/ReferenceArt';
import type { VehicleEditorValues } from '../../state/savedVehicles';
import {
  editorSizeOptions,
  platePreviewText,
  sizeArt,
  type SavedVehicleChoice,
} from './vehicleEditorModel';
import './vehicle-editor.css';

interface VehicleEditorFormProps {
  /** `booking` describes the draft's car; `garage` adds or edits a saved car. */
  readonly context: 'booking' | 'garage';
  readonly initialValues: VehicleEditorValues;
  /** Saved cars offered as shortcuts; only shown while booking. */
  readonly choices: readonly SavedVehicleChoice[];
  readonly onChoose: (vehicleId: string) => void;
  readonly onStartNew: () => void;
  /** Returns the validation message to show, or null when the values were accepted. */
  readonly onSubmit: (values: VehicleEditorValues) => string | null;
}

function VehicleEditorForm({
  context,
  initialValues,
  choices,
  onChoose,
  onStartNew,
  onSubmit,
}: VehicleEditorFormProps) {
  const [values, setValues] = useState(initialValues);
  const [error, setError] = useState<string | null>(null);
  const plateInput = useRef<HTMLInputElement>(null);
  const booking = context === 'booking';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = onSubmit(values);
    setError(message);
    if (message) plateInput.current?.focus();
  };

  return (
    <>
      <p className="sheet-intro">
        اختر الحجم، وأضف اللوحة ليسهل التعرّف على السيارة. لا نطلب صورة وثيقة.
      </p>
      {booking && choices.length > 0 ? (
        <div className="chips" style={{ marginBottom: 15 }}>
          {choices.map((choice) => (
            <button
              key={choice.id}
              className="chip"
              type="button"
              onClick={() => onChoose(choice.id)}
            >
              <Icon name="car" />
              {choice.name}
            </button>
          ))}
          <button className="chip" type="button" onClick={onStartNew}>
            <Icon name="plus" />
            سيارة جديدة
          </button>
        </div>
      ) : null}
      <form id="vehicle-form" noValidate onSubmit={submit}>
        <div className="car-grid" role="radiogroup" aria-label="حجم السيارة">
          {editorSizeOptions.map((option) => (
            <label
              key={option.id}
              className={values.type === option.id ? 'car-option selected' : 'car-option'}
            >
              <input
                className="choice"
                type="radio"
                name="carType"
                value={option.id}
                checked={values.type === option.id}
                onChange={() => setValues((current) => ({ ...current, type: option.id }))}
              />
              <CarArt art={option.art} />
              <strong>{option.name}</strong>
              <small>{option.priceLabel}</small>
            </label>
          ))}
        </div>
        <div className="plate-preview" id="vehicle-preview">
          <CarArt art={sizeArt(values.type)} />
          <div className="plate-display">
            <span id="plate-live" dir="auto">
              {platePreviewText(values.plate)}
            </span>
            <small>معاينة لوحة · ليست وثيقة</small>
          </div>
        </div>
        <label className="field">
          <span className="field-label">
            لوحة السيارة <small>اختياري في النموذج</small>
          </span>
          <input
            ref={plateInput}
            className="input"
            id="car-plate"
            name="plate"
            type="text"
            dir="auto"
            maxLength={20}
            placeholder="مثال: 1234 أ ب ج"
            value={values.plate}
            autoComplete="off"
            aria-describedby={error ? 'plate-help vehicle-error' : 'plate-help'}
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              const plate = event.target.value;
              setValues((current) => ({ ...current, plate }));
            }}
          />
          <span className="input-note" id="plate-help">
            أدخل الأرقام والحروف كما تظهر. تجنّب استخدام بيانات حساسة في التجربة.
          </span>
        </label>
        <div className="two-fields">
          <label className="field">
            <span className="field-label">اسم أو موديل السيارة</span>
            <input
              className="input"
              name="carName"
              maxLength={60}
              placeholder="مثال: كامري"
              value={values.carName}
              onChange={(event) => {
                const carName = event.target.value;
                setValues((current) => ({ ...current, carName }));
              }}
            />
          </label>
          <label className="field">
            <span className="field-label">
              اللون <small>اختياري</small>
            </span>
            <input
              className="input"
              name="color"
              maxLength={30}
              placeholder="مثال: أبيض"
              value={values.color}
              onChange={(event) => {
                const color = event.target.value;
                setValues((current) => ({ ...current, color }));
              }}
            />
          </label>
        </div>
        {booking ? (
          <label className="checkbox-row">
            <input
              type="checkbox"
              name="saveVehicle"
              checked={values.saveVehicle}
              onChange={(event) => {
                const saveVehicle = event.target.checked;
                setValues((current) => ({ ...current, saveVehicle }));
              }}
            />
            <span>احفظ السيارة ولوحتها على هذا الجهاز للحجز القادم.</span>
          </label>
        ) : (
          <p className="input-note">سيُحفظ التعديل على هذا الجهاز. الحجوزات السابقة لا تتغيّر.</p>
        )}
        <p className="error" id="vehicle-error" role="alert">
          {error}
        </p>
        <button className="btn full gap-top" type="submit" onPointerDown={spawnTapWave}>
          {booking ? 'استخدام هذه السيارة' : 'حفظ السيارة'} <Icon name="check" small />
        </button>
      </form>
    </>
  );
}

interface VehicleEditorSheetProps extends VehicleEditorFormProps {
  readonly open: boolean;
  /** Changes whenever the editor should start over with new initial values. */
  readonly formKey: string;
  readonly onClose: () => void;
}

/**
 * The approved vehicle editor, shared by the garage and the booking vehicle step.
 * Presentation and field state only: what a submission means is decided by the
 * caller's pure command, which also owns validation.
 */
export function VehicleEditorSheet({ open, formKey, onClose, ...form }: VehicleEditorSheetProps) {
  return (
    <Sheet open={open} title="أي سيارة نعتني بها؟" onClose={onClose}>
      <VehicleEditorForm key={formKey} {...form} />
    </Sheet>
  );
}
