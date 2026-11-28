import { ShellPlaceholder } from '../../shared/ShellPlaceholder';
import { useCustomerSession } from '../../state/CustomerSessionProvider';
import { ProductionOrders } from '../../widgets/order-handoff/ProductionOrders';

export function OrdersRoute() {
  const { state } = useCustomerSession();
  if (state.runtimeMode !== 'parity') return <ProductionOrders />;
  return (
    <ShellPlaceholder
      routeId="orders"
      fixtureId="orders-default"
      title="حجوزاتي."
      description="نقطة تركيب الحجوزات."
    />
  );
}
