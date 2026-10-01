export type CustomerShellKind = 'normal' | 'booking' | 'payment' | 'tracking';

export type CustomerSurfaceId =
  'home' | 'booking' | 'orders' | 'garage' | 'account' | 'payment' | 'tracking';

export interface CustomerFixtureState {
  readonly id: string;
  readonly surface: CustomerSurfaceId;
  readonly route: string;
  readonly shellKind: CustomerShellKind;
  readonly bookingStep?:
    'vehicle' | 'care' | 'location' | 'time' | 'contact' | 'payment' | 'review';
}

export type CustomerBookingStepId = NonNullable<CustomerFixtureState['bookingStep']>;

export const customerFixtureStates = [
  { id: 'home-default', surface: 'home', route: '/', shellKind: 'normal' },
  {
    id: 'booking-vehicle-default',
    surface: 'booking',
    route: '/book/0',
    shellKind: 'booking',
    bookingStep: 'vehicle',
  },
  {
    id: 'booking-care-default',
    surface: 'booking',
    route: '/book/1',
    shellKind: 'booking',
    bookingStep: 'care',
  },
  {
    id: 'booking-location-default',
    surface: 'booking',
    route: '/book/2',
    shellKind: 'booking',
    bookingStep: 'location',
  },
  {
    id: 'booking-time-default',
    surface: 'booking',
    route: '/book/3',
    shellKind: 'booking',
    bookingStep: 'time',
  },
  {
    id: 'booking-contact-default',
    surface: 'booking',
    route: '/book/4',
    shellKind: 'booking',
    bookingStep: 'contact',
  },
  {
    id: 'booking-payment-default',
    surface: 'booking',
    route: '/book/5',
    shellKind: 'booking',
    bookingStep: 'payment',
  },
  {
    id: 'booking-review-default',
    surface: 'booking',
    route: '/book/6',
    shellKind: 'booking',
    bookingStep: 'review',
  },
  { id: 'orders-default', surface: 'orders', route: '/orders', shellKind: 'normal' },
  { id: 'garage-default', surface: 'garage', route: '/garage', shellKind: 'normal' },
  { id: 'account-default', surface: 'account', route: '/account', shellKind: 'normal' },
  {
    id: 'payment-default',
    surface: 'payment',
    route: '/pay/demo-order',
    shellKind: 'payment',
  },
  {
    id: 'tracking-default',
    surface: 'tracking',
    route: '/order/demo-order',
    shellKind: 'tracking',
  },
] as const satisfies readonly CustomerFixtureState[];

export type CustomerFixtureId = (typeof customerFixtureStates)[number]['id'];

export function fixtureForRoute(pathname: string): CustomerFixtureState | undefined {
  if (pathname.startsWith('/pay/')) {
    return customerFixtureStates.find((fixture) => fixture.id === 'payment-default');
  }
  if (pathname.startsWith('/order/')) {
    return customerFixtureStates.find((fixture) => fixture.id === 'tracking-default');
  }
  return customerFixtureStates.find((fixture) => fixture.route === pathname);
}
