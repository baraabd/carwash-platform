import { createGatewayApplication, loadGatewayConfig } from './index';
async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
  const app = await createGatewayApplication(loadGatewayConfig());
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
  await app.listen(port, process.env.HOST ?? '127.0.0.1');
}
void main().catch(() => {
  process.stderr.write('GATEWAY_STARTUP_FAILED\n');
  process.exitCode = 1;
});
