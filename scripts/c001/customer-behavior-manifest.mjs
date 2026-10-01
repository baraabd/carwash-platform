import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const MANIFEST_PATH = 'docs/customer/customer-parity-manifest.json';
export const F010_PATH = 'docs/design/f010-reference-manifest.json';
export const SERVICE_CATALOG_PATH = 'architecture/service-catalog.json';

const EXPECTED_CAPABILITY_OWNERSHIP = Object.freeze({
  identity: 'identity',
  customerProfileAndAddresses: 'customer',
  vehicles: 'vehicle',
  packages: 'catalog',
  authoritativePrice: 'pricing',
  bookingDraftAndLifecycle: 'booking',
  availability: 'scheduling',
  technicianAssignmentAndTravel: 'dispatch',
  paymentVerificationAndRefund: 'billing',
  beforeAfterAndPaymentProofMedia: 'media',
  notificationsAndConversation: 'communications',
  serviceabilityAndGeocoding: 'geo',
  technicianReadProjection: 'workforce',
});

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sorted = (values) => [...values].sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function loadCustomerManifest(root = ROOT) {
  return JSON.parse(readFileSync(resolve(root, MANIFEST_PATH), 'utf8'));
}

export function inspectCustomerReference(root = ROOT) {
  const manifest = loadCustomerManifest(root);
  const source = readFileSync(resolve(root, manifest.reference.canonicalHtml), 'utf8');
  const actions = new Set();
  for (const match of source.matchAll(/data-action=["']([A-Za-z0-9_-]+)["']/g))
    actions.add(match[1]);
  for (const match of source.matchAll(/\ba\s*===\s*['"]([^'"]+)['"]/g)) actions.add(match[1]);
  const forms = new Set(
    [...source.matchAll(/<form[^>]+id=["']([^"']+)["']/g)].map((match) => match[1]),
  );
  const configFormLoop =
    /\['sham','syriatel'\]\.map\(method=>\{[\s\S]*?<form class="pay-config-form" data-method="\$\{method\}"/;
  if (configFormLoop.test(source)) {
    forms.add('pay-config-form:sham');
    forms.add('pay-config-form:syriatel');
  }
  const flowStart = source.indexOf('const FLOW=Object.freeze([');
  const flowEnd = source.indexOf(']);\n  const STEPS=', flowStart);
  if (flowStart < 0 || flowEnd < 0) throw new Error('C001_FLOW_SOURCE_NOT_FOUND');
  const flowSource = source.slice(flowStart, flowEnd);
  const flowLabels = [...flowSource.matchAll(/label:'([^']+)'/g)].map((match) => match[1]);
  const nextLabels = [...flowSource.matchAll(/next:'([^']+)'/g)].map((match) => match[1]);
  return {
    source,
    bytes: Buffer.byteLength(source),
    sha256: digest(Buffer.from(source)),
    actions: sorted(actions),
    forms: sorted(forms),
    flowLabels,
    nextLabels,
  };
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

export function validateCustomerBehaviorManifest(manifest, { root = ROOT } = {}) {
  assert(manifest?.schemaVersion === 1, 'C001_SCHEMA_VERSION');
  assert(manifest?.manifestId === 'washgo-customer-prototype-behavior-v1', 'C001_MANIFEST_ID');
  assert(manifest?.sprint === 'C001', 'C001_SPRINT_ID');

  const f010 = JSON.parse(readFileSync(resolve(root, F010_PATH), 'utf8'));
  const authority = f010.references?.customer;
  assert(authority, 'C001_F010_CUSTOMER_AUTHORITY_MISSING');
  for (const key of ['canonicalHtml', 'bytes', 'sha256', 'language', 'direction']) {
    assert(manifest.reference?.[key] === authority[key], `C001_REFERENCE_${key.toUpperCase()}`);
  }
  assert(manifest.reference?.authority === 'immutable-golden-design', 'C001_REFERENCE_AUTHORITY');

  const observed = inspectCustomerReference(root);
  assert(observed.bytes === manifest.reference.bytes, 'C001_REFERENCE_BYTES');
  assert(observed.sha256 === manifest.reference.sha256, 'C001_REFERENCE_SHA256');

  const screens = manifest.primaryScreens?.map((item) => item.id);
  assert(
    same(screens, ['home', 'booking', 'payment', 'tracking', 'orders', 'garage', 'account']),
    'C001_PRIMARY_SCREEN_SET',
  );
  const requiredRenderMap =
    '({home:homeView,booking:bookingView,payment:checkoutView,tracking:trackingView,orders:ordersView,garage:garageView,account:accountView}[S.screen]||homeView)()';
  assert(observed.source.includes(requiredRenderMap), 'C001_RENDER_MAP_DRIFT');

  const flow = manifest.bookingFlow ?? [];
  assert(flow.length === 7, 'C001_FLOW_LENGTH');
  assert(
    same(
      flow.map((step) => step.index),
      [0, 1, 2, 3, 4, 5, 6],
    ),
    'C001_FLOW_INDEXES',
  );
  assert(
    same(
      flow.map((step) => step.label),
      observed.flowLabels,
    ),
    'C001_FLOW_LABELS',
  );
  assert(
    same(
      flow.map((step) => step.nextLabel),
      observed.nextLabels,
    ),
    'C001_FLOW_NEXT_LABELS',
  );
  assert(
    same(
      flow.map((step) => step.id),
      ['vehicle', 'care', 'location', 'time', 'contact', 'payment', 'review'],
    ),
    'C001_FLOW_IDS',
  );

  assert(same(sorted(manifest.actions ?? []), observed.actions), 'C001_ACTION_INVENTORY');
  assert(
    same(sorted((manifest.forms ?? []).map((item) => item.id)), observed.forms),
    'C001_FORM_INVENTORY',
  );

  assert(
    same(
      (manifest.payment?.methods ?? []).map((item) => item.id),
      ['cash', 'sham', 'syriatel'],
    ),
    'C001_PAYMENT_METHODS',
  );
  const paymentStates = [
    'cash_due',
    'awaiting_transfer',
    'awaiting_review',
    'needs_review',
    'paid_demo',
    'cash_collected_demo',
    'refund_review_demo',
    'cancelled',
  ];
  assert(same(manifest.payment?.states, paymentStates), 'C001_PAYMENT_STATES');
  for (const state of paymentStates) {
    assert(observed.source.includes(`${state}:{`), `C001_PAYMENT_STATE_SOURCE:${state}`);
  }

  assert(
    same(
      (manifest.orderTracking?.stages ?? []).map((item) => item.label),
      ['استلمنا الطلب', 'تعيين الفني', 'في الطريق', 'جاري الغسيل', 'مكتمل'],
    ),
    'C001_TRACKING_STAGES',
  );
  assert(manifest.orderTracking?.cancelledStage === -1, 'C001_CANCELLED_STAGE');

  const truth = manifest.prototypeTruth ?? {};
  assert(truth.serverCalls === false, 'C001_SERVER_CALL_OVERCLAIM');
  assert(truth.createsRealBookings === false, 'C001_BOOKING_OVERCLAIM');
  assert(truth.processesRealPayments === false, 'C001_PAYMENT_OVERCLAIM');
  assert(truth.liveTechnicianTracking === false, 'C001_TRACKING_OVERCLAIM');
  assert(truth.cloudAccount === false, 'C001_ACCOUNT_OVERCLAIM');
  assert(truth.authoritativePricing === false, 'C001_PRICING_OVERCLAIM');
  assert(truth.authoritativeAvailability === false, 'C001_AVAILABILITY_OVERCLAIM');

  const localKeys = manifest.localStorageKeys ?? [];
  for (const key of ['washgo.payments.sy.v6', 'washgo.payments.sy.merchants.v1']) {
    assert(
      localKeys.includes(key) && observed.source.includes(`'${key}'`),
      `C001_LOCAL_KEY:${key}`,
    );
  }

  for (const route of ['#home', '#orders', '#garage', '#account']) {
    assert(
      manifest.primaryScreens.some((item) => item.route === route),
      `C001_ROUTE_MISSING:${route}`,
    );
  }
  assert(
    manifest.primaryScreens.some((item) => item.route === '#book/:step'),
    'C001_BOOK_ROUTE',
  );
  assert(
    manifest.primaryScreens.some((item) => item.route === '#pay/:orderId'),
    'C001_PAY_ROUTE',
  );
  assert(
    manifest.primaryScreens.some((item) => item.route === '#order/:orderId'),
    'C001_ORDER_ROUTE',
  );

  const catalog = JSON.parse(readFileSync(resolve(root, SERVICE_CATALOG_PATH), 'utf8'));
  const serviceIds = new Set((catalog.services ?? []).map((service) => service.id));
  const actualOwnership = manifest.capabilityOwnership ?? {};
  assert(
    same(sorted(Object.keys(actualOwnership)), sorted(Object.keys(EXPECTED_CAPABILITY_OWNERSHIP))),
    'C001_CAPABILITY_SET',
  );
  for (const [capability, expectedOwner] of Object.entries(EXPECTED_CAPABILITY_OWNERSHIP)) {
    assert(
      actualOwnership[capability] === expectedOwner,
      `C001_OWNER_MISMATCH:${capability}:${expectedOwner}`,
    );
    assert(serviceIds.has(expectedOwner), `C001_OWNER_NOT_IN_CATALOG:${expectedOwner}`);
  }

  assert(
    Array.isArray(manifest.productionBoundaries) && manifest.productionBoundaries.length >= 7,
    'C001_PRODUCTION_BOUNDARIES',
  );

  return {
    ok: true,
    manifestId: manifest.manifestId,
    referenceSha256: observed.sha256,
    actions: observed.actions.length,
    forms: observed.forms.length,
    screens: screens.length,
    bookingSteps: flow.length,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = validateCustomerBehaviorManifest(loadCustomerManifest());
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exitCode = 1;
  }
}
