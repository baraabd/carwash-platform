import { GATEWAY_ROUTES, type GatewayOwner } from '@carwash/contracts';
import {
  isRailwayPrivateHost,
  isServiceUrlAllowed,
  privateServiceNetworkFromEnv,
} from '@carwash/security-kit';
import type { GatewayConfig } from '../ports/config';
export type { GatewayConfig } from '../ports/config';
const OWNERS: readonly GatewayOwner[] = [
  'identity',
  'customer',
  'vehicle',
  'catalog',
  'pricing',
  'geo',
  'scheduling',
  'booking',
  'workforce',
  'billing',
  'subscription',
  'reviews',
  'support',
  'reporting',
  'dispatch',
  'communications',
  'media',
];
/** Readiness covers every owner in the shipped route contract, never just the configured subset. */
export const REQUIRED_GATEWAY_OWNERS = Object.freeze([
  ...new Set(GATEWAY_ROUTES.map((route) => route.owner)),
]);
export function gatewayRoutingConfigured(config: GatewayConfig): boolean {
  return (
    REQUIRED_GATEWAY_OWNERS.length > 0 &&
    REQUIRED_GATEWAY_OWNERS.every((owner) => !!config.origins[owner])
  );
}
export function validateGatewayConfig(config: GatewayConfig): GatewayConfig {
  if (config.privateNetwork !== undefined && config.privateNetwork !== 'railway')
    throw new Error('INVALID_GATEWAY_PRIVATE_NETWORK');
  if (
    !config.origins.identity ||
    !config.issuer ||
    !config.audience ||
    !['__Host-wg_', 'wg_'].includes(config.cookiePrefix)
  )
    throw new Error('INVALID_GATEWAY_CONFIG');
  if (
    !Number.isInteger(config.timeoutMs) ||
    config.timeoutMs < 50 ||
    config.timeoutMs > 30000 ||
    !Number.isInteger(config.responseLimit) ||
    config.responseLimit < 1024 ||
    config.responseLimit > 1048576
  )
    throw new Error('INVALID_GATEWAY_BUDGET');
  for (const [owner, raw] of Object.entries(config.origins)) {
    if (!OWNERS.includes(owner as GatewayOwner)) throw new Error('UNKNOWN_GATEWAY_OWNER');
    const url = new URL(raw);
    const network =
      config.privateNetwork === 'railway'
        ? {
            kind: 'railway' as const,
            hosts:
              config.privateHttpHosts ??
              Object.values(config.origins)
                .map((origin) => new URL(origin).hostname)
                .filter(isRailwayPrivateHost),
          }
        : undefined;
    if (
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      !isServiceUrlAllowed(url, network)
    )
      throw new Error('INVALID_UPSTREAM_ORIGIN');
  }
  if (
    !config.allowedOrigins.length ||
    config.allowedOrigins.some(
      (x) =>
        new URL(x).origin !== x ||
        !(x.startsWith('https://') || /^http:\/\/127\.0\.0\.1:\d+$/.test(x)),
    )
  )
    throw new Error('INVALID_BROWSER_ORIGINS');
  return config;
}
export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const privateNetwork = env.CW_PRIVATE_NETWORK ?? env.GATEWAY_PRIVATE_NETWORK;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    privateNetwork &&
    (privateNetwork !== 'railway' ||
      !uuid.test(env.RAILWAY_PROJECT_ID ?? '') ||
      !uuid.test(env.RAILWAY_ENVIRONMENT_ID ?? ''))
  )
    throw new Error('INVALID_GATEWAY_PRIVATE_NETWORK');
  const network = privateServiceNetworkFromEnv(env);
  return validateGatewayConfig({
    origins: JSON.parse(env.GATEWAY_UPSTREAMS ?? '{}') as GatewayConfig['origins'],
    issuer: env.IDENTITY_ISSUER ?? '',
    audience: env.IDENTITY_AUDIENCE ?? '',
    cookiePrefix: env.GATEWAY_INSECURE_LOOPBACK_COOKIES === 'true' ? 'wg_' : '__Host-wg_',
    timeoutMs: Number(env.GATEWAY_TIMEOUT_MS ?? 3000),
    responseLimit: Number(env.GATEWAY_RESPONSE_LIMIT ?? 262144),
    allowedOrigins: (env.GATEWAY_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
    ...(network ? { privateNetwork: network.kind, privateHttpHosts: network.hosts } : {}),
  });
}
