import { readCookies } from '@carwash/security-kit';
import { GatewayFault } from '../domain/policy';
import type { RequestContext } from '../ports/http';
import type { GatewayConfig } from '../ports/config';
export function identityHeaders(
  headers: Readonly<Record<string, string>>,
  config: GatewayConfig,
  context: RequestContext,
): Record<string, string> {
  const result: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-request-id': context.requestId,
    'x-correlation-id': context.correlationId,
    traceparent: context.traceparent,
  };
  for (const field of ['authorization', 'origin', 'sec-fetch-site', 'x-csrf-token'])
    if (headers[field]) result[field] = headers[field];
  let cookies: Readonly<Record<string, string>>;
  try {
    cookies = readCookies(headers.cookie);
  } catch {
    throw new GatewayFault(400, 'REQUEST_INVALID');
  }
  const names = ['access', 'refresh', 'csrf', 'pre'].map((x) => config.cookiePrefix + x);
  const selected = names.filter((n) => cookies[n]).map((n) => `${n}=${cookies[n]}`);
  if (selected.length) result.cookie = selected.join('; ');
  return result;
}
