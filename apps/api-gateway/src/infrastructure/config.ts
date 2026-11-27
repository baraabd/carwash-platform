import type { GatewayOwner } from '@carwash/contracts';
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
    const encryptedPrivateOrigin =
      config.privateNetwork === 'railway' &&
      /^[a-z][a-z0-9-]{0,62}\.railway\.internal$/.test(url.hostname);
    if (
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' &&
          (['127.0.0.1', '[::1]'].includes(url.hostname) || encryptedPrivateOrigin)
        ))
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
  const privateNetwork = env.GATEWAY_PRIVATE_NETWORK;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    privateNetwork &&
    (privateNetwork !== 'railway' ||
      !uuid.test(env.RAILWAY_PROJECT_ID ?? '') ||
      !uuid.test(env.RAILWAY_ENVIRONMENT_ID ?? ''))
  )
    throw new Error('INVALID_GATEWAY_PRIVATE_NETWORK');
  return validateGatewayConfig({
    origins: JSON.parse(env.GATEWAY_UPSTREAMS ?? '{}') as GatewayConfig['origins'],
    issuer: env.IDENTITY_ISSUER ?? '',
    audience: env.IDENTITY_AUDIENCE ?? '',
    cookiePrefix: env.GATEWAY_INSECURE_LOOPBACK_COOKIES === 'true' ? 'wg_' : '__Host-wg_',
    timeoutMs: Number(env.GATEWAY_TIMEOUT_MS ?? 3000),
    responseLimit: Number(env.GATEWAY_RESPONSE_LIMIT ?? 262144),
    allowedOrigins: (env.GATEWAY_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
    ...(privateNetwork === 'railway' ? { privateNetwork } : {}),
  });
}
