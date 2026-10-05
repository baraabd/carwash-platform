/** Runtime onboarding and accepted capabilities never imply product readiness. */
export const RUNTIME_IMPLEMENTATIONS = Object.freeze({
  skeleton: 'directory-and-typescript-skeleton-only',
  legacyFoundation: 'existing-health-only-shell',
  foundation: 'onboarded-foundation-runtime',
  capability: 'implemented-capability-runtime',
});
export const WEB_RUNTIME_LIFECYCLES = Object.freeze({
  skeleton: RUNTIME_IMPLEMENTATIONS.skeleton,
  foundation: 'onboarded-foundation-web-runtime',
});
const CAPABILITY_OWNERS = Object.freeze({
  'identity-security-v1': 'identity',
  'gateway-routing-v1': 'gateway',
});

export function classifyServiceRuntime(service) {
  if (!service || typeof service !== 'object' || !/^[a-z][a-z0-9-]*$/.test(service.id)) {
    throw new Error('INVALID_RUNTIME_SERVICE');
  }
  const implementation = service.runtimeImplementation;
  if (!Object.values(RUNTIME_IMPLEMENTATIONS).includes(implementation)) {
    throw new Error(`Unclassified runtime state: ${service.id}`);
  }
  const capabilities = service.acceptedCapabilities ?? [];
  if (!Array.isArray(capabilities) || new Set(capabilities).size !== capabilities.length) {
    throw new Error(`INVALID_ACCEPTED_CAPABILITIES: ${service.id}`);
  }
  for (const capability of capabilities) {
    if (CAPABILITY_OWNERS[capability] !== service.id) {
      throw new Error(`UNCLASSIFIED_RUNTIME_CAPABILITY: ${service.id}/${capability}`);
    }
  }
  const capable = implementation === RUNTIME_IMPLEMENTATIONS.capability;
  if (capable !== capabilities.length > 0) {
    throw new Error(`CAPABILITY_LIFECYCLE_MISMATCH: ${service.id}`);
  }
  return Object.freeze({
    runtime: implementation !== RUNTIME_IMPLEMENTATIONS.skeleton,
    foundation: [
      RUNTIME_IMPLEMENTATIONS.legacyFoundation,
      RUNTIME_IMPLEMENTATIONS.foundation,
    ].includes(implementation),
    capabilities: Object.freeze([...capabilities]),
    businessReady: false,
  });
}
export const isRuntimeService = (service) => classifyServiceRuntime(service).runtime;
export const isFoundationService = (service) => classifyServiceRuntime(service).foundation;
export function selectRuntimeServices(catalog) {
  if (!catalog || !Array.isArray(catalog.services)) throw new Error('INVALID_SERVICE_CATALOG');
  const ids = catalog.services.map((service) => service.id);
  if (new Set(ids).size !== ids.length) throw new Error('DUPLICATE_RUNTIME_SERVICE');
  return catalog.services.filter(isRuntimeService);
}
export function classifyWebRuntime(app) {
  if (
    !app ||
    !['customer-web', 'operator-web', 'admin-web'].includes(app.id) ||
    !Object.values(WEB_RUNTIME_LIFECYCLES).includes(app.runtimeLifecycle)
  ) {
    throw new Error(`Unclassified app runtime state: ${app?.id}`);
  }
  return Object.freeze({
    runtime: app.runtimeLifecycle === WEB_RUNTIME_LIFECYCLES.foundation,
    foundation: true,
    businessReady: false,
  });
}
