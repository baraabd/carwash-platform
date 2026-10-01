import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Toast } from '../shared/Toast';
import { inProgressOrderCount } from '../state/customerSession';
import { useCustomerSession } from '../state/CustomerSessionProvider';
import { CityNotice } from './CityNotice';
import { Icon } from './Icon';

function NormalHeader() {
  const { state } = useCustomerSession();
  const initial = state.profile.name.charAt(0);
  return (
    <>
      <NavLink className="brand" to="/" aria-label="WashGo الرئيسية">
        <span className="brand-mark">
          <Icon name="drop" />
        </span>
        <span className="wordmark">
          Wash<em>Go</em>
        </span>
      </NavLink>
      <CityNotice />
      <NavLink className="icon-btn soft" to="/account" aria-label="حسابي">
        {initial || <Icon name="user" small />}
      </NavLink>
    </>
  );
}

function ContextHeader({ kind }: { readonly kind: 'booking' | 'payment' | 'tracking' }) {
  const navigate = useNavigate();
  const { state } = useCustomerSession();
  const config = {
    booking: {
      title: state.bookingMode === 'repeat' ? 'مرة ثانية، بكل سهولة.' : 'غسلتك، على راحتك.',
      subtitle: 'تفصيلة واحدة في كل خطوة',
      action: <Icon name="close" small />,
      actionLabel: 'حفظ المسودة والخروج',
    },
    payment: {
      title: 'الدفع، بكل وضوح.',
      subtitle: 'WASHGO / PAYMENTS',
      action: <Icon name="help" small />,
      actionLabel: 'مساعدة الدفع',
    },
    tracking: {
      title: 'غسلتك خطوة بخطوة',
      subtitle: 'تجربة تفاعلية',
      action: <Icon name="info" small />,
      actionLabel: 'تفاصيل الحجز',
    },
  } as const;
  const current = config[kind];
  return (
    <>
      <button className="icon-btn" type="button" onClick={() => navigate(-1)} aria-label="العودة">
        <Icon name="right" />
      </button>
      <div className="header-title">
        {current.title}
        <small>{current.subtitle}</small>
      </div>
      <button className="icon-btn" type="button" aria-label={current.actionLabel}>
        {current.action}
      </button>
    </>
  );
}

const tabs = [
  { to: '/', id: 'home', label: 'الرئيسية', icon: 'home' as const },
  { to: '/orders', id: 'orders', label: 'حجوزاتي', icon: 'calendar' as const },
  { to: '/garage', id: 'garage', label: 'سياراتي', icon: 'car' as const },
  { to: '/account', id: 'account', label: 'حسابي', icon: 'user' as const },
];

function BottomNavigation({ tracking }: { readonly tracking: boolean }) {
  const { state } = useCustomerSession();
  const inProgress = inProgressOrderCount(state);
  return (
    <nav className="bottom-nav" aria-label="التنقل الرئيسي">
      {tabs.map((tab) => (
        <NavLink
          key={tab.id}
          to={tab.to}
          end={tab.to === '/'}
          className={({ isActive }) =>
            `nav-btn ${isActive || (tracking && tab.id === 'orders') ? 'active' : ''}`
          }
          aria-current={tracking && tab.id === 'orders' ? 'page' : undefined}
        >
          <span className="nav-icon">
            <Icon name={tab.icon} />
          </span>
          {tab.label}
          {tab.id === 'orders' && inProgress > 0 ? (
            <span className="nav-dot">{inProgress}</span>
          ) : null}
        </NavLink>
      ))}
    </nav>
  );
}

function DeferredFooter({ kind }: { readonly kind: 'booking' | 'payment' }) {
  return (
    <footer className="c002-deferred-footer" data-footer-kind={kind}>
      <button type="button" disabled aria-disabled="true">
        {kind === 'payment' ? 'متابعة الدفع' : 'متابعة'}
      </button>
      <small>يُفعّل الإجراء في السبرنت المالك لمنطق هذه الشاشة.</small>
    </footer>
  );
}

export function CustomerShell() {
  const location = useLocation();
  const booking = location.pathname.startsWith('/book/');
  const payment = location.pathname.startsWith('/pay/');
  const tracking = location.pathname.startsWith('/order/');
  const kind = booking ? 'booking' : payment ? 'payment' : tracking ? 'tracking' : 'normal';
  const { state } = useCustomerSession();

  // After an in-app route change, start the new screen at its top and move focus to
  // its heading, as the reference does. The first page load is left alone so the
  // skip link stays the first keyboard stop.
  const renderedLocation = useRef(location);
  useEffect(() => {
    if (renderedLocation.current === location) return;
    renderedLocation.current = location;
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.querySelector<HTMLElement>('#main h1')?.focus({ preventScroll: true });
  }, [location]);

  return (
    <>
      <a className="skip" href="#main">
        انتقل إلى المحتوى
      </a>
      <aside className="desktop-note" aria-hidden="true">
        <div className="label">WASHGO / SIGNATURE</div>
        <h2>
          تفاصيل أقل.
          <br />
          عناية أكثر.
        </h2>
        <p>
          من أول اختيار…
          <br />
          إلى آخر لمعة.
          <br />
          تجربة صُمّمت لراحتك.
        </p>
        <span className="desktop-chip">تصميم للهاتف · تجربة محلية</span>
      </aside>
      <span className="desktop-number" aria-hidden="true">
        CAR CARE — SIMPLIFIED / 04
      </span>
      <div className="app" data-c002-shell data-shell-kind={kind}>
        <header className="app-header">
          {kind === 'normal' ? <NormalHeader /> : <ContextHeader kind={kind} />}
        </header>
        <main className="main" id="main" tabIndex={-1}>
          <Outlet />
        </main>
        {booking || payment ? (
          <DeferredFooter kind={booking ? 'booking' : 'payment'} />
        ) : (
          <BottomNavigation tracking={tracking} />
        )}
      </div>
      <Toast message={state.notice?.message ?? null} sequence={state.notice?.sequence ?? 0} />
      <div className="sr-only" aria-live="polite" />
    </>
  );
}
