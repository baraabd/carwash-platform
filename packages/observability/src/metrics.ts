import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

const CACHE = Symbol.for('@carwash/observability/metrics/v1');
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const ROUTES = new Set(['/health/live', '/health/ready', '/metrics']);
export type EventOutcome = 'published' | 'applied' | 'duplicate' | 'retry' | 'rejected' | 'failed';
const OUTCOMES = new Set(['published', 'applied', 'duplicate', 'retry', 'rejected', 'failed']);
export interface PoolStats {
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
}
function safe(action: () => void): void {
  try {
    action();
  } catch {
    /* Never break business flows. */
  }
}
export class Metrics {
  private readonly requests: Counter<'method' | 'route' | 'status_class'>;
  private readonly duration: Histogram<'method' | 'route' | 'status_class'>;
  private readonly events: Counter<'outcome'>;
  private readonly lag: Histogram;
  private readonly pool: Gauge<'state'>;
  private readonly worker: Gauge<'kind'>;
  private readonly ready: Gauge;
  private readonly dependencies: Gauge<'kind'>;
  private readonly dependencyDuration: Histogram<'kind'>;
  private readPool?: () => PoolStats;
  constructor(readonly registry: Registry) {
    this.requests = new Counter({
      name: 'cw_http_requests_total',
      help: 'Completed HTTP requests',
      labelNames: ['method', 'route', 'status_class'],
      registers: [registry],
    });
    this.duration = new Histogram({
      name: 'cw_http_duration_seconds',
      help: 'HTTP duration in seconds',
      labelNames: ['method', 'route', 'status_class'],
      buckets: [0.005, 0.025, 0.1, 0.5, 1, 5, 30],
      registers: [registry],
    });
    this.events = new Counter({
      name: 'cw_events_total',
      help: 'Messaging outcomes; not unique events',
      labelNames: ['outcome'],
      registers: [registry],
    });
    this.lag = new Histogram({
      name: 'cw_event_lag_seconds',
      help: 'Event age at receipt',
      buckets: [0.1, 1, 10, 60, 300, 3600, 86400],
      registers: [registry],
    });
    this.pool = new Gauge({
      name: 'cw_db_pool_connections',
      help: 'Owner-local PostgreSQL pool statistics',
      labelNames: ['state'],
      registers: [registry],
      collect: () => {
        this.collectPool();
      },
    });
    this.worker = new Gauge({
      name: 'cw_worker_active',
      help: 'Active owner-local worker operations',
      labelNames: ['kind'],
      registers: [registry],
    });
    this.ready = new Gauge({
      name: 'cw_service_ready',
      help: 'Last observed business readiness (1 ready, 0 unavailable, -1 not observed)',
      registers: [registry],
    });
    this.dependencies = new Gauge({
      name: 'cw_dependency_up',
      help: 'Last observed dependency health',
      labelNames: ['kind'],
      registers: [registry],
    });
    this.dependencyDuration = new Histogram({
      name: 'cw_dependency_duration_seconds',
      help: 'Dependency probe duration',
      labelNames: ['kind'],
      registers: [registry],
    });
    this.ready.set(-1);
    collectDefaultMetrics({ register: registry, prefix: 'cw_' });
  }
  http(method: string, path: string, status: number, seconds: number): void {
    safe(() => {
      const labels = {
        method: METHODS.has(method) ? method : 'OTHER',
        route: ROUTES.has(path) ? path : 'application',
        status_class: status >= 100 && status < 600 ? `${Math.floor(status / 100)}xx` : 'unknown',
      };
      this.requests.inc(labels);
      if (Number.isFinite(seconds) && seconds >= 0)
        this.duration.observe(labels, Math.min(seconds, 3600));
      if (path === '/health/ready') this.ready.set(status >= 200 && status < 300 ? 1 : 0);
    });
  }
  event(outcome: EventOutcome, ageSeconds?: number): void {
    safe(() => {
      if (!OUTCOMES.has(outcome)) return;
      this.events.inc({ outcome });
      if (ageSeconds !== undefined && Number.isFinite(ageSeconds) && ageSeconds >= 0)
        this.lag.observe(Math.min(ageSeconds, 604800));
    });
  }
  dependency(
    kind: 'postgres' | 'redis' | 'rabbitmq' | 'http' | 'other',
    up: boolean,
    seconds: number,
  ): void {
    safe(() => {
      if (!['postgres', 'redis', 'rabbitmq', 'http', 'other'].includes(kind)) return;
      this.dependencies.set({ kind }, up ? 1 : 0);
      if (Number.isFinite(seconds) && seconds >= 0)
        this.dependencyDuration.observe({ kind }, Math.min(seconds, 60));
    });
  }
  observePool(read: () => PoolStats): void {
    this.readPool = read;
  }
  private collectPool(): void {
    safe(() => {
      const stats = this.readPool?.();
      if (!stats) return;
      for (const [state, number] of [
        ['total', stats.totalCount],
        ['idle', stats.idleCount],
        ['waiting', stats.waitingCount],
      ] as const) {
        if (Number.isFinite(number) && number >= 0) this.pool.set({ state }, number);
      }
    });
  }
  active(kind: 'relay' | 'consumer', delta: 1 | -1): void {
    safe(() => {
      if (kind === 'relay' || kind === 'consumer') this.worker.inc({ kind }, delta);
    });
  }
}
export function createMetrics(
  service: string,
  environment: string,
  registry = new Registry(),
): Metrics {
  const holder = registry as Registry & { [CACHE]?: Metrics };
  const previous = holder[CACHE];
  if (previous) return previous;
  registry.setDefaultLabels({ service, environment });
  const metrics = new Metrics(registry);
  Object.defineProperty(holder, CACHE, { value: metrics });
  return metrics;
}
export { Registry };
