import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { QuoteV1 } from '@carwash/contracts/pricing-v1';
import type { CatalogV1 } from '@carwash/contracts/catalog-v1';
import { Icon } from '../../../shared/Icon';
import { Sheet } from '../../../shared/Sheet';
import { formatMoney } from '../../../data/productionBookingContracts';
import { damascusTime } from '../../../data/productionDate';
import { BOOKING_FOOTER_SLOT_ID } from '../bookingFlow';

export function QuoteBill({
  quote,
  catalog,
}: {
  readonly quote: Pick<QuoteV1, 'lines' | 'total'>;
  readonly catalog: CatalogV1 | null;
}) {
  const labels = {
    PACKAGE: 'الباقة',
    EXTRA: 'إضافة',
    VEHICLE_SURCHARGE: 'حجم السيارة',
    DISCOUNT: 'خصم',
    FEE: 'رسوم',
    TAX: 'ضريبة',
  };
  return (
    <div className="bill">
      <h3>السعر، بدون مفاجآت.</h3>
      {quote.lines.map((line) => (
        <div className="bill-line" key={line.lineId}>
          <span>
            {catalog?.items.find((item) => item.definitionId === line.definitionId)?.name.ar ??
              labels[line.kind]}
            {line.quantity > 1 ? ` × ${line.quantity}` : ''}
          </span>
          <span>{formatMoney(line.amount)}</span>
        </div>
      ))}
      <div className="bill-line total">
        <span>الإجمالي</span>
        <strong>{formatMoney(quote.total)}</strong>
      </div>
    </div>
  );
}

export function ProductionFooter({
  quote,
  catalog,
  label,
  disabled,
  onNext,
  children,
  subscription = false,
}: {
  readonly quote: QuoteV1 | null;
  readonly catalog: CatalogV1 | null;
  readonly label: string;
  readonly disabled: boolean;
  readonly onNext: () => void;
  readonly children?: ReactNode;
  readonly subscription?: boolean;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [billOpen, setBillOpen] = useState(false);
  useEffect(() => {
    setSlot(document.getElementById(BOOKING_FOOTER_SLOT_ID));
  }, []);
  if (!slot) return null;
  return createPortal(
    <footer className="booking-footer">
      <div className="footer-assurance">
        <span>
          <Icon name="check" small />
          اختياراتك لهذه الجلسة
        </span>
        <span>
          <Icon name="clock" small />
          {quote ? `${quote.durationMinutes} دقيقة تقديرية` : 'المدة حسب العناية'}
        </span>
      </div>
      <div className="row between">
        <button
          type="button"
          className="booking-total"
          aria-haspopup="dialog"
          disabled={!quote}
          onClick={() => setBillOpen(true)}
        >
          <small>
            {subscription ? 'قيمة العناية · من الاشتراك' : 'السعر الحالي'} <Icon name="up" small />
          </small>
          <strong id="footer-price" aria-live="polite">
            {quote ? formatMoney(quote.total) : 'بعد اختيار العناية'}
          </strong>
        </button>
        <button className="btn primary-next" type="button" disabled={disabled} onClick={onNext}>
          <span>{label}</span>
          <span className="button-arrow">
            <Icon name={label === 'تأكيد الحجز' ? 'check' : 'arrow'} />
          </span>
        </button>
      </div>
      {children}
      <Sheet open={billOpen} title="السعر، بكل وضوح." onClose={() => setBillOpen(false)}>
        {quote ? (
          <>
            <QuoteBill quote={quote} catalog={catalog} />
            {subscription ? (
              <p className="input-note">
                المبلغ المعروض هو قيمة العناية. عند قبول الجهة المالكة يُغطّى الحجز بوحدة من اشتراكك
                دون التزام دفع مباشر.
              </p>
            ) : null}
            <p className="input-note">
              عرض السعر صالح حتى {damascusTime(quote.expiresAt)}. يتم التحقق منه عند التأكيد.
            </p>
          </>
        ) : null}
        <button className="btn full" type="button" onClick={() => setBillOpen(false)}>
          متابعة الحجز
        </button>
      </Sheet>
    </footer>,
    slot,
  );
}
