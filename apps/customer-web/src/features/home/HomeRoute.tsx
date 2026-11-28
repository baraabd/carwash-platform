import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ReferenceArtSprite } from '../../shared/art/ReferenceArt';
import { useCustomerSession } from '../../state/CustomerSessionProvider';
import { isCarePackageId } from '../../state/bookingDraft';
import type { NavigationIntent } from '../../state/customerSession';
import { pathForIntent } from '../../state/navigationPath';
import { HomeBookingEntries } from './components/HomeBookingEntries';
import { HomeHero } from './components/HomeHero';
import { HomePackages } from './components/HomePackages';
import { HomeBenefits, PaymentPreviewLink, ResultTeaser } from './components/HomeShowcase';
import { buildHomeViewModel } from './homeViewModel';
import './home.css';
import { useProductionBooking } from '../../data/ProductionBookingProvider';
import { BOOKING_LABELS } from '../../data/productionBookingContracts';
import { sizeName } from '../../widgets/vehicle-editor/vehicleEditorModel';
import { JourneyNotice } from '../../widgets/customer-access/JourneyNotice';

const HOME_DOCUMENT_TITLE = 'WashGo Signature — وقتك لك، واللمعة علينا';

export function HomeRoute() {
  const { state, commands } = useCustomerSession();
  const navigate = useNavigate();
  const view = useMemo(() => buildHomeViewModel(state), [state]);
  const parity = state.runtimeMode === 'parity';
  const production = useProductionBooking();
  const principal = production?.snapshot.principal?.subjectId;
  const active = production?.snapshot.bookings.find(
    (item) => !['COMPLETED', 'CANCELLED', 'EXPIRED', 'REJECTED'].includes(item.status),
  );
  const repeatable = production?.snapshot.bookings.find((item) => item.status === 'COMPLETED');
  const unavailable =
    !parity && production?.snapshot.catalogStatus !== 'available'
      ? { unavailableReasonId: 'production-booking-unavailable' }
      : {};
  useEffect(() => {
    if (principal && production) void production.client.loadBookings();
  }, [principal, production?.client]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = HOME_DOCUMENT_TITLE;
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const follow = (intent: NavigationIntent | null) => {
    if (intent) navigate(pathForIntent(intent));
  };

  return (
    <div data-customer-route="home" data-customer-fixture="home-default">
      <ReferenceArtSprite />
      <div className="demo-label">
        <span className="dot" /> {parity ? 'تجربة تفاعلية · لا حجز أو دفع فعلي' : 'دليل الخدمات'}
      </div>
      <HomeHero
        greetingName={view.greetingName}
        carArt={view.heroCarArt}
        startingPrice={view.startingPrice}
        onStart={() => {
          if (parity) follow(commands.startBooking());
          else navigate('/book/0');
        }}
        {...unavailable}
      />
      <HomeBenefits />
      <HomeBookingEntries
        activeOrder={
          parity
            ? view.activeOrder
            : active
              ? { id: active.bookingId, statusLabel: BOOKING_LABELS[active.status] }
              : null
        }
        repeatableOrder={
          parity
            ? view.repeatableOrder
            : repeatable
              ? {
                  id: repeatable.bookingId,
                  carLabel: repeatable.vehicle.model ?? sizeName(repeatable.vehicle.type),
                  packageName: 'عنايتك السابقة',
                }
              : null
        }
        savedDraft={parity ? view.savedDraft : null}
        onViewOrder={(orderId) =>
          parity ? follow(commands.viewOrder(orderId)) : navigate(`/order/${orderId}`)
        }
        onRepeatOrder={(orderId) => {
          if (parity) follow(commands.repeatOrder(orderId));
          else if (production && repeatable)
            void production.client.repeat(repeatable).then((ready) => {
              if (ready) navigate('/book/0');
            });
        }}
        onResumeDraft={() => (parity ? follow(commands.resumeBooking()) : navigate('/book/0'))}
      />
      {!parity && production?.snapshot.draft.packageId ? (
        <button
          className="btn secondary full gap-top"
          type="button"
          onClick={() => navigate(`/book/${production.client.prerequisites()}`)}
        >
          أكمل حجزك
        </button>
      ) : null}
      {parity && <PaymentPreviewLink />}
      <HomePackages
        packages={view.packages}
        details={view.packageDetails}
        production={!parity}
        onStartWithPackage={(id) => {
          if (parity && isCarePackageId(id)) follow(commands.startBooking(id));
          else if (production) {
            if (production.snapshot.principal)
              void production.client.selectCare(id).then(() => navigate('/book/0'));
            else navigate('/book/0');
          }
        }}
        {...unavailable}
      />
      <ResultTeaser />
      <p className="footer-note" id={parity ? undefined : 'production-booking-unavailable'}>
        {parity ? (
          <>
            دمشق والعملة والمواعيد هنا لإيضاح التجربة فقط.
            <br />
            لا تتصل هذه النسخة بأي مزوّد خدمة.
          </>
        ) : (
          <>
            {state.productionData?.catalogStatus === 'available'
              ? view.packages.length
                ? 'الباقات المنشورة من الخدمة.'
                : 'لا توجد باقات منشورة حاليًا.'
              : 'تعذّر تحميل الباقات. حاول إعادة تحميل الصفحة.'}
            <br />
            يُحسب السعر لحجم سيارتك واختياراتك، ويُتحقق من توفر الموعد قبل التأكيد.
          </>
        )}
      </p>
      {!parity ? <JourneyNotice /> : null}
    </div>
  );
}
