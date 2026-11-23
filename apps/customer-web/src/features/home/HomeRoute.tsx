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

const HOME_DOCUMENT_TITLE = 'WashGo Signature — وقتك لك، واللمعة علينا';

export function HomeRoute() {
  const { state, commands } = useCustomerSession();
  const navigate = useNavigate();
  const view = useMemo(() => buildHomeViewModel(state), [state]);
  const parity = state.runtimeMode === 'parity';
  const unavailable = parity ? {} : { unavailableReasonId: 'production-booking-unavailable' };

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
        }}
        {...unavailable}
      />
      <HomeBenefits />
      <HomeBookingEntries
        activeOrder={view.activeOrder}
        repeatableOrder={view.repeatableOrder}
        savedDraft={view.savedDraft}
        onViewOrder={(orderId) => follow(commands.viewOrder(orderId))}
        onRepeatOrder={(orderId) => follow(commands.repeatOrder(orderId))}
        onResumeDraft={() => follow(commands.resumeBooking())}
      />
      {parity && <PaymentPreviewLink />}
      <HomePackages
        packages={view.packages}
        details={view.packageDetails}
        onStartWithPackage={(id) => {
          if (parity && isCarePackageId(id)) follow(commands.startBooking(id));
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
            تأكيد الحجز غير متاح قبل ربط عرض السعر والمواعيد.
          </>
        )}
      </p>
    </div>
  );
}
