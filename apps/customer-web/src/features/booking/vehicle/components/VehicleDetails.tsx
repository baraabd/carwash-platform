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

/**
 * Entry to the optional name-and-colour editor. That editor is the shared vehicle
 * sheet the garage also uses, so it is delivered with the garage sprint (C005).
 */
export function VehicleDetailsRow({ summary }: { readonly summary: string | null }) {
  return (
    <button
      className="disclosure-row car-more"
      type="button"
      aria-disabled="true"
      data-deferred-to="C005"
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
