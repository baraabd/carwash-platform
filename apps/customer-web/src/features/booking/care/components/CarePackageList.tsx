import type { CSSProperties } from 'react';
import { Icon } from '../../../../shared/Icon';
import type { CarePackageId } from '../../../../state/bookingDraft';
import type { CarePackageOption } from '../careViewModel';

interface CarePackageListProps {
  readonly options: readonly CarePackageOption[];
  readonly onSelect: (id: CarePackageId) => void;
}

/**
 * The three packages as native radios inside labels: one tab stop, arrow keys
 * move the selection, and the whole card is the hit area. Selecting never moves
 * the customer on — that stays an explicit "next".
 */
export function CarePackageList({ options, onSelect }: CarePackageListProps) {
  return (
    <div className="service-list signature-services" role="radiogroup" aria-label="باقة الغسيل">
      {options.map((option, index) => (
        <label
          key={option.id}
          className={option.selected ? 'service-option selected' : 'service-option'}
          style={{ '--item': index } as CSSProperties}
          data-care-package={option.id}
        >
          <input
            className="choice"
            type="radio"
            name="service"
            value={option.id}
            checked={option.selected}
            onChange={() => onSelect(option.id)}
          />
          <div className="service-line">
            <span className={`service-emblem emblem-${option.id}`}>
              <Icon name={option.icon} />
            </span>
            <span className="grow">
              <span className="service-kicker">{option.kicker}</span>
              <h3>{option.name}</h3>
              <p>
                <Icon name="clock" />
                {` ${option.durationLine}`}
              </p>
            </span>
            <span className="service-side">
              <span className="radio-circle">
                {option.selected ? <Icon name="check" small /> : null}
              </span>
              <strong className="service-amount">
                {option.amount}
                <small>ل.س</small>
              </strong>
            </span>
          </div>
          <div className="service-features">
            {option.features.map((feature) => (
              <span key={feature}>
                <Icon name="check" />
                {feature}
              </span>
            ))}
          </div>
        </label>
      ))}
    </div>
  );
}

interface CareContextProps {
  readonly carLabel: string;
  readonly onChangeVehicle: () => void;
}

/** Reminds which car the prices are for and offers to change it. */
export function CareContext({ carLabel, onChangeVehicle }: CareContextProps) {
  return (
    <div className="choice-context">
      <Icon name="car" small />
      <span>{carLabel}</span>
      <span className="context-dot" />
      <span>الأسعار تشمل حجم سيارتك</span>
      <button className="text-btn" type="button" onClick={onChangeVehicle}>
        تغيير
      </button>
    </div>
  );
}

interface ExtrasRowProps {
  readonly summary: string;
  readonly amount: string;
}

/**
 * Entry to the add-ons sheet, which is the extras sprint (C007). It already shows
 * what a draft carries so the customer is not misled about the total.
 */
export function ExtrasRow({ summary, amount }: ExtrasRowProps) {
  return (
    <button
      className="disclosure-row gap-top"
      type="button"
      aria-disabled="true"
      data-deferred-to="C007"
    >
      <span className="soft-icon">
        <Icon name="plus" />
      </span>
      <span className="grow">
        <strong>لمسة إضافية؟</strong>
        <p>{summary}</p>
      </span>
      <span className="amount">{amount}</span>
      <Icon name="left" small />
    </button>
  );
}
