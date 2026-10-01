import { createHashRouter } from 'react-router-dom';
import { CustomerShell } from './CustomerShell';
import { ShellPlaceholder } from './ShellPlaceholder';
import { bookingSteps } from './routes';

const bookingRoutes = bookingSteps.map((step) => ({
  path: step.path.slice(1),
  element: (
    <ShellPlaceholder
      routeId={`booking-${step.id}`}
      bookingStep={step.id}
      title={step.label}
      description="نقطة تركيب مستقلة لخطوة الحجز المعتمدة."
    />
  ),
}));

export const customerRouter = createHashRouter([
  {
    path: '/',
    element: <CustomerShell />,
    children: [
      {
        index: true,
        element: (
          <ShellPlaceholder
            routeId="home"
            title="وقتك لك. واللمعة علينا."
            description="نقطة تركيب الصفحة الرئيسية."
          />
        ),
      },
      ...bookingRoutes,
      {
        path: 'orders',
        element: (
          <ShellPlaceholder routeId="orders" title="حجوزاتي." description="نقطة تركيب الحجوزات." />
        ),
      },
      {
        path: 'garage',
        element: (
          <ShellPlaceholder routeId="garage" title="سياراتي." description="نقطة تركيب السيارات." />
        ),
      },
      {
        path: 'account',
        element: (
          <ShellPlaceholder routeId="account" title="حسابي." description="نقطة تركيب الحساب." />
        ),
      },
      {
        path: 'pay/:orderId',
        element: (
          <ShellPlaceholder
            routeId="payment"
            title="الدفع، بكل وضوح."
            description="نقطة تركيب الدفع."
          />
        ),
      },
      {
        path: 'order/:orderId',
        element: (
          <ShellPlaceholder
            routeId="tracking"
            title="غسلتك خطوة بخطوة"
            description="نقطة تركيب متابعة الحجز."
          />
        ),
      },
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
