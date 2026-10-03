import { bookingFlow } from './bookingFlow';

const twoDigits = (value: number) => String(value).padStart(2, '0');

/** Journey label, step counter and the seven-segment progress bar. */
export function BookingProgress({ step }: { readonly step: number }) {
  const total = bookingFlow.length;
  return (
    <>
      <div className="journey-heading">
        <span>{bookingFlow[step]?.label}</span>
        <span className="journey-number" dir="ltr">
          <strong>{twoDigits(step + 1)}</strong>
          {` / ${twoDigits(total)}`}
        </span>
      </div>
      <div className="stepper" aria-label={`الخطوة ${step + 1} من ${total}`}>
        {bookingFlow.map((item, index) => (
          <div
            key={item.label}
            className={
              index === step
                ? 'step-segment current'
                : index < step
                  ? 'step-segment done'
                  : 'step-segment'
            }
            aria-current={index === step ? 'step' : undefined}
          >
            <i />
            <span className="sr-only">{item.label}</span>
          </div>
        ))}
      </div>
    </>
  );
}
