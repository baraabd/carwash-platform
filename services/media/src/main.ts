import 'reflect-metadata';
import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

// Foundation shell ONLY: no business endpoint or production authorization yet.
@Controller('health')
class HealthController {
  @Get('live') live() { return { service: 'media', status: 'alive', stage: 'foundation-only' }; }
  @Get('ready') ready(): never {
    // Fail closed instead of advertising an unfinished service as deployable.
    throw new ServiceUnavailableException({ code: 'FOUNDATION_NOT_READY' });
  }
}
@Module({ controllers: [HealthController] })
class AppModule {}
async function bootstrap(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  // Loopback default: exposing this skeleton is never implicit.
  await app.listen(port, process.env.HOST ?? '127.0.0.1');
}
void bootstrap().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
