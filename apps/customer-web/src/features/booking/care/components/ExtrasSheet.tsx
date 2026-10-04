import { Icon } from '../../../../shared/Icon';
import { Price } from '../../../../shared/Price';
import { Sheet } from '../../../../shared/Sheet';
import { spawnTapWave } from '../../../../shared/tapWave';
import type { CareExtraId } from '../../../../state/bookingDraft';
import type { ExtrasViewModel } from '../extrasViewModel';

interface ExtrasSheetProps {
  readonly open: boolean;
  readonly view: ExtrasViewModel;
  readonly onToggle: (extra: CareExtraId, selected: boolean) => void;
  readonly onApply: () => void;
  readonly onClose: () => void;
}

/**
 * The approved add-ons sheet. Each add-on is a native checkbox inside its label,
 * so the whole row is the hit area and the ticked state is exposed. An add-on the
 * package already includes is a ticked, disabled checkbox labelled as included.
 * Choices take effect as they are ticked; the button only closes and confirms.
 */
export function ExtrasSheet({ open, view, onToggle, onApply, onClose }: ExtrasSheetProps) {
  return (
    <Sheet open={open} title="لمسات إضافية، على ذوقك." onClose={onClose}>
      <p className="sheet-intro">لا إضافات محددة مسبقًا. يمكنك المتابعة دون أي إضافة.</p>
      <div className="stack">
        {view.options.map((option) => (
          <label
            key={option.id}
            className={
              option.included
                ? 'addon-option included'
                : option.checked
                  ? 'addon-option selected'
                  : 'addon-option'
            }
            data-care-extra={option.id}
          >
            <input
              className="choice"
              type="checkbox"
              name="extra"
              value={option.id}
              checked={option.checked}
              disabled={option.included}
              onChange={(event) => onToggle(option.id, event.target.checked)}
            />
            <span className="soft-icon">
              <Icon name={option.icon} />
            </span>
            <span className="grow">
              <strong>{option.name}</strong>
              <br />
              <small>{option.hint}</small>
            </span>
            <span className="addon-price">{option.priceLabel}</span>
            <span className="checkbox-ui">
              <Icon name="check" />
            </span>
          </label>
        ))}
      </div>
      <div className="bill-line total gap-top">
        <span>الإجمالي مع اختياراتك</span>
        <strong id="extras-total">
          <Price amount={view.total} />
        </strong>
      </div>
      <button
        className="btn full gap-top"
        type="button"
        onPointerDown={spawnTapWave}
        onClick={onApply}
      >
        حفظ الاختيارات <Icon name="check" small />
      </button>
    </Sheet>
  );
}
