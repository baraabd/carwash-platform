import type {
  CustomerBookingStepId,
  CustomerFixtureId,
} from '../../fixtures/customerFixtureStates';
import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { currentInstant } from '../../shared/clock';
import { ShellPlaceholder } from '../../shared/ShellPlaceholder';
import { useCustomerSession } from '../../state/CustomerSessionProvider';
import { visitBookingStep } from '../../state/vehicleStep';
import { resolveBookingEntryStep } from '../../state/bookingDraft';
import { bookingFlow } from './bookingFlow';
import { CareStep } from './care/CareStep';
import { ContactStep } from './contact/ContactStep';
import { LocationStep } from './location/LocationStep';
import { ScheduleStep } from './schedule/ScheduleStep';
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
  const { state, run } = useCustomerSession();
  const stepIndex = bookingFlow.findIndex((item) => item.id === step);
  // Contact must not mount from a bookmark until location and time are chosen.
  // Reuse the same prerequisite rules as resume/rebook, including expired slots.
  const entryStep =
    step === 'contact'
      ? resolveBookingEntryStep(state.draft, stepIndex, currentInstant())
      : stepIndex;

  // Remember where the draft is being edited so Home's "أكمل" returns here.
  useEffect(() => {
    if (entryStep === stepIndex) {
      run((current) => ({ state: visitBookingStep(current, stepIndex) }));
    }
  }, [run, stepIndex, entryStep]);

  if (entryStep !== stepIndex) return <Navigate to={`/book/${entryStep}`} replace />;

  if (step === 'vehicle') return <VehicleStep />;
  if (step === 'care') return <CareStep />;
  if (step === 'location') return <LocationStep />;
  if (step === 'time') return <ScheduleStep />;
  if (step === 'contact') return <ContactStep />;
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
