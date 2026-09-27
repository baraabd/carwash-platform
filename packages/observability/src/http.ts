import { createHash, timingSafeEqual } from 'node:crypto';
import { traceHeaders } from './context';
import { serviceTelemetry, type Telemetry } from './telemetry';

interface Request {
  headers: Record<string, unknown>;
  method?: string;
  url?: string;
}
interface Response {
  statusCode: number;
  setHeader(name: string, value: string): void;
  once(event: 'finish' | 'close', callback: () => void): unknown;
  end(body?: string): unknown;
}
interface Application {
  use(middleware: (request: Request, response: Response, next: () => void) => void): unknown;
  close(): Promise<void>;
}
const instrumented = new WeakMap<Application, Telemetry>();
function authorized(received: unknown, secret: string): boolean {
  if (typeof received !== 'string' || received.length > 512) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(received), digest(`Bearer ${secret}`));
}
/** Installs before application routes. Metrics are internal and disabled without a strong token. */
export function instrumentApplication(
  app: Application,
  service: string,
  env: NodeJS.ProcessEnv = process.env,
): Telemetry {
  const prior = instrumented.get(app);
  if (prior) return prior;
  const telemetry = serviceTelemetry(service, env);
  const secret = env['OBSERVABILITY_METRICS_TOKEN'];
  app.use((request, response, next) => {
    const path = request.url?.split('?')[0] ?? '';
    if (path === '/metrics') {
      response.setHeader('Cache-Control', 'no-store');
      if (
        !secret ||
        secret.length < 32 ||
        secret.length > 256 ||
        !authorized(request.headers['authorization'], secret)
      ) {
        response.statusCode = 404;
        response.end();
        return;
      }
      if (request.method !== 'GET') {
        response.statusCode = 405;
        response.end();
        return;
      }
      response.setHeader('Cache-Control', 'no-store');
      void telemetry.metrics.registry
        .metrics()
        .then((body) => {
          response.setHeader('Content-Type', telemetry.metrics.registry.contentType);
          response.end(body);
        })
        .catch(() => {
          response.statusCode = 503;
          response.end();
        });
      return;
    }
    const scope = telemetry.start('http.request', request.headers);
    const headers = traceHeaders(scope.value);
    for (const [key, value] of Object.entries(headers)) {
      request.headers[key] = value;
      response.setHeader(key, value);
    }
    const start = process.hrtime.bigint();
    let ended = false;
    const finish = (aborted: boolean): void => {
      if (ended) return;
      ended = true;
      telemetry.metrics.http(
        request.method ?? 'OTHER',
        path,
        aborted ? 499 : response.statusCode,
        Number(process.hrtime.bigint() - start) / 1e9,
      );
      scope.run(() =>
        telemetry.logger.info('http_completed', { status: aborted ? 499 : response.statusCode }),
      );
      scope.finish(aborted || response.statusCode >= 500);
    };
    response.once('finish', () => finish(false));
    response.once('close', () => finish(true));
    scope.run(next);
  });
  const close = app.close.bind(app);
  app.close = async () => {
    try {
      await close();
    } finally {
      await telemetry.shutdown();
    }
  };
  instrumented.set(app, telemetry);
  return telemetry;
}
