import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
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
  readonly onSubmit: (values: VehicleEditorValues) => string | null | Promise<string | null>;
  readonly production?: boolean;
  readonly disabled?: boolean;
  readonly footer?: ReactNode;
}

function VehicleEditorForm({
  context,
  initialValues,
  choices,
  onChoose,
  onStartNew,
  onSubmit,
  production = false,
  disabled = false,
  footer,
}: VehicleEditorFormProps) {
  const [values, setValues] = useState(initialValues);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refusals, setRefusals] = useState(0);
  const plateInput = useRef<HTMLInputElement>(null);
  const booking = context === 'booking';

  // Async writes disable the field. Focus after React has committed its enabled
  // state again; focusing before that commit silently fails in a real browser.
  useEffect(() => {
    if (refusals > 0 && !submitting && !disabled) plateInput.current?.focus();
  }, [refusals, submitting, disabled]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (disabled || submitting) return;
    const send = async () => {
      setSubmitting(true);
      try {
        const message = await onSubmit(values);
        setError(message);
        if (message) setRefusals((count) => count + 1);
      } catch {
        setError('تعذّر تأكيد الحفظ. راجع نتيجة الطلب قبل المحاولة مجددًا.');
      } finally {
        setSubmitting(false);
      }
    };
    void send();
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
                disabled={disabled || submitting}
                onChange={() => setValues((current) => ({ ...current, type: option.id }))}
              />
              <CarArt art={option.art} />
              <strong>{option.name}</strong>
              <small>{production ? 'حجم السيارة' : option.priceLabel}</small>
            </label>
          ))}
        </div>
        <div className="plate-preview" id="vehicle-preview">
          <CarArt art={sizeArt(values.type)} />
          <div className="plate-display">
            <span id="plate-live" dir="auto">
              {production && values.plate === '' ? '—' : platePreviewText(values.plate)}
            </span>
            <small>معاينة لوحة · ليست وثيقة</small>
          </div>
        </div>
        <label className="field">
          <span className="field-label">
            لوحة السيارة <small>{production ? 'اختياري' : 'اختياري في النموذج'}</small>
          </span>
          <input
            ref={plateInput}
            className="input"
            id="car-plate"
            name="plate"
            type="text"
            dir="auto"
            maxLength={production ? 12 : 20}
            placeholder="مثال: 1234 أ ب ج"
            value={values.plate}
            disabled={disabled || submitting}
            autoComplete="off"
            aria-describedby={error ? 'plate-help vehicle-error' : 'plate-help'}
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              const plate = event.target.value;
              setValues((current) => ({ ...current, plate }));
            }}
          />
          <span className="input-note" id="plate-help">
            {production
              ? 'أدخل الأرقام والحروف كما تظهر، أو اترك اللوحة فارغة.'
              : 'أدخل الأرقام والحروف كما تظهر. تجنّب استخدام بيانات حساسة في التجربة.'}
          </span>
        </label>
        <div className="two-fields">
          <label className="field">
            <span className="field-label">اسم أو موديل السيارة</span>
            <input
              className="input"
              name="carName"
              maxLength={production ? 40 : 60}
              placeholder="مثال: كامري"
              value={values.carName}
              disabled={disabled || submitting}
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
              maxLength={production ? 40 : 30}
              placeholder="مثال: أبيض"
              value={values.color}
              disabled={disabled || submitting}
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
          <p className="input-note">
            {production
              ? 'سيُحفظ التعديل في الخدمة. الحجوزات السابقة لا تتغيّر.'
              : 'سيُحفظ التعديل على هذا الجهاز. الحجوزات السابقة لا تتغيّر.'}
          </p>
        )}
        <p className="error" id="vehicle-error" role="alert">
          {error}
        </p>
        {footer}
        <button
          className="btn full gap-top"
          type="submit"
          disabled={disabled || submitting}
          onPointerDown={spawnTapWave}
        >
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
