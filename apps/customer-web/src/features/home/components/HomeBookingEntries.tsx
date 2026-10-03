import { formatAmount } from '../../../shared/formatAmount';
import { Icon } from '../../../shared/Icon';
import type { HomeViewModel } from '../homeViewModel';

interface HomeBookingEntriesProps {
  readonly activeOrder: HomeViewModel['activeOrder'];
  readonly repeatableOrder: HomeViewModel['repeatableOrder'];
  readonly savedDraft: HomeViewModel['savedDraft'];
  readonly onViewOrder: (orderId: string) => void;
  readonly onRepeatOrder: (orderId: string) => void;
  readonly onResumeDraft: () => void;
}

/**
 * The three ways back into a booking, in the approved order: follow the running
 * order, repeat the last finished one, or continue the unsent draft. Each card is
 * rendered only when its state exists; with none of them, Home shows nothing here.
 */
export function HomeBookingEntries({
  activeOrder,
  repeatableOrder,
  savedDraft,
  onViewOrder,
  onRepeatOrder,
  onResumeDraft,
}: HomeBookingEntriesProps) {
  return (
    <>
      {activeOrder ? (
        <div className="resume" data-home-entry="active-order">
          <Icon name="van" />
          <div className="grow">
            <strong>غسلتك قيد المتابعة</strong>
            <p>{activeOrder.statusLabel}</p>
          </div>
          <button className="text-btn" type="button" onClick={() => onViewOrder(activeOrder.id)}>
            متابعة <Icon name="left" small />
          </button>
        </div>
      ) : null}
      {repeatableOrder ? (
        <button
          className="quick-return"
          type="button"
          data-home-entry="repeat-order"
          onClick={() => onRepeatOrder(repeatableOrder.id)}
        >
          <span className="chapter-icon">
            <Icon name="refresh" />
          </span>
          <span className="grow">
            <small>عنايتك المفضّلة، محفوظة</small>
            <strong>نكرر نفس الغسلة؟</strong>
            {/* One text node, as in the reference: split nodes shift glyph positions. */}
            <p>{`${repeatableOrder.carLabel} · ${repeatableOrder.packageName}`}</p>
          </span>
          <Icon name="arrow" />
        </button>
      ) : null}
      {savedDraft ? (
        <div className="resume" data-home-entry="saved-draft">
          <Icon name="history" />
          <div className="grow">
            <strong>حجزك محفوظ، نكمّله؟</strong>
            <p>{`${savedDraft.packageName} · ${formatAmount(savedDraft.total)} ل.س`}</p>
          </div>
          <button className="text-btn" type="button" onClick={onResumeDraft}>
            أكمل <Icon name="left" small />
          </button>
        </div>
      ) : null}
    </>
  );
}
