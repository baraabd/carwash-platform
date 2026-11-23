import { createHashRouter } from 'react-router-dom';
import { AccountRoute } from '../features/account';
import { BookingRoute } from '../features/booking';
import { GarageRoute } from '../features/garage';
import { HomeRoute } from '../features/home';
import { OrdersRoute } from '../features/orders';
import { PaymentRoute } from '../features/payment';
import { TrackingRoute } from '../features/tracking';
import { ShellPlaceholder } from '../shared/ShellPlaceholder';
import { CustomerShell } from './CustomerShell';
import { bookingSteps } from './routes';

const bookingRoutes = bookingSteps.map((step) => ({
  path: step.path.slice(1),
  element: <BookingRoute step={step.id} />,
}));

export const customerRouter = createHashRouter([
  {
    path: '/',
    element: <CustomerShell />,
    children: [
      { index: true, element: <HomeRoute /> },
      ...bookingRoutes,
      { path: 'orders', element: <OrdersRoute /> },
      { path: 'garage', element: <GarageRoute /> },
      { path: 'account', element: <AccountRoute /> },
      { path: 'pay/:orderId', element: <PaymentRoute /> },
      { path: 'order/:orderId', element: <TrackingRoute /> },
      {
        path: '*',
        element: (
          <ShellPlaceholder
            routeId="not-found"
            title="المسار غير موجود."
            description="عد إلى الرئيسية."
          />
        ),
      },
    ],
  },
]);
