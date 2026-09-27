import { SpanKind, SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  ParentBasedSampler,
  AlwaysOnSampler,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  currentContext,
  remoteContext,
  withContext,
  type Headers,
  type TelemetryContext,
} from './context';
import { createLogger, type LoggerOptions } from './logging';
import { createMetrics } from './metrics';

export interface TelemetryOptions extends LoggerOptions {
  readonly exporter?: SpanExporter;
  readonly env?: NodeJS.ProcessEnv;
  readonly flushTimeoutMs?: number;
}
export type Operation =
  'http.request' | 'http.client' | 'messaging.publish' | 'messaging.consume' | 'worker.run';
function exporterFrom(env: NodeJS.ProcessEnv): SpanExporter | undefined {
  const endpoint = env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'];
  if (!endpoint) return undefined;
  try {
    const url = new URL(endpoint);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
    )
      return undefined;
    return new OTLPTraceExporter({ url: url.href, timeoutMillis: 1000, headers: {} });
  } catch {
    return undefined;
  }
}
export class Telemetry {
  readonly logger;
  readonly metrics;
  private readonly provider;
  private readonly tracer;
  private readonly flushTimeout: number;
  private stopped?: Promise<void>;
  constructor(options: TelemetryOptions) {
    const configured = options.environment ?? options.env?.['NODE_ENV'] ?? 'development';
    const environment = ['development', 'test', 'staging', 'production'].includes(configured)
      ? configured
      : 'unknown';
    this.logger = createLogger({ ...options, environment });
    this.metrics = createMetrics(options.service, environment);
    const exporter = options.exporter ?? exporterFrom(options.env ?? process.env);
    this.provider = new BasicTracerProvider({
      resource: resourceFromAttributes({
        'service.name': options.service,
        'deployment.environment.name': environment,
      }),
      sampler: new ParentBasedSampler({ root: new AlwaysOnSampler() }),
      spanProcessors: exporter
        ? [
            new BatchSpanProcessor(exporter, {
              exportTimeoutMillis: 1000,
              maxQueueSize: 512,
              maxExportBatchSize: 64,
              scheduledDelayMillis: 1000,
            }),
          ]
        : [],
    });
    this.tracer = this.provider.getTracer('@carwash/observability', '0.0.1');
    this.flushTimeout = Math.min(Math.max(options.flushTimeoutMs ?? 2000, 10), 5000);
  }
  start(
    operation: Operation,
    headers?: Headers,
  ): {
    readonly value: TelemetryContext;
    finish(failed?: boolean): void;
    run<T>(callback: () => T): T;
  } {
    const parent = headers ? remoteContext(headers) : (currentContext() ?? remoteContext({}));
    let span: Span | undefined;
    try {
      const kind =
        operation === 'http.request'
          ? SpanKind.SERVER
          : operation === 'http.client'
            ? SpanKind.CLIENT
            : operation === 'messaging.publish'
              ? SpanKind.PRODUCER
              : operation === 'messaging.consume'
                ? SpanKind.CONSUMER
                : SpanKind.INTERNAL;
      span = this.tracer.startSpan(operation, { kind }, parent.context);
    } catch {
      /* A broken exporter/provider cannot prevent the operation. */
    }
    const value = {
      ...parent,
      context: span ? trace.setSpan(parent.context, span) : parent.context,
    };
    let finished = false;
    return {
      value,
      run: (callback) => withContext(value, callback),
      finish: (failed = false) => {
        if (finished) return;
        finished = true;
        try {
          if (failed) span?.setStatus({ code: SpanStatusCode.ERROR });
          span?.end();
        } catch {
          /* No exception text is recorded. */
        }
      },
    };
  }
  async run<T>(operation: Operation, callback: () => Promise<T>, headers?: Headers): Promise<T> {
    const scope = this.start(operation, headers);
    try {
      const result = await scope.run(callback);
      scope.finish();
      return result;
    } catch (error: unknown) {
      scope.finish(true);
      throw error;
    }
  }
  shutdown(): Promise<void> {
    this.stopped ??= (async () => {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          (async () => {
            try {
              await this.provider.shutdown();
            } finally {
              await this.logger.flush();
            }
          })(),
          new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              this.logger.warn('telemetry_flush_timeout');
              resolve();
            }, this.flushTimeout);
          }),
        ]);
      } catch {
        this.logger.warn('telemetry_flush_failed');
      } finally {
        if (timer) clearTimeout(timer);
        if (runtimes.get(this.logger.service) === this) runtimes.delete(this.logger.service);
      }
    })();
    return this.stopped;
  }
}
const runtimes = new Map<string, Telemetry>();
/** One owner-local runtime per service/process. No global OpenTelemetry registration. */
export function serviceTelemetry(service: string, env: NodeJS.ProcessEnv = process.env): Telemetry {
  let value = runtimes.get(service);
  if (!value) {
    const configured = env['LOG_LEVEL'];
    const level =
      configured === 'debug' || configured === 'warn' || configured === 'error'
        ? configured
        : 'info';
    value = new Telemetry({ service, env, level });
    runtimes.set(service, value);
  }
  return value;
}
