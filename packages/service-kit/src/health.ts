import { serviceTelemetry } from '@carwash/observability';
import { Controller, Get, Inject, Module, Res, type DynamicModule } from '@nestjs/common';
import { bestEffortLog, type Logger } from './logging';
import { isServiceOriginAllowed } from '@carwash/security-kit';
import { parseServiceClients } from './service-clients';

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
  readonly kind: 'postgres' | 'redis' | 'rabbitmq' | 'http' | 'other';
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
  /** Foundation fallback; configured owners declare their actual capabilities below. */
  readonly businessReady: boolean;
  /** Local, implemented HTTP capabilities. Never a release/merchant/worker approval switch. */
  readonly runtimeCapabilities?: readonly RuntimeCapability[];
  readonly dependencies?: readonly DependencyProbe[];
  readonly logger?: Logger;
  readonly probeTimeoutMs?: number;
}

export interface RuntimeCapability {
  readonly name: string;
  /** Optional capabilities remain visible without claiming that they are implemented. */
  readonly required?: boolean;
  check(): boolean;
}

export function configurationCapability(name: string, check: () => boolean): RuntimeCapability {
  return { name, check };
}

export function originCapability(
  name: string,
  raw: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeCapability {
  return configurationCapability(name, () => !!raw && isServiceOriginAllowed(new URL(raw), env));
}

/** Every declared workload scope must have at least one valid owner-scoped credential. */
export function serviceClientsCapability(
  name: string,
  raw: string | undefined,
  scopes: readonly string[],
): RuntimeCapability {
  return configurationCapability(name, () => {
    const clients = parseServiceClients(raw, scopes);
    return (
      scopes.length > 0 &&
      scopes.every((scope) => clients.some((client) => client.scopes.includes(scope)))
    );
  });
}

export function credentialCapability(
  name: string,
  clientId: string | undefined,
  token: string | undefined,
): RuntimeCapability {
  return configurationCapability(
    name,
    () =>
      /^[a-z][a-z0-9-]{1,63}$/.test(clientId ?? '') && /^[\x21-\x7e]{32,256}$/.test(token ?? ''),
  );
}

/** Check only the owner's schema metadata, using its own injected database client. */
export function schemaReadinessProbe(
  expectedTables: readonly string[],
  tables: () => Promise<readonly string[]>,
): DependencyProbe {
  return {
    name: 'postgres-schema',
    kind: 'postgres',
    check: async () => {
      const present = new Set(await tables());
      if (expectedTables.length === 0 || !expectedTables.every((table) => present.has(table)))
        throw new Error('OWNER_SCHEMA_NOT_MIGRATED');
    },
  };
}

function capabilitiesFor(options: HealthOptions) {
  return (options.runtimeCapabilities ?? []).map((capability) => {
    try {
      const available = capability.check() === true;
      return {
        name: capability.name,
        required: capability.required !== false,
        available,
        code: available ? 'AVAILABLE' : 'NOT_CONFIGURED_OR_IMPLEMENTED',
      };
    } catch {
      // Config errors can contain paths, credentials or raw values. Return no exception text.
      return {
        name: capability.name,
        required: capability.required !== false,
        available: false,
        code: 'CONFIGURATION_INVALID',
      };
    }
  });
}

function businessReadiness(
  options: HealthOptions,
  capabilities = capabilitiesFor(options),
): boolean {
  const required = capabilities.filter((capability) => capability.required);
  return (
    options.businessReady ||
    (required.length > 0 && required.every((capability) => capability.available))
  );
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
      stage: businessReadiness(this.options) ? 'business' : 'foundation-only',
    };
  }

  @Get('ready')
  async ready(@Res() res: HealthResponse): Promise<unknown> {
    const timeoutMs = this.options.probeTimeoutMs ?? 2000;
    const dependencies = await Promise.all(
      (this.options.dependencies ?? []).map((probe) => withTimeout(probe, timeoutMs)),
    );
    const telemetry = serviceTelemetry(this.options.service);
    for (const dependency of dependencies)
      telemetry.metrics.dependency(
        dependency.kind,
        dependency.status === 'UP',
        dependency.durationMs / 1000,
      );
    const dependenciesUp = dependencies.length > 0 && dependencies.every((d) => d.status === 'UP');
    const capabilities = capabilitiesFor(this.options);
    const businessReady = businessReadiness(this.options, capabilities);
    // A green dependency never promotes an unimplemented service to ready.
    const ready = businessReady && dependenciesUp;
    // `code` keeps its precedence (an unimplemented service is never READY), but
    // `dependenciesReady` is always reported so an operator can tell a broken
    // database/broker apart from a foundation shell even while code says
    // FOUNDATION_NOT_READY. With no probe registered it is null ("not checked"),
    // never a vacuous true.
    const body = {
      service: this.options.service,
      businessReady,
      dependenciesReady: dependencies.length === 0 ? null : dependenciesUp,
      ready,
      code: businessReady ? (dependenciesUp ? 'READY' : 'DEPENDENCY_DOWN') : 'FOUNDATION_NOT_READY',
      dependencies,
      ...(this.options.runtimeCapabilities ? { scope: 'http-api', capabilities } : {}),
    };
    if (!ready)
      bestEffortLog(this.options.logger, 'warn', 'readiness_not_ready', { code: body.code });
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
