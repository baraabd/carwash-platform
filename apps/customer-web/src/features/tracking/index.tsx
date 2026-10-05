import { OrderHandoff } from '../../widgets/order-handoff/OrderHandoff';

/** `/order/:orderId`: the C014 handoff for a session order. Full tracking is deferred. */
export function TrackingRoute() {
  return <OrderHandoff kind="tracking" />;
}
