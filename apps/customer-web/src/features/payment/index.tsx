import { OrderHandoff } from '../../widgets/order-handoff/OrderHandoff';

/** `/pay/:orderId`: the C014 handoff for a wallet order. Checkout, QR and proof are deferred. */
export function PaymentRoute() {
  return <OrderHandoff kind="payment" />;
}
