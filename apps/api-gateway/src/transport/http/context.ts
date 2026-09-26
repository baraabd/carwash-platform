import { randomBytes, randomUUID } from 'node:crypto';
import { UUID } from '../../domain/policy';
import type { RequestContext } from '../../ports/http';
export interface GatewayRequest {
  readonly method: string;
  readonly originalUrl: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body?: unknown;
  gatewayContext?: RequestContext;
}
export interface GatewayResponse {
  setHeader(name: string, value: string | readonly string[]): void;
  status(code: number): GatewayResponse;
  json(body: unknown): unknown;
  end(): void;
}
export function contextFor(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): RequestContext {
  const correlation = headers['x-correlation-id'];
  const incoming = headers.traceparent;
  const trace =
    typeof incoming === 'string' &&
    /^00-(?!0{32})[a-f0-9]{32}-(?!0{16})[a-f0-9]{16}-0[01]$/.test(incoming)
      ? incoming.split('-')[1]!
      : randomBytes(16).toString('hex');
  return {
    requestId: randomUUID(),
    correlationId:
      typeof correlation === 'string' && UUID.test(correlation) ? correlation : randomUUID(),
    traceparent: `00-${trace}-${randomBytes(8).toString('hex')}-01`,
  };
}
export function scalarHeaders(headers: GatewayRequest['headers']): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([name, value]) => [name.toLowerCase(), value]),
  );
}
