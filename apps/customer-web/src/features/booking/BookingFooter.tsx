import { useEffect, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../shared/Icon';
import { Price } from '../../shared/Price';
import { Sheet } from '../../shared/Sheet';
import { spawnTapWave } from '../../shared/tapWave';
import { BOOKING_FOOTER_SLOT_ID } from './bookingFlow';
import { PriceBill } from './PriceBill';
import type { PriceBreakdown } from './priceBreakdown';

/**
 * The footer's primary action: an active step action, or an action that is shown
 * but honestly unavailable (natively disabled and described by a visible reason).
 * There is no third shape, so an apparently working button cannot be wired to nothing.
 */
type FooterAction =
  | { readonly onNext: () => void; readonly unavailableReasonId?: never }
  | { readonly onNext?: never; readonly unavailableReasonId: string };

type BookingFooterProps = FooterAction & {
  readonly total: number;
  readonly minutes: number;
  readonly nextLabel: string;
  /** The bill behind the total, shown when the customer asks for it. */
  readonly breakdown: PriceBreakdown;
  readonly priceRef?: Ref<HTMLElement>;
  /** «السعر الحالي» on the decision steps; Review shows «إجمالي التجربة». */
  readonly totalCaption?: string;
  /** The arrow on the decision steps; Review's final action carries a check. */
  readonly nextIcon?: 'arrow' | 'check';
};

/**
 * Persistent booking action bar. It renders into the slot the shell keeps after
 * <main>, where the reference places it, while its state stays with the step.
 *
 * The session is in memory only, so the assurance says "for this session" — the
 * reference's own wording for when nothing is stored on the device.
 */
export function BookingFooter({
  total,
  minutes,
  nextLabel,
  breakdown,
  priceRef,
  totalCaption = 'السعر الحالي',
  nextIcon = 'arrow',
  onNext,
  unavailableReasonId,
}: BookingFooterProps) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  useEffect(() => {
    setSlot(document.getElementById(BOOKING_FOOTER_SLOT_ID));
  }, []);

  if (!slot) return null;

  return createPortal(
    <footer className="booking-footer">
      <div className="footer-assurance">
        <span>
          <Icon name="check" small />
          محفوظ لهذه الجلسة
        </span>
        <span>
          <Icon name="clock" small />
          {`${minutes} دقيقة تقديرية`}
        </span>
      </div>
      <div className="row between">
        <button
          className="booking-total"
          type="button"
          aria-label={`تفاصيل السعر الحالي ${total} ليرة سورية`}
          aria-haspopup="dialog"
          onClick={() => setBreakdownOpen(true)}
        >
          <small>
            {totalCaption} <Icon name="up" small />
          </small>
          <strong id="footer-price" aria-live="polite" ref={priceRef}>
            <Price amount={total} />
          </strong>
        </button>
        {unavailableReasonId === undefined ? (
          <button
            className="btn primary-next"
            type="button"
            onPointerDown={spawnTapWave}
            onClick={onNext}
          >
            <span>{nextLabel}</span>
            <span className="button-arrow">
              <Icon name={nextIcon} />
            </span>
          </button>
        ) : (
          <button
            className="btn primary-next"
            type="button"
            disabled
            aria-describedby={unavailableReasonId}
          >
            <span>{nextLabel}</span>
            <span className="button-arrow">
              <Icon name={nextIcon} />
            </span>
          </button>
        )}
      </div>
      <Sheet open={breakdownOpen} title="السعر، بكل وضوح." onClose={() => setBreakdownOpen(false)}>
        <PriceBill breakdown={breakdown} />
        <p className="input-note">أسعار توضيحية. لا تحصيل أو رسوم فعلية.</p>
        <button
          className="btn full"
          type="button"
          onPointerDown={spawnTapWave}
          onClick={() => setBreakdownOpen(false)}
        >
          متابعة الحجز
        </button>
      </Sheet>
    </footer>,
    slot,
  );
}
