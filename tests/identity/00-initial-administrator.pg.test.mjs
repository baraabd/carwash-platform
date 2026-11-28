/**
 * Disposable real owner PostgreSQL, Argon2, OTP verification and RS256 signer.
 * Delivery is a captured test port; rate-budget is a declared allow port.
 * This proves one-shot provisioning, not hosted OTP delivery or HTTP security.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const own = createRequire(path.join(ROOT, 'services/identity/package.json'));
const { PrismaIdentityStore } = own('./dist/infrastructure/persistence/identity.store.js');
const { PrismaInitialAdministratorStore } = own(
  './dist/infrastructure/persistence/initial-administrator.store.js',
);
const { InitialAdministratorService } = own('./dist/application/initial-administrator.service.js');
const { IdentityAuthService } = own('./dist/application/identity-auth.service.js');
const { ArgonPasswords } = own('./dist/infrastructure/security/passwords.js');
const { IdentitySecrets } = own('./dist/infrastructure/security/secrets.js');
const { IdentitySigningKeys } = own('./dist/infrastructure/security/signing-keys.js');
const { serviceTelemetry } = own('@carwash/service-kit');
const f006 = process.env.F006_CONTEXT_FILE
  ? JSON.parse(await readFile(process.env.F006_CONTEXT_FILE, 'utf8'))
  : null;
const url = f006?.databaseUrl ?? process.env.IDENTITY_TEST_DATABASE_URL;
if (!url) throw new Error('DISPOSABLE_IDENTITY_DATABASE_REQUIRED');
const parsed = new URL(url);
if (
  parsed.hostname !== '127.0.0.1' ||
  parsed.pathname !== '/cw_identity' ||
  parsed.username !== 'cw_identity_app'
)
  throw new Error('DISPOSABLE_IDENTITY_RUNTIME_ROLE_REQUIRED');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const PASSWORD = 'Bootstrap proof test credential 2026!';
const meta = () => ({ ip: '127.0.0.1', requestId: randomUUID() });

test(
  'initial administrator: verified-only, atomic, race-safe, audited and irreversibly one-shot',
  { timeout: 60_000 },
  async (t) => {
    const persistence = new PrismaIdentityStore(url);
    const replica = new PrismaIdentityStore(url);
    t.after(async () => {
      await Promise.all([persistence.close(), replica.close()]);
      await serviceTelemetry('identity').shutdown();
    });
    if (f006)
      assert.ok(
        await persistence.client.serviceMarker.findUnique({ where: { service: f006.sentinel } }),
      );
    assert.equal(
      await persistence.client.identityInitialAdministrator.count(),
      0,
      'fresh disposable DB required',
    );
    assert.equal(
      await persistence.client.identityAccount.count({ where: { roles: { has: 'super-admin' } } }),
      0,
    );
    const passwords = await ArgonPasswords.create({
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    const key = generateKeyPairSync('rsa', { modulusLength: 3072 });
    const signer = await IdentitySigningKeys.load(
      key.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      'https://identity.bootstrap.test.invalid',
      'bootstrap-proof',
    );
    const deliveries = new Map();
    const auth = new IdentityAuthService({
      store: persistence,
      passwords,
      signer,
      secrets: new IdentitySecrets(randomBytes(32)),
      clock: { now: Date.now },
      budget: { take: async () => ({ allowed: true }) },
      delivery: {
        deliver: async (input) => {
          deliveries.set(input.challengeId, input);
        },
      },
    });
    const verify = async (kind, email) => {
      const challenge = await auth.issue(kind, email, PASSWORD, meta());
      const sent = deliveries.get(challenge.challengeId);
      assert.ok(sent, 'real OTP verification requires the delivered challenge');
      return auth.verifyChallenge(challenge.challengeId, sent.code, meta());
    };
    const account = async () => {
      const email = `bootstrap-${randomUUID()}@example.invalid`;
      const tokens = await verify('REGISTER', email);
      return { email, tokens, id: tokens.session.subject };
    };
    const first = await account();
    const other = await account();
    const input = {
      accountId: first.id,
      expectedEmail: first.email,
      requestId: randomUUID(),
      reason: 'Initial administrator for isolated provisioning acceptance',
    };
    const service = (store = persistence, ids = { next: randomUUID }) =>
      new InitialAdministratorService(
        new PrismaInitialAdministratorStore(store),
        { now: () => new Date() },
        ids,
        hash,
      );

    await t.test(
      'no arbitrary account, email mismatch, suspension or unverified account can be promoted',
      async () => {
        const notVerified = randomUUID();
        // Negative fixture only: a bare account row and a session are not verification evidence.
        await persistence.client.identityAccount.create({
          data: {
            id: notVerified,
            kind: 'account',
            email: `unverified-${notVerified}@example.invalid`,
            passwordHash: await passwords.hash(PASSWORD),
            status: 'ACTIVE',
            roles: ['customer'],
            authVersion: 1,
          },
        });
        await assert.rejects(
          service().execute({
            ...input,
            accountId: notVerified,
            expectedEmail: `unverified-${notVerified}@example.invalid`,
          }),
          (e) => e.code === 'BOOTSTRAP_VERIFICATION_REQUIRED',
        );
        for (const command of [
          { ...input, accountId: randomUUID() },
          { ...input, expectedEmail: other.email },
        ])
          await assert.rejects(
            service().execute(command),
            (e) => e.code === 'BOOTSTRAP_TARGET_INVALID',
          );
        await persistence.client.identityAccount.update({
          where: { id: first.id },
          data: { status: 'SUSPENDED' },
        });
        await assert.rejects(
          service().execute(input),
          (e) => e.code === 'BOOTSTRAP_TARGET_INVALID',
        );
        await persistence.client.identityAccount.update({
          where: { id: first.id },
          data: { status: 'ACTIVE' },
        });
        assert.equal(await persistence.client.identityInitialAdministrator.count(), 0);
      },
    );
    await t.test(
      'an existing administrator blocks initialization even when that administrator is suspended',
      async () => {
        // Model a pre-existing deployment. This is a negative test, never provisioning code.
        await persistence.client.identityAccount.update({
          where: { id: other.id },
          data: { roles: ['customer', 'super-admin'], status: 'SUSPENDED' },
        });
        await assert.rejects(service().execute(input), (e) => e.code === 'BOOTSTRAP_ADMIN_EXISTS');
        await persistence.client.identityAccount.update({
          where: { id: other.id },
          data: { roles: ['customer'], status: 'ACTIVE' },
        });
      },
    );
    await t.test(
      'failed audit insertion rolls back the grant, authVersion and session revocation',
      async () => {
        const existing = await persistence.client.identityAudit.findFirst({
          where: { subjectId: first.id },
        });
        await assert.rejects(
          service(persistence, { next: () => existing.id }).execute(input),
          (e) => e.code === 'P2002',
        );
        const current = await persistence.client.identityAccount.findUnique({
          where: { id: first.id },
        });
        assert.deepEqual(current.roles, ['customer']);
        assert.equal(current.authVersion, first.tokens.session.authVersion);
        assert.equal(
          (
            await persistence.client.identitySession.findUnique({
              where: { id: first.tokens.session.sessionId },
            })
          ).revokedAt,
          null,
        );
        assert.equal(await persistence.client.identityInitialAdministrator.count(), 0);
      },
    );
    let receipt;
    await t.test(
      'concurrent replicas create one grant and replay the same receipt without repeating effects',
      async () => {
        const outcomes = await Promise.all(
          Array.from({ length: 8 }, (_, i) =>
            service(i % 2 ? replica : persistence).execute(input),
          ),
        );
        assert.equal(outcomes.filter((r) => r.status === 'CREATED').length, 1);
        assert.equal(outcomes.filter((r) => r.status === 'REPLAYED').length, 7);
        receipt = await persistence.client.identityInitialAdministrator.findUnique({
          where: { singleton: 1 },
        });
        assert.equal(receipt.requestId, input.requestId);
        assert.equal(receipt.grantedAuthVersion, 2);
        const [current, sessions, grantAudit, sourceChallenge, sourceAudit] = await Promise.all([
          persistence.client.identityAccount.findUnique({ where: { id: first.id } }),
          persistence.client.identitySession.findMany({ where: { accountId: first.id } }),
          persistence.client.identityAudit.findMany({
            where: { action: 'initial-administrator.granted' },
          }),
          persistence.client.identityChallenge.findUnique({ where: { id: receipt.challengeId } }),
          persistence.client.identityAudit.findUnique({ where: { id: receipt.loginAuditId } }),
        ]);
        assert.deepEqual(current.roles, ['customer', 'super-admin']);
        assert.equal(current.authVersion, 2);
        assert.ok(sessions.length > 0 && sessions.every((s) => s.revokedAt));
        assert.equal(grantAudit.length, 1);
        assert.equal(grantAudit[0].actorId, null);
        assert.equal(grantAudit[0].id, receipt.auditId);
        assert.equal(sourceChallenge.state, 'USED');
        assert.equal(sourceChallenge.email, first.email);
        assert.equal(sourceAudit.action, 'login.succeeded');
        assert.equal(sourceAudit.subjectId, first.id);
        await assert.rejects(
          auth.authorize(first.tokens.session),
          (e) => e.code === 'AUTH_REQUIRED',
        );
      },
    );
    await t.test(
      'CLI replays the receipt and emits no credential, email or supplied reason',
      async () => {
        const child = spawn(
          process.execPath,
          [
            path.join(
              ROOT,
              'services/identity/dist/transport/cli/bootstrap-initial-administrator.js',
            ),
            '--account-id',
            input.accountId,
            '--expected-email',
            input.expectedEmail,
            '--request-id',
            input.requestId,
            '--reason',
            input.reason,
          ],
          { env: { ...process.env, DATABASE_URL: url }, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let stdout = '',
          stderr = '';
        child.stdout.on('data', (data) => {
          stdout += data;
        });
        child.stderr.on('data', (data) => {
          stderr += data;
        });
        const code = await new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', resolve);
        });
        assert.equal(code, 0, stderr);
        const result = JSON.parse(stdout.trim());
        assert.equal(result.status, 'REPLAYED');
        assert.equal(result.requestId, input.requestId);
        for (const privateValue of [url, PASSWORD, input.expectedEmail, input.reason])
          assert.equal((stdout + stderr).includes(privateValue), false);
        await assert.rejects(
          service().execute({ ...input, reason: 'A different operation under the same request' }),
          (e) => e.code === 'BOOTSTRAP_REQUEST_CONFLICT',
        );
        await assert.rejects(
          service().execute({
            ...input,
            accountId: other.id,
            expectedEmail: other.email,
            requestId: randomUUID(),
          }),
          (e) => e.code === 'BOOTSTRAP_ALREADY_USED',
        );
      },
    );
    await t.test(
      'runtime role cannot erase the singleton, rewrite verification/audit evidence or execute its guard',
      async () => {
        for (const statement of [
          'DELETE FROM app.identity_initial_administrator',
          "UPDATE app.identity_initial_administrator SET reason='replacement reason'",
          'TRUNCATE app.identity_initial_administrator',
        ])
          await assert.rejects(
            persistence.client.$executeRawUnsafe(statement),
            /IDENTITY_INITIAL_ADMINISTRATOR_IMMUTABLE|permission denied/,
          );
        await assert.rejects(
          persistence.client.identityAudit.update({
            where: { id: receipt.auditId },
            data: { outcome: 'FAILED' },
          }),
          /EVIDENCE_IMMUTABLE/,
        );
        await assert.rejects(
          persistence.client.identityChallenge.update({
            where: { id: receipt.challengeId },
            data: { state: 'INVALID' },
          }),
          /EVIDENCE_IMMUTABLE/,
        );
        const [permission] = await persistence.client.$queryRawUnsafe(
          "SELECT has_function_privilege(current_user,'app.identity_initial_administrator_immutable()','EXECUTE') AS allowed",
        );
        assert.equal(permission.allowed, false);
      },
    );
    await t.test(
      'regular Identity role removal cannot reopen bootstrap even for the original request',
      async () => {
        const adminTokens = await verify('LOGIN', first.email);
        await auth.changeAccount(
          adminTokens.session,
          other.id,
          { roles: ['customer', 'super-admin'] },
          meta(),
        );
        const secondAdmin = await verify('LOGIN', other.email);
        await auth.changeAccount(secondAdmin.session, first.id, { roles: ['customer'] }, meta());
        await assert.rejects(service().execute(input), (e) => e.code === 'BOOTSTRAP_GRANT_CHANGED');
        await assert.rejects(
          service().execute({ ...input, requestId: randomUUID() }),
          (e) => e.code === 'BOOTSTRAP_ALREADY_USED',
        );
        assert.equal(await persistence.client.identityInitialAdministrator.count(), 1);
        assert.equal(
          await persistence.client.identityAudit.count({
            where: { action: 'initial-administrator.granted' },
          }),
          1,
        );
        // Leave no administrator fixture for the following independent F006 suites.
        await persistence.client.identityAccount.update({
          where: { id: other.id },
          data: { roles: ['customer'], authVersion: { increment: 1 } },
        });
        await persistence.client.identitySession.updateMany({
          where: { accountId: other.id },
          data: { revokedAt: new Date() },
        });
      },
    );
  },
);
