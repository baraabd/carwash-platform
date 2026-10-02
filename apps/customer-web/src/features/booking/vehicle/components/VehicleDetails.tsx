import type { Ref } from 'react';
import { Icon } from '../../../../shared/Icon';

interface PlateFieldProps {
  /** What the input shows: the customer's own typing, not the normalised value. */
  readonly value: string;
  readonly error: string | null;
  readonly inputRef: Ref<HTMLInputElement>;
  readonly onChange: (typed: string) => void;
  readonly onSubmit: () => void;
}

export function PlateField({ value, error, inputRef, onChange, onSubmit }: PlateFieldProps) {
  return (
    <label className="field plate-field">
      <span className="field-label">
        لوحة السيارة<small>اختيارية في النموذج</small>
      </span>
      <span className="input-icon-wrap">
        <Icon name="car" />
        <input
          ref={inputRef}
          className="input plate-input"
          id="plate"
          data-field="plate"
          type="text"
          maxLength={20}
          dir="auto"
          autoComplete="off"
          placeholder="مثال: 1234 أ ب ج"
          value={value}
          aria-invalid={error !== null}
          aria-describedby={error ? 'plate-help error-plate' : 'plate-help'}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
      </span>
      <span className="input-note" id="plate-help">
        تساعد الفني على تمييز سيارتك. استخدم لوحة تجريبية.
      </span>
      {error ? (
        <p className="error" id="error-plate" role="alert">
          {error}
        </p>
      ) : null}
    </label>
  );
}

interface VehicleDetailsRowProps {
  readonly summary: string | null;
  readonly onOpen: () => void;
}

/** Opens the shared vehicle editor for the car's optional name and colour. */
export function VehicleDetailsRow({ summary, onOpen }: VehicleDetailsRowProps) {
  return (
    <button
      className="disclosure-row car-more"
      type="button"
      aria-haspopup="dialog"
      onClick={onOpen}
    >
      <span className="soft-icon">
        <Icon name="edit" />
      </span>
      <span className="grow">
        <strong>اسم السيارة ولونها</strong>
        <p>{summary ?? 'تفاصيل اختيارية · لا حاجة لإعادتها لاحقًا'}</p>
      </span>
      <Icon name="left" small />
    </button>
  );
}

interface SaveVehicleCheckProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

/** Records the customer's preference in the draft only; saving a car is C005. */
export function SaveVehicleCheck({ checked, onChange }: SaveVehicleCheckProps) {
  return (
    <label className="checkbox-row save-car-check">
      <input
        type="checkbox"
        name="saveVehicleInline"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      احفظ السيارة على جهازي للحجز القادم.
    </label>
  );
}

interface SavedVehicleChipsProps {
  readonly choices: readonly {
    readonly id: string;
    readonly name: string;
    readonly selected: boolean;
  }[];
  readonly onChoose: (vehicleId: string) => void;
  readonly onOther: () => void;
}

/** Saved cars as one-tap choices. Shown only when the garage holds cars. */
export function SavedVehicleChips({ choices, onChoose, onOther }: SavedVehicleChipsProps) {
  if (choices.length === 0) return null;
  return (
    <div className="saved-car-chips chips" role="group" aria-label="سيارات محفوظة">
      {choices.map((choice) => (
        <button
          key={choice.id}
          className={choice.selected ? 'chip selected' : 'chip'}
          type="button"
          aria-pressed={choice.selected}
          onClick={() => onChoose(choice.id)}
        >
          <Icon name="car" />
          {choice.name}
        </button>
      ))}
      <button className="chip" type="button" aria-haspopup="dialog" onClick={onOther}>
        <Icon name="plus" />
        أخرى
      </button>
    </div>
  );
}
