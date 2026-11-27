import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProductionBooking } from '../../data/ProductionBookingProvider';
import { useCustomerProduction } from '../../data/CustomerProductionProvider';
import { BOOKING_LABELS, formatMoney } from '../../data/productionBookingContracts';
import { Icon } from '../../shared/Icon';
import { CarArt, ReferenceArtSprite } from '../../shared/art/ReferenceArt';
import { sizeArt, sizeName } from '../vehicle-editor/vehicleEditorModel';
import { CustomerProfileSheet } from '../customer-access/CustomerProfileSheet';
import { JourneyNotice } from '../customer-access/JourneyNotice';
import './production-orders.css';

export function bookingSlotLabel(value: string): string {
  return new Date(value).toLocaleString('ar-SY', {
    timeZone: 'Asia/Damascus',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
export function ProductionOrders() {
  const { client, snapshot } = useProductionBooking()!;
  const customer = useCustomerProduction()!;
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'active' | 'past'>('active');
  const [access, setAccess] = useState(false);
  const principal = snapshot.principal?.subjectId;
  useEffect(() => {
    if (principal) void client.loadBookings();
  }, [client, principal]);
  const past = snapshot.bookings.filter((item) =>
    ['COMPLETED', 'CANCELLED', 'EXPIRED', 'REJECTED'].includes(item.status),
  );
  const active = snapshot.bookings.filter((item) => !past.includes(item));
  const rows = filter === 'active' ? active : past;
  return (
    <div data-customer-route="orders" data-runtime="production">
      <ReferenceArtSprite />
      <div className="page-heading">
        <div className="grow">
          <div className="eyebrow">كل غسلة، في مكانها</div>
          <h1 tabIndex={-1}>حجوزاتي.</h1>
          <p>تابع طلبك، أو كرّر الغسلة التي أعجبتك.</p>
        </div>
      </div>
      {!principal ? (
        <>
          <p className="info-note">سجّل الدخول أو استعد جلسة الضيف لعرض حجوزاتك.</p>
          <button
            className="btn full"
            type="button"
            disabled={customer.snapshot.loading}
            onClick={() => setAccess(true)}
          >
            الدخول إلى حجوزاتي
          </button>
          <CustomerProfileSheet open={access} onClose={() => setAccess(false)} />
        </>
      ) : (
        <>
          <div className="segmented" role="group" aria-label="تصفية الحجوزات">
            <button
              type="button"
              className={filter === 'active' ? 'active' : ''}
              aria-pressed={filter === 'active'}
              onClick={() => setFilter('active')}
            >
              الحالية ({active.length})
            </button>
            <button
              type="button"
              className={filter === 'past' ? 'active' : ''}
              aria-pressed={filter === 'past'}
              onClick={() => setFilter('past')}
            >
              السابقة ({past.length})
            </button>
          </div>
          {snapshot.bookingsStatus === 'loading' ? (
            <p className="input-note" role="status">
              جارٍ تحميل الحجوزات…
            </p>
          ) : null}
          {rows.map((booking) => (
            <article className="booking-card" key={booking.bookingId}>
              <div className="row between">
                <span
                  className={`booking-status ${booking.status === 'CANCELLED' ? 'cancelled' : ''}`}
                >
                  {booking.confirmation === 'NEEDS_ATTENTION'
                    ? 'يحتاج متابعة'
                    : BOOKING_LABELS[booking.status]}
                </span>
                <span className="code ltr">{booking.bookingId.slice(0, 8)}</span>
              </div>
              <div className="row gap-top">
                <CarArt art={sizeArt(booking.vehicle.type)} />
                <div className="grow">
                  <h3>
                    {snapshot.catalog?.items.find((item) =>
                      booking.quote.lines.some(
                        (line) =>
                          line.kind === 'PACKAGE' && line.definitionId === item.definitionId,
                      ),
                    )?.name.ar ?? 'العناية المحجوزة'}
                  </h3>
                  <p>{bookingSlotLabel(booking.schedule?.startsAt ?? booking.slot.startsAt)}</p>
                  <p>
                    {booking.vehicle.model ?? sizeName(booking.vehicle.type)}
                    {booking.vehicle.plate ? ` · ${booking.vehicle.plate.text}` : ''}
                  </p>
                </div>
              </div>
              <div className="card-bottom">
                <strong>{formatMoney(booking.total)}</strong>
                <button
                  className="text-btn"
                  type="button"
                  onClick={() => navigate(`/order/${booking.bookingId}`)}
                >
                  متابعة الغسلة <Icon name="left" small />
                </button>
              </div>
            </article>
          ))}
          {rows.length === 0 && snapshot.bookingsStatus === 'available' ? (
            <div className="empty">
              <div className="empty-icon">
                <Icon name="calendar" />
              </div>
              <h2>{filter === 'active' ? 'أول غسلة تبدأ هنا.' : 'كل لمعة لها ذكرى.'}</h2>
              <p>
                {filter === 'active'
                  ? 'اختر الخدمة والموقع والموعد. الباقي ستجده هنا.'
                  : 'لا توجد حجوزات مكتملة أو ملغاة ضمن القائمة المعروضة.'}
              </p>
              <button className="btn full" type="button" onClick={() => navigate('/book/0')}>
                احجز غسلتك <Icon name="arrow" small />
              </button>
            </div>
          ) : null}
          <div className="row between gap-top">
            <button
              className="text-btn"
              type="button"
              disabled={snapshot.bookingsStatus === 'loading'}
              onClick={() => void client.loadBookings()}
            >
              تحديث الحجوزات
            </button>
            {snapshot.nextCursor ? (
              <button
                className="text-btn"
                type="button"
                disabled={snapshot.bookingsStatus === 'loading'}
                onClick={() => void client.loadBookings(true)}
              >
                عرض المزيد
              </button>
            ) : null}
          </div>
        </>
      )}
      <JourneyNotice />
    </div>
  );
}
