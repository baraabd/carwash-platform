import { Controller, Get, Inject, Module, Res, type DynamicModule } from '@nestjs/common';
import type { Logger } from './logging';

/**
 * Liveness and readiness are different questions and are answered separately.
 *
 * live     -> "this process is running and its event loop responds".
 * ready    -> "this service may receive business traffic".
 *
 * A foundation shell whose business API is not implemented is ALIVE but never
 * READY. `businessReady:false` + HTTP 503 is a contract of this sprint: it must
 * not be flipped to 200 to satisfy a dashboard, an orchestrator or a smoke test.
 */

export interface DependencyProbe {
  readonly name: string;
  readonly kind: 'postgres' | 'rabbitmq' | 'http' | 'other';
  check(): Promise<void>;
}

export interface DependencyResult {
  readonly name: string;
  readonly kind: DependencyProbe['kind'];
  readonly status: 'UP' | 'DOWN';
  readonly error?: string;
  readonly durationMs: number;
}

export interface HealthOptions {
  readonly service: string;
  /** Sprint 0.2: every business service is a foundation shell. */
  readonly businessReady: boolean;
  readonly dependencies?: readonly DependencyProbe[];
  readonly logger?: Logger;
  readonly probeTimeoutMs?: number;
}

export const HEALTH_OPTIONS = 'CARWASH_HEALTH_OPTIONS';

async function withTimeout(probe: DependencyProbe, timeoutMs: number): Promise<DependencyResult> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      probe.check(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('PROBE_TIMEOUT')), timeoutMs);
        timer.unref?.();
      }),
    ]);
    return { name: probe.name, kind: probe.kind, status: 'UP', durationMs: Date.now() - started };
  } catch (error: unknown) {
    return {
      name: probe.name,
      kind: probe.kind,
      status: 'DOWN',
      // Probe errors can embed connection strings; only the class name escapes.
      error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      durationMs: Date.now() - started,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Minimal response surface so the module does not depend on an HTTP platform. */
export interface HealthResponse {
  status(code: number): HealthResponse;
  json(body: unknown): unknown;
}

@Controller('health')
export class HealthController {
  constructor(@Inject(HEALTH_OPTIONS) private readonly options: HealthOptions) {}

  @Get('live')
  live(): { service: string; status: 'alive'; stage: string } {
    return {
      service: this.options.service,
      status: 'alive',
      stage: this.options.businessReady ? 'business' : 'foundation-only',
    };
  }

  @Get('ready')
  async ready(@Res() res: HealthResponse): Promise<unknown> {
    const timeoutMs = this.options.probeTimeoutMs ?? 2000;
    const dependencies = await Promise.all(
      (this.options.dependencies ?? []).map((probe) => withTimeout(probe, timeoutMs)),
    );
    const dependenciesUp = dependencies.every((d) => d.status === 'UP');
    // A green dependency never promotes an unimplemented service to ready.
    const ready = this.options.businessReady && dependenciesUp;
    const body = {
      service: this.options.service,
      businessReady: this.options.businessReady,
      ready,
      code: this.options.businessReady
        ? dependenciesUp
          ? 'READY'
          : 'DEPENDENCY_DOWN'
        : 'FOUNDATION_NOT_READY',
      dependencies,
    };
    if (!ready) this.options.logger?.warn('readiness_not_ready', { code: body.code });
    return res.status(ready ? 200 : 503).json(body);
  }
}

@Module({})
export class HealthModule {
  static forService(options: HealthOptions): DynamicModule {
    return {
      module: HealthModule,
      controllers: [HealthController],
      providers: [{ provide: HEALTH_OPTIONS, useValue: options }],
      exports: [HEALTH_OPTIONS],
    };
  }
}
