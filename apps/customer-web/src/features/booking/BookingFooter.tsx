import { useEffect, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../shared/Icon';
import { Price } from '../../shared/Price';
import { spawnTapWave } from '../../shared/tapWave';
import { BOOKING_FOOTER_SLOT_ID } from './bookingFlow';

interface BookingFooterProps {
  readonly total: number;
  readonly minutes: number;
  readonly nextLabel: string;
  readonly priceRef?: Ref<HTMLElement>;
  readonly onNext: () => void;
}

/**
 * Persistent booking action bar. It renders into the slot the shell keeps after
 * <main>, where the reference places it, while its state stays with the step.
 *
 * The session is in memory only, so the assurance says "for this session" — the
 * reference's own wording for when nothing is stored on the device.
 */
export function BookingFooter({ total, minutes, nextLabel, priceRef, onNext }: BookingFooterProps) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

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
        {/* The price breakdown sheet belongs to the care/pricing sprints. */}
        <button
          className="booking-total"
          type="button"
          aria-label={`تفاصيل السعر الحالي ${total} ليرة سورية`}
          aria-disabled="true"
          data-deferred-to="C006"
        >
          <small>
            السعر الحالي <Icon name="up" small />
          </small>
          <strong id="footer-price" aria-live="polite" ref={priceRef}>
            <Price amount={total} />
          </strong>
        </button>
        <button
          className="btn primary-next"
          type="button"
          onPointerDown={spawnTapWave}
          onClick={onNext}
        >
          <span>{nextLabel}</span>
          <span className="button-arrow">
            <Icon name="arrow" />
          </span>
        </button>
      </div>
    </footer>,
    slot,
  );
}
