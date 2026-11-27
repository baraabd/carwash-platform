import './reference.css';
import './production.css';
import './accessibility.css';
import { currentSession, signOut } from './api/session';
import {
  SCREENS,
  canOpen,
  capabilities,
  defaultScreen,
  isStaff,
  type Capabilities,
  type Screen,
  type StaffSession,
} from './domain/access';
import { isUuid } from './domain/bookings';
import { wireBookingDetail } from './ui/booking-detail';
import { refreshBookings, renderFilters, showBookings, wireBookings } from './ui/bookings-screen';
import { showDashboard, wireDashboard } from './ui/dashboard-screen';
import { byId } from './ui/dom';
import { copy } from './ui/i18n';
import { focusLookup, showPayments, wirePayments } from './ui/payments-screen';
import {
  applyLanguage,
  closeModal,
  markActive,
  showConsoleState,
  storedLanguage,
  toast,
  wireShell,
} from './ui/shell';
import { signIn } from './ui/sign-in';
import { failureMessage } from './ui/states';
import { openReview, showTechnicians, wireTechnicians } from './ui/technicians-screen';
import {
  wireReviewNotifications,
  invalidateReviewNotifications,
  showCustomerReviews,
  showNotifications,
} from './ui/reviews-notifications';
import {
  wireDomainScreens,
  invalidateDomainScreens,
  showServices,
  showCoverage,
} from './ui/catalog-coverage';
import { wireSupportScreens, invalidateSupportScreens, showSupportCases } from './ui/support-cases';
import { wireWalletScreens, invalidateWalletScreens, showWallets } from './ui/wallets';
import {
  wireSubscriptionScreens,
  invalidateSubscriptionScreens,
  showSubscriptions,
} from './ui/subscriptions';

/**
 * Admin console entry: session, capability gating and hash routing.
 * Routes: #/dashboard, #/bookings, #/technicians, #/technicians/review/<caseId>,
 * #/payments.
 */
export const WEB_RUNTIME = Object.freeze({
  app: 'admin-web',
  stage: 'integration-pending',
  businessReady: false,
});

const NO_CAPABILITIES: Capabilities = {
  bookings: false,
  resources: false,
  reviewDecisions: false,
  assignmentActions: false,
  payments: false,
  reconcile: false,
  reviewModeration: false,
  services: false,
  coverage: false,
  support: false,
  custody: false,
  subscriptions: false,
};
let session: StaffSession | null = null;
let caps: Capabilities = NO_CAPABILITIES;
let renderGeneration = 0;

function route(): { screen: Screen | null; caseId: string | null } {
  const [, first, second, third] = location.hash.split('/');
  const screen = SCREENS.find((s) => s === first) ?? null;
  return {
    screen,
    // prettier-ignore
    caseId: screen === 'technicians' && second === 'review' && isUuid(third) ? third.toLowerCase() : null,
  };
}

function renderProfile(): void {
  const c = copy();
  const role = session?.roles.map((r) => c.roles[r] ?? r).join(' · ') ?? '';
  byId('profileName').textContent = session ? `#${session.subject.slice(0, 8).toUpperCase()}` : '—';
  byId('profileRole').textContent = role;
  byId('profileAvatar').textContent = role.slice(0, 1) || '·';
  byId('accountBtn').textContent = session ? `${c.signOut} ▾` : '— ▾';
}

/** Navigation entries the signed-in role cannot open are disabled, never hidden. */
function gateNavigation(): void {
  for (const screen of SCREENS) {
    // prettier-ignore
    const button = document.querySelector<HTMLButtonElement>(`.nav button[data-screen="${screen}"]`);
    if (!button) continue;
    const allowed = session !== null && canOpen(screen, caps);
    button.disabled = !allowed;
    button.title = allowed ? '' : copy().forbidden;
  }
}

async function render(): Promise<void> {
  invalidatePrivateScreens(false);
  const current = ++renderGeneration;
  const renderingSession = session;
  if (!session) return;
  if (!isStaff(caps)) {
    showConsoleState(copy().consoleForbidden, { label: copy().signOut, run: () => void leave() });
    return;
  }
  const { screen, caseId } = route();
  if (screen && !canOpen(screen, caps)) {
    showConsoleState(copy().forbidden);
    return;
  }
  if (!screen) {
    const fallback = defaultScreen(caps);
    if (fallback) location.hash = `#/${fallback}`;
    return;
  }
  markActive(screen);
  switch (screen) {
    case 'dashboard':
      await showDashboard();
      return;
    case 'bookings':
      await showBookings();
      return;
    case 'payments':
      await showPayments();
      return;
    case 'reviews':
      await showCustomerReviews();
      return;
    case 'notifications':
      await showNotifications();
      return;
    case 'services':
      await showServices();
      return;
    case 'coverage':
      await showCoverage();
      return;
    case 'disputes':
      await showSupportCases();
      return;
    case 'wallets':
      await showWallets();
      return;
    case 'subscriptions':
      await showSubscriptions();
      return;
    case 'technicians':
      await showTechnicians();
      // Hash changes can overtake an outstanding Reporting read. Only the
      // current navigation may open a dialog; an older render must not replace
      // a decision form the reviewer has already started filling in.
      if (current !== renderGeneration || session !== renderingSession) return;
      if (caseId) openReview(caseId);
  }
}

function invalidatePrivateScreens(clearPrivate: boolean): void {
  invalidateReviewNotifications(clearPrivate);
  invalidateDomainScreens(clearPrivate);
  invalidateSupportScreens(clearPrivate);
  invalidateWalletScreens(clearPrivate);
  invalidateSubscriptionScreens(clearPrivate);
}

function unauthenticated(): void {
  invalidatePrivateScreens(true);
  renderGeneration += 1;
  session = null;
  caps = NO_CAPABILITIES;
  renderProfile();
  gateNavigation();
  showConsoleState(copy().unauthenticated);
  signIn(signedIn);
}

function signedIn(next: StaffSession): void {
  if (session?.subject !== next.subject) invalidatePrivateScreens(true);
  session = next;
  caps = capabilities(next);
  closeModal();
  renderProfile();
  gateNavigation();
  void render();
}

async function leave(): Promise<void> {
  const result = await signOut();
  if (result.ok) unauthenticated();
  else toast(failureMessage(result.failure));
}

async function boot(): Promise<void> {
  applyLanguage(storedLanguage());
  wireReviewNotifications(unauthenticated);
  const domainWiring = {
    unauthenticated,
    permissions: () => [...(session?.permissions ?? [])],
    subject: () => session?.subject ?? null,
  };
  wireDomainScreens(domainWiring);
  wireSupportScreens(domainWiring);
  wireWalletScreens(domainWiring);
  wireSubscriptionScreens(domainWiring);
  wireShell(() => {
    renderFilters();
    renderProfile();
    gateNavigation();
    void render();
  });
  wireDashboard({ unauthenticated });
  wireBookings({ unauthenticated });
  wireBookingDetail({
    unauthenticated,
    canAct: () => caps.assignmentActions,
    changed: () => {
      if (route().screen === 'bookings') void refreshBookings();
    },
  });
  wireTechnicians({ unauthenticated, capabilities: () => caps });
  wirePayments({ unauthenticated, canReconcile: () => caps.reconcile });
  byId('reconcileToday').addEventListener('click', focusLookup);
  byId('accountBtn').addEventListener('click', () => {
    if (session) void leave();
  });
  window.addEventListener('hashchange', () => void render());
  const current = await currentSession();
  byId('appRoot').setAttribute('aria-busy', 'false');
  if (current.ok) signedIn(current.value);
  else if (current.failure === 'UNAUTHENTICATED') unauthenticated();
  else
    showConsoleState(failureMessage(current.failure), {
      label: copy().retry,
      run: () => location.reload(),
    });
}

void boot();
