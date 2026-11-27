import { useNavigate } from 'react-router-dom';
import { useProductionBooking } from '../../data/ProductionBookingProvider';

/** Explicit recovery for ambiguous commands. Never submit a replacement command. */
export function JourneyNotice() {
  const journey = useProductionBooking();
  const navigate = useNavigate();
  if (!journey) return null;
  const { client, snapshot } = journey;
  return (
    <>
      {snapshot.problem ? (
        <p className="error" role="alert">
          {snapshot.problem}
        </p>
      ) : null}
      {snapshot.pending ? (
        <button
          className="btn secondary full gap-top"
          type="button"
          disabled={snapshot.busy || snapshot.loading}
          onClick={() =>
            void client.retryPending().then(() => {
              if (snapshot.pending === 'booking') {
                const booking = client.getSnapshot().selectedBooking;
                if (booking) navigate(`/order/${booking.bookingId}`, { replace: true });
              }
            })
          }
        >
          إعادة الطلب نفسه للتحقق من نتيجته
        </button>
      ) : null}
      {snapshot.unknownCreateKey ? (
        <button
          className="btn secondary full gap-top"
          type="button"
          disabled={snapshot.busy || snapshot.loading}
          onClick={() =>
            void client.recoverCreate().then((booking) => {
              if (booking) navigate(`/order/${booking.bookingId}`, { replace: true });
            })
          }
        >
          التحقّق من الحجز السابق
        </button>
      ) : null}
    </>
  );
}
