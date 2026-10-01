import type {
  CustomerBookingStepId,
  CustomerFixtureId,
} from '../../fixtures/customerFixtureStates';
import { ShellPlaceholder } from '../../shared/ShellPlaceholder';

const fixtureByStep: Record<CustomerBookingStepId, CustomerFixtureId> = {
  vehicle: 'booking-vehicle-default',
  care: 'booking-care-default',
  location: 'booking-location-default',
  time: 'booking-time-default',
  contact: 'booking-contact-default',
  payment: 'booking-payment-default',
  review: 'booking-review-default',
};

interface BookingRouteProps {
  readonly step: CustomerBookingStepId;
  readonly title: string;
}

export function BookingRoute({ step, title }: BookingRouteProps) {
  return (
    <ShellPlaceholder
      routeId={`booking-${step}`}
      fixtureId={fixtureByStep[step]}
      bookingStep={step}
      title={title}
      description="نقطة تركيب مستقلة لخطوة الحجز المعتمدة."
    />
  );
}
