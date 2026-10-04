import { Price } from '../../shared/Price';
import type { PriceBreakdown } from './priceBreakdown';

/**
 * The approved "السعر، بدون مفاجآت." bill (the reference's `bill()`), shown in the
 * footer's price sheet and inline on Review. Display only; the figures arrive
 * computed from the current draft by `buildPriceBreakdown`.
 */
export function PriceBill({ breakdown }: { readonly breakdown: PriceBreakdown }) {
  return (
    <div className="bill">
      <h3>السعر، بدون مفاجآت.</h3>
      {breakdown.lines.map((line) => (
        <div className="bill-line" key={line.id}>
          <span>{line.label}</span>
          <span>{line.value}</span>
        </div>
      ))}
      <div className="bill-line total">
        <span>الإجمالي</span>
        <strong>
          <Price amount={breakdown.total} />
        </strong>
      </div>
    </div>
  );
}
