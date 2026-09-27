/** The browser fixture may contact only its own loopback Identity process. */
export function loopbackIdentityPort(value) {
  const url = new URL(value);
  const port = Number(url.port);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error('INVALID_FIXTURE_UPSTREAM');
  return port;
}
