import { OrderHandoff } from '../../widgets/order-handoff/OrderHandoff';
import { useCustomerSession } from '../../state/CustomerSessionProvider';
import { ProductionOrderDetail } from '../../widgets/order-handoff/ProductionOrderDetail';

/** `/order/:orderId`: the C014 handoff for a session order. Full tracking is deferred. */
export function TrackingRoute() {
  const { state } = useCustomerSession();
  if (state.runtimeMode !== 'parity') return <ProductionOrderDetail kind="tracking" />;
  return <OrderHandoff kind="tracking" />;
}
