import { Module, type DynamicModule, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { RedisRateBudget } from '@carwash/security-kit';
import { AppModule } from './app.module';
import { IdentityAuthService } from './application/identity-auth.service';
import { PrismaIdentityStore } from './infrastructure/persistence/identity.store';
import { ArgonPasswords } from './infrastructure/security/passwords';
import { IdentitySecrets } from './infrastructure/security/secrets';
import { IdentitySigningKeys } from './infrastructure/security/signing-keys';
import { loadIdentityConfig, type IdentityConfig } from './infrastructure/security/config';
import { WebhookOtpDelivery } from './infrastructure/otp/webhook-delivery';
import type { Clock, OtpDelivery, Passwords } from './ports/identity.ports';
import {
  IDENTITY_RUNTIME,
  IdentityAuthController,
  IdentityHealthController,
} from './transport/http/auth.controller';
import { IdentityAuthFilter } from './transport/http/auth-filter';
import {
  IdentityHttpRuntime,
  type AuthRequest,
  type AuthResponse,
} from './transport/http/auth-runtime';

@Module({})
class IdentitySecurityModule {
  static register(runtime: IdentityHttpRuntime): DynamicModule {
    return {
      module: IdentitySecurityModule,
      controllers: [IdentityAuthController, IdentityHealthController],
      providers: [{ provide: IDENTITY_RUNTIME, useValue: runtime }],
    };
  }
}
/** Tests inject ports through a factory, never through a runtime fake-adapter environment flag. */
export async function createIdentityApplication(
  config: IdentityConfig,
  ports: {
    readonly delivery?: OtpDelivery;
    readonly clock?: Clock;
    readonly passwords?: Passwords;
  } = {},
): Promise<INestApplication> {
  const signing = await IdentitySigningKeys.load(
    config.privateKeyPem,
    config.issuer,
    config.audience,
    config.previousJwks,
  );
  const delivery =
    ports.delivery ?? new WebhookOtpDelivery(new URL(config.deliveryUrl), config.deliveryToken);
  const passwords = ports.passwords ?? (await ArgonPasswords.create());
  const store = new PrismaIdentityStore(config.databaseUrl);
  let budget: RedisRateBudget;
  try {
    budget = await RedisRateBudget.open(config.redisUrl, config.rateKey);
  } catch (error) {
    await store.close();
    throw error;
  }
  const auth = new IdentityAuthService({
    store,
    passwords,
    secrets: new IdentitySecrets(config.otpPepper),
    budget,
    delivery,
    signer: signing,
    clock: ports.clock ?? { now: () => Date.now() },
  });
  const runtime = new IdentityHttpRuntime(config, auth, signing, store, budget);
  let app: NestExpressApplication | undefined;
  try {
    app = await NestFactory.create<NestExpressApplication>(
      IdentitySecurityModule.register(runtime),
      { logger: false, bodyParser: false, abortOnError: false },
    );
    app.set('trust proxy', false);
    app.useBodyParser('json', { limit: '16kb', strict: true });
    app.enableCors({
      origin: [...config.origins],
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['content-type', 'authorization', 'x-csrf-token', 'x-correlation-id'],
      maxAge: 600,
    });
    app.use((request: AuthRequest, response: AuthResponse, next: () => void) => {
      const incoming = request.headers['x-correlation-id'];
      request.authRequestId =
        typeof incoming === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(incoming)
          ? incoming
          : randomUUID();
      response.setHeader('x-correlation-id', request.authRequestId);
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');
      response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
      next();
    });
    app.useGlobalFilters(new IdentityAuthFilter());
    return app;
  } catch (error) {
    if (app) await app.close();
    else await runtime.onModuleDestroy();
    throw error;
  }
}
export function createIdentityHttpApplication(): Promise<INestApplication> {
  const enabled = process.env.IDENTITY_AUTH_ENABLED;
  if (enabled === undefined || enabled === 'false')
    return NestFactory.create(AppModule, { bufferLogs: false });
  if (enabled !== 'true') return Promise.reject(new Error('INVALID_IDENTITY_AUTH_ENABLED'));
  return createIdentityApplication(loadIdentityConfig());
}
