export const bookingSteps = [
  { index: 0, id: 'vehicle', label: 'السيارة', path: '/book/0' },
  { index: 1, id: 'care', label: 'العناية', path: '/book/1' },
  { index: 2, id: 'location', label: 'المكان', path: '/book/2' },
  { index: 3, id: 'time', label: 'الموعد', path: '/book/3' },
  { index: 4, id: 'contact', label: 'بياناتك', path: '/book/4' },
  { index: 5, id: 'payment', label: 'الدفع', path: '/book/5' },
  { index: 6, id: 'review', label: 'التأكيد', path: '/book/6' },
] as const;

export const primaryRoutes = [
  { id: 'home', path: '/' },
  { id: 'orders', path: '/orders' },
  { id: 'garage', path: '/garage' },
  { id: 'account', path: '/account' },
  { id: 'payment', path: '/pay/:orderId' },
  { id: 'tracking', path: '/order/:orderId' },
] as const;

export type BookingStepId = (typeof bookingSteps)[number]['id'];
