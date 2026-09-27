import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { ROOT_CONTEXT, trace, type Context } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

export interface TelemetryContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly context: Context;
}
export type Headers = Readonly<Record<string, unknown>>;
const contexts = new AsyncLocalStorage<TelemetryContext>();
const propagator = new W3CTraceContextPropagator();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRACEPARENT = /^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-0[01]$/;
export function safeId(value: unknown): string {
  return typeof value === 'string' && UUID.test(value) ? value : randomUUID();
}
export function currentContext(): TelemetryContext | undefined {
  return contexts.getStore();
}
export function remoteContext(headers: Headers): TelemetryContext {
  const parent = headers['traceparent'];
  // Deliberately do not propagate arbitrary baggage/tracestate (may contain PII).
  const carrier =
    typeof parent === 'string' && TRACEPARENT.test(parent) ? { traceparent: parent } : {};
  const context = propagator.extract(ROOT_CONTEXT, carrier, {
    keys: (value) => Object.keys(value),
    get: (value, key) => (value as Record<string, string>)[key],
  });
  return {
    context,
    requestId: safeId(headers['x-request-id']),
    correlationId: safeId(headers['x-correlation-id']),
  };
}
export function withContext<T>(value: TelemetryContext, callback: () => T): T {
  return contexts.run(value, callback);
}
export function traceHeaders(value = currentContext()): Record<string, string> {
  if (!value) return {};
  const result: Record<string, string> = {
    'x-request-id': value.requestId,
    'x-correlation-id': value.correlationId,
  };
  propagator.inject(value.context, result, {
    set: (carrier, key, item) => {
      if (key === 'traceparent') carrier[key] = String(item);
    },
  });
  return result;
}
export function logContext(): Record<string, string> {
  const value = currentContext();
  if (!value) return {};
  const span = trace.getSpanContext(value.context);
  return {
    requestId: value.requestId,
    correlationId: value.correlationId,
    ...(span ? { traceId: span.traceId, spanId: span.spanId } : {}),
  };
}
