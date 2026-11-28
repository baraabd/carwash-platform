import { createHash, randomUUID } from 'node:crypto';
import { serviceTelemetry } from '@carwash/service-kit';
import { InitialAdministratorService } from '../../application/initial-administrator.service';
import { InitialAdministratorFault } from '../../domain/initial-administrator';
import { PrismaIdentityStore } from '../../infrastructure/persistence/identity.store';
import { PrismaInitialAdministratorStore } from '../../infrastructure/persistence/initial-administrator.store';

export function parseBootstrapArguments(argv: readonly string[]): {
  accountId: string;
  expectedEmail: string;
  requestId: string;
  reason: string;
} {
  const names = ['--account-id', '--expected-email', '--request-id', '--reason'];
  const values = new Map<string, string>();
  if (argv.length !== names.length * 2)
    throw new InitialAdministratorFault('BOOTSTRAP_INVALID_REQUEST');
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    const value = argv[i + 1];
    if (!name || !names.includes(name) || values.has(name) || !value || value.startsWith('--'))
      throw new InitialAdministratorFault('BOOTSTRAP_INVALID_REQUEST');
    values.set(name, value);
  }
  return {
    accountId: values.get('--account-id')!,
    expectedEmail: values.get('--expected-email')!,
    requestId: values.get('--request-id')!,
    reason: values.get('--reason')!,
  };
}

export async function main(argv = process.argv.slice(2), env = process.env): Promise<void> {
  const command = parseBootstrapArguments(argv);
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  const store = new PrismaIdentityStore(env.DATABASE_URL);
  try {
    const service = new InitialAdministratorService(
      new PrismaInitialAdministratorStore(store),
      { now: () => new Date() },
      { next: randomUUID },
      (canonical) => createHash('sha256').update(canonical).digest('hex'),
    );
    const result = await service.execute(command);
    // Receipt identifiers only: never print email, reason, tokens, OTP or database credentials.
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await store.close();
    await serviceTelemetry('identity').shutdown();
  }
}

if (require.main === module)
  void main().catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({
        status: 'FAILED',
        code: error instanceof InitialAdministratorFault ? error.code : 'BOOTSTRAP_UNAVAILABLE',
      })}\n`,
    );
    process.exitCode = 1;
  });
