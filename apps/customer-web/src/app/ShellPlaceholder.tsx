import { useParams } from 'react-router-dom';
import type { BookingStepId } from './routes';

interface PlaceholderProps {
  readonly routeId: string;
  readonly title: string;
  readonly description: string;
  readonly bookingStep?: BookingStepId;
}

export function ShellPlaceholder({
  routeId,
  title,
  description,
  bookingStep,
}: PlaceholderProps) {
  const params = useParams();
  return (
    <section
      className="c002-placeholder"
      data-customer-route={routeId}
      data-booking-step={bookingStep}
      aria-labelledby={`c002-${routeId}-title`}
    >
      <p className="eyebrow">WASHGO / CUSTOMER</p>
      <h1 id={`c002-${routeId}-title`} tabIndex={-1}>
        {title}
      </h1>
      <p>{description}</p>
      {params.orderId ? <small className="ltr">Order: {params.orderId}</small> : null}
      <span className="c002-scope-note">
        هيكل C002 فقط — محتوى هذه الشاشة يُنفّذ في السبرنت المالك لها.
      </span>
    </section>
  );
}
