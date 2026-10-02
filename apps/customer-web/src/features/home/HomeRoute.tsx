import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ReferenceArtSprite } from '../../shared/art/ReferenceArt';
import { useCustomerSession } from '../../state/CustomerSessionProvider';
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
        <span className="dot" /> تجربة تفاعلية · لا حجز أو دفع فعلي
      </div>
      <HomeHero
        greetingName={view.greetingName}
        carArt={view.heroCarArt}
        startingPrice={view.startingPrice}
        onStart={() => follow(commands.startBooking())}
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
      <PaymentPreviewLink />
      <HomePackages
        packages={view.packages}
        details={view.packageDetails}
        onStartWithPackage={(id) => follow(commands.startBooking(id))}
      />
      <ResultTeaser />
      <p className="footer-note">
        دمشق والعملة والمواعيد هنا لإيضاح التجربة فقط.
        <br />
        لا تتصل هذه النسخة بأي مزوّد خدمة.
      </p>
    </div>
  );
}
