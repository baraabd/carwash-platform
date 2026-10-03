import { IllustrativeMapArt } from '../../../../shared/art/IllustrativeMapArt';
import { Icon } from '../../../../shared/Icon';
import type { SamplePlaceKind } from '../../../../state/locationStep';
import type { PlaceShortcut, SavedAddressChoice } from '../locationViewModel';

interface SavedAddressChipsProps {
  readonly choices: readonly SavedAddressChoice[];
  readonly onChoose: (addressId: string) => void;
}

/** Saved addresses as one-tap choices. Shown only when the address book holds any. */
export function SavedAddressChips({ choices, onChoose }: SavedAddressChipsProps) {
  if (choices.length === 0) return null;
  return (
    <div className="chips address-chips" role="group" aria-label="عناوين محفوظة">
      {choices.map((choice) => (
        <button
          key={choice.id}
          className={choice.selected ? 'chip selected' : 'chip'}
          type="button"
          data-saved-address={choice.id}
          aria-pressed={choice.selected}
          onClick={() => onChoose(choice.id)}
        >
          <Icon name="pin" />
          {choice.label}
        </button>
      ))}
    </div>
  );
}

interface LocationCardProps {
  readonly label: string;
  readonly title: string;
  readonly preview: string;
  readonly hasAddress: boolean;
  readonly onOpen: () => void;
}

/** The map card that shows the chosen place and opens the address sheet. */
export function LocationCard({ label, title, preview, hasAddress, onOpen }: LocationCardProps) {
  return (
    <button
      className="location-card full location-picker"
      type="button"
      aria-label={label}
      aria-haspopup="dialog"
      onClick={onOpen}
    >
      <div className="mini-map signature-map">
        <IllustrativeMapArt />
        <span className="map-radius" />
        <span className="mini-map-pin">
          <Icon name="pin" />
        </span>
        <span className="map-mini-note">خريطة توضيحية</span>
        <span className="map-open-icon">
          <Icon name="expand" />
        </span>
      </div>
      <span className="disclosure-row">
        <span className="soft-icon">
          <Icon name={hasAddress ? 'check' : 'pin'} />
        </span>
        <span className="grow">
          <strong>{title}</strong>
          <span className="address-preview">{preview}</span>
        </span>
        <Icon name="left" small />
      </span>
    </button>
  );
}

interface LocationShortcutsProps {
  readonly shortcuts: readonly PlaceShortcut[];
  readonly onChoose: (kind: SamplePlaceKind) => void;
}

/** The two demonstration addresses. Pressed state says which one the draft holds. */
export function LocationShortcuts({ shortcuts, onChoose }: LocationShortcutsProps) {
  return (
    <>
      <div className="mini-title">
        للتجربة السريعة <small>عناوين توضيحية فقط</small>
      </div>
      <div className="location-shortcuts">
        {shortcuts.map((shortcut) => (
          <button
            key={shortcut.kind}
            className={shortcut.selected ? 'place-shortcut selected' : 'place-shortcut'}
            type="button"
            data-kind={shortcut.kind}
            aria-pressed={shortcut.selected}
            onClick={() => onChoose(shortcut.kind)}
          >
            <span className="chapter-icon">
              <Icon name={shortcut.icon} />
            </span>
            <span>
              <strong>{shortcut.name}</strong>
              <small>عنوان تجريبي</small>
            </span>
            <Icon name={shortcut.selected ? 'check' : 'plus'} small />
          </button>
        ))}
      </div>
    </>
  );
}
