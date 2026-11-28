/** Technical transport policy; workload and user authorization stay with each owner. */
export interface PrivateServiceNetwork {
  readonly kind: 'railway';
  readonly hosts: readonly string[];
}

const PRIVATE_HOST = /^[a-z][a-z0-9-]{0,62}\.railway\.internal$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOOPBACK = new Set(['127.0.0.1', '[::1]', 'localhost']);

export function isRailwayPrivateHost(host: string): boolean {
  return PRIVATE_HOST.test(host);
}

/**
 * Railway's project/environment mesh encrypts traffic with WireGuard. HTTP is
 * permitted only after explicit deployment opt-in AND an exact target allowlist.
 * Merely looking internal (dotless, RFC1918, or a suffix lookalike) is insufficient.
 * The platform IDs bind configuration to a Railway deployment, never to a request.
 */
export function privateServiceNetworkFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PrivateServiceNetwork | undefined {
  const kind = env.CW_PRIVATE_NETWORK ?? env.GATEWAY_PRIVATE_NETWORK;
  if (kind === undefined || kind === '') return undefined;
  if (
    kind !== 'railway' ||
    !UUID.test(env.RAILWAY_PROJECT_ID ?? '') ||
    !UUID.test(env.RAILWAY_ENVIRONMENT_ID ?? '')
  )
    throw new Error('INVALID_PRIVATE_SERVICE_NETWORK');
  let hosts = env.CW_PRIVATE_HTTP_HOSTS?.split(',').map((host) => host.trim());
  // Compatibility with the existing Gateway deployment contract: its closed
  // owner map is already an explicit target allowlist. New deployments use CW_*.
  if (hosts === undefined && env.GATEWAY_PRIVATE_NETWORK === 'railway') {
    const origins: unknown = JSON.parse(env.GATEWAY_UPSTREAMS ?? '{}');
    if (origins === null || typeof origins !== 'object' || Array.isArray(origins))
      throw new Error('INVALID_PRIVATE_SERVICE_HOSTS');
    hosts = Object.values(origins)
      .map((origin) => {
        if (typeof origin !== 'string') throw new Error('INVALID_PRIVATE_SERVICE_HOSTS');
        return new URL(origin).hostname;
      })
      .filter(isRailwayPrivateHost);
  }
  if (!hosts?.length || hosts.length > 32 || hosts.some((host) => !isRailwayPrivateHost(host)))
    throw new Error('INVALID_PRIVATE_SERVICE_HOSTS');
  return { kind, hosts: Object.freeze([...new Set(hosts)]) };
}

/** Does not permit credentials, queries or fragments in a configured destination. */
export function isServiceUrlAllowed(url: URL, network?: PrivateServiceNetwork): boolean {
  if (url.username || url.password || url.search || url.hash) return false;
  if (url.protocol === 'https:') return true;
  return (
    url.protocol === 'http:' &&
    (LOOPBACK.has(url.hostname) ||
      (network?.kind === 'railway' &&
        isRailwayPrivateHost(url.hostname) &&
        network.hosts.includes(url.hostname)))
  );
}

export function isServiceOriginAllowed(
  url: URL,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return url.pathname === '/' && isServiceUrlAllowed(url, privateServiceNetworkFromEnv(env));
}
