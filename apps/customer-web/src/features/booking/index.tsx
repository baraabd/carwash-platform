import type {
  CustomerBookingStepId,
  CustomerFixtureId,
} from '../../fixtures/customerFixtureStates';
import { useEffect } from 'react';
import { ShellPlaceholder } from '../../shared/ShellPlaceholder';
import { useCustomerSession } from '../../state/CustomerSessionProvider';
import { visitBookingStep } from '../../state/vehicleStep';
import { bookingFlow } from './bookingFlow';
import { CareStep } from './care/CareStep';
import { LocationStep } from './location/LocationStep';
import { VehicleStep } from './vehicle/VehicleStep';
import './booking.css';

export { BOOKING_FOOTER_SLOT_ID } from './bookingFlow';

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
  const { run } = useCustomerSession();
  const stepIndex = bookingFlow.findIndex((item) => item.id === step);

  // Remember where the draft is being edited so Home's "أكمل" returns here.
  useEffect(() => {
    run((current) => ({ state: visitBookingStep(current, stepIndex) }));
  }, [run, stepIndex]);

  if (step === 'vehicle') return <VehicleStep />;
  if (step === 'care') return <CareStep />;
  if (step === 'location') return <LocationStep />;
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
