import { OrderHandoff } from '../../widgets/order-handoff/OrderHandoff';
import { useCustomerSession } from '../../state/CustomerSessionProvider';
import { ProductionOrderDetail } from '../../widgets/order-handoff/ProductionOrderDetail';

/** `/pay/:orderId`: the C014 handoff for a wallet order. Checkout, QR and proof are deferred. */
export function PaymentRoute() {
  const { state } = useCustomerSession();
  if (state.runtimeMode !== 'parity') return <ProductionOrderDetail kind="payment" />;
  return <OrderHandoff kind="payment" />;
}
