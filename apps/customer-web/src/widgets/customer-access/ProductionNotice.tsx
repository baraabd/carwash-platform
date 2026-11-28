import { useState } from 'react';
import { useCustomerProduction } from '../../data/CustomerProductionProvider';
import { productionFailure, type ProductionCustomerSnapshot } from '../../data/productionCustomer';
import type { AddressV1, CustomerProfileV1 } from '@carwash/contracts/customer-v1';
import type { VehicleV1 } from '@carwash/contracts/vehicle-v1';

/** Uses existing status/button styles; unknown writes are replayed explicitly with their original key. */
export function ProductionNotice({
  onConfirmed,
  operation,
}: {
  readonly onConfirmed?: (record: CustomerProfileV1 | AddressV1 | VehicleV1) => void;
  readonly operation?: NonNullable<ProductionCustomerSnapshot['pending']>;
}) {
  const production = useCustomerProduction();
  const [problem, setProblem] = useState<{
    readonly message: string | null;
    readonly snapshot: ProductionCustomerSnapshot;
  } | null>(null);
  if (!production) return null;
  const { client, snapshot } = production;
  const retry = () => {
    setProblem(null);
    const pending = snapshot.pending;
    void client.retryPending().then((result) => {
      setProblem({ message: productionFailure(result), snapshot: client.getSnapshot() });
      if (result.ok && (operation === undefined || operation === pending))
        onConfirmed?.(result.value);
    });
  };
  const message = problem?.snapshot === snapshot ? problem.message : null;
  if (!snapshot.pending && !snapshot.notice && !message) return null;
  return (
    <div className="info-note" role="status">
      <div className="grow">
        <p>{message ?? snapshot.notice ?? 'جارٍ تأكيد نتيجة الحفظ من الخدمة.'}</p>
        {snapshot.pending ? (
          snapshot.authStatus !== 'authenticated' ? (
            <button
              className="btn secondary full gap-top"
              type="button"
              disabled={snapshot.busy || snapshot.loading}
              onClick={() => {
                setProblem(null);
                void client.load();
              }}
            >
              إعادة تحميل الجلسة
            </button>
          ) : (
            <button
              className="btn secondary full gap-top"
              type="button"
              disabled={snapshot.busy || snapshot.loading}
              onClick={retry}
            >
              إعادة الطلب نفسه
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}
