import type { OwnerContract } from '@carwash/contracts';
import { expandPath, type HttpClient, type ApiResult, type CallContext } from './transport.js';

export interface CallOptions<T> extends CallContext {
  readonly params?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly expectedRevision?: number;
  readonly parse: (value: unknown) => T;
}

/**
 * Call a named route of an owner contract. Revisioned routes refuse to send
 * without `expectedRevision`; idempotent routes refuse to send without a key.
 */
export function callRoute<C extends OwnerContract, T>(
  client: HttpClient,
  contract: C,
  name: keyof C['routes'] & string,
  options: CallOptions<T>,
): Promise<ApiResult<T>> {
  const route = contract.routes[name];
  if (!route) throw new Error(`UNKNOWN_ROUTE ${contract.id}.${name}`);
  if (route.revisioned && options.expectedRevision === undefined) {
    throw new Error(`REVISION_REQUIRED ${contract.id}.${name}`);
  }
  if (route.idempotent && options.idempotencyKey === undefined) {
    throw new Error(`IDEMPOTENCY_KEY_REQUIRED ${contract.id}.${name}`);
  }
  const { params, query, body, idempotencyKey, expectedRevision, parse, ...context } = options;
  return client.request(
    {
      method: route.method,
      path: `${contract.prefix}${expandPath(route.path, params ?? {})}`,
      ...(query === undefined ? {} : { query }),
      ...(body === undefined ? {} : { body }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
      parse,
      ...(route.safe ? { safe: true } : {}),
    },
    context,
  );
}
