import { formatAmount } from './formatAmount';

/** Amount with the approved currency suffix. Display only; it performs no arithmetic. */
export function Price({ amount }: { readonly amount: number }) {
  return (
    <>
      {formatAmount(amount)} <span className="currency">ل.س</span>
    </>
  );
}
