import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Real Billing HTTP, Subscription HTTP, both runtime-role PostgreSQL databases,
// the production BillingFundingAuthority, and the compiled worker process.
// Identity/Pricing are explicit local HTTP fixtures. Provider statement evidence
// is synthetic test evidence, entered and approved through Billing's real APIs.
// No live provider transfer, broker delivery, or deployed runtime is claimed.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const owner = (name) => createRequire(path.join(ROOT, 'services', name, 'package.json'));
const load = (name, file) => owner(name)(path.join(ROOT, 'services', name, 'dist-tests', file));
const billingUrl = process.env.BILLING_TEST_DATABASE_URL;
const subscriptionUrl = process.env.SUBSCRIPTION_TEST_DATABASE_URL;
if (!billingUrl || !subscriptionUrl) throw new Error('FUNDING_OWNER_DATABASES_REQUIRED');
const { Client } = owner('billing')('pg');
const { PrismaService: BillingPrisma } = load(
  'billing',
  'src/infrastructure/persistence/prisma.service.js',
);
const { PrismaBillingRepository } = load(
  'billing',
  'src/infrastructure/persistence/prisma-billing.repository.js',
);
const { PrismaService: SubscriptionPrisma } = load(
  'subscription',
  'src/infrastructure/persistence/prisma.service.js',
);
const { PrismaSubscriptionRepository } = load(
  'subscription',
  'src/infrastructure/persistence/prisma-subscription.repository.js',
);
const { BillingFundingAuthority } = load(
  'subscription',
  'src/infrastructure/billing/billing-funding.authority.js',
);
const { Money } = load('subscription', 'src/domain/index.js');
const {
  startBillingHttp,
  SESSIONS,
  TOKENS: BILLING_TOKENS,
} = load('billing', 'test/support/billing-http-harness.js');
const { startIdentityStub, startPricingStub } = load('billing', 'test/support/upstream-stubs.js');
const { acceptanceProviders, approvedStatement } = load(
  'billing',
  'test/support/provider-flows.js',
);
const { startSubscriptionHttp, TOKENS } = load(
  'subscription',
  'test/support/subscription-http-harness.js',
);
const { CUSTOMER_SUBJECT, FixedClock, termsFixture } = load(
  'subscription',
  'test/support/subscription-fixtures.js',
);
const key = () => `funding-http-${randomUUID()}`;
const amount = { currency: 'SYP', amountMinor: '4500000', scale: 2 };

async function until(probe, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await delay(50);
  }
  throw new Error(`TIMED_OUT: ${label}`);
}

test(
  'real owner HTTP binds durable funding, fences refunds, and recovers a lost release reply across worker restart',
  { timeout: 60_000 },
  async (t) => {
    const cleanups = [];
    t.after(async () => {
      for (const close of cleanups.reverse()) await close();
    });
    const clock = new FixedClock(new Date(Math.floor(Date.now() / 1000) * 1000));
    const billingDb = new BillingPrisma(billingUrl);
    const subscriptionDb = new SubscriptionPrisma(subscriptionUrl);
    cleanups.push(
      () => billingDb.onModuleDestroy(),
      () => subscriptionDb.onModuleDestroy(),
    );
    const billingSql = new Client({ connectionString: billingUrl.replace(/\?.*$/, '') });
    const subscriptionSql = new Client({ connectionString: subscriptionUrl.replace(/\?.*$/, '') });
    await billingSql.connect();
    await subscriptionSql.connect();
    cleanups.push(
      () => billingSql.end(),
      () => subscriptionSql.end(),
    );
    assert.equal(
      (await billingSql.query('SELECT current_user')).rows[0].current_user,
      'cw_billing_app',
    );
    assert.equal(
      (await subscriptionSql.query('SELECT current_user')).rows[0].current_user,
      'cw_subscription_app',
    );
    const identity = await startIdentityStub({
      ...SESSIONS,
      customer: { ...SESSIONS.customer, subject: CUSTOMER_SUBJECT },
    });
    const pricing = await startPricingStub();
    cleanups.push(
      () => identity.close(),
      () => pricing.close(),
    );
    const credential = `acceptance-subscription-${randomUUID()}`;
    const billing = await startBillingHttp({
      repository: new PrismaBillingRepository(billingDb),
      clock,
      identity,
      pricing,
      providers: acceptanceProviders(),
      fundingClients: JSON.stringify([
        {
          id: 'subscription',
          tokenSha256: createHash('sha256').update(credential).digest('hex'),
          scopes: ['billing.subscription-funding.claim', 'billing.subscription-funding.release'],
        },
      ]),
    });
    cleanups.push(() => billing.close());

    // Transparent test proxy forwards to the real owner. It drops one response
    // only AFTER Billing has committed release, reproducing an unknown outcome.
    const calls = [];
    let releasePath;
    let dropReply = true;
    let dropped = false;
    const proxy = createServer(async (req, res) => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        calls.push({ path: req.url, headers: req.headers, body: JSON.parse(body.toString()) });
        const headers = { ...req.headers };
        delete headers.host;
        delete headers.connection;
        const upstream = await fetch(billing.url + req.url, { method: req.method, headers, body });
        const text = await upstream.text();
        if (req.url === releasePath && dropReply && upstream.status === 200) {
          dropReply = false;
          dropped = true;
          res.destroy();
          return;
        }
        res.writeHead(upstream.status, { 'content-type': 'application/json' }).end(text);
      } catch {
        res.writeHead(503).end('{}');
      }
    });
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${proxy.address().port}`;
    cleanups.push(async () => {
      proxy.closeAllConnections();
      await new Promise((resolve) => proxy.close(resolve));
    });
    const funding = new BillingFundingAuthority({
      origin: new URL(origin),
      clientId: 'subscription',
      token: credential,
      timeoutMs: 1000,
    });
    const subscription = await startSubscriptionHttp({
      repository: new PrismaSubscriptionRepository(subscriptionDb),
      clock,
      funding,
    });
    cleanups.push(() => subscription.close());
    const billingCall = (method, suffix, options) =>
      billing.request(method, `/internal/v1/billing${suffix}`, options);
    const subscriptionCall = (suffix, body, token = TOKENS.admin) =>
      subscription.request('POST', `/internal/v1/subscription${suffix}`, {
        token,
        key: key(),
        body,
      });

    const quoteId = randomUUID();
    pricing.quotes.set(quoteId, {
      ownerToken: 'customer',
      beneficiary: { kind: 'account', subjectId: CUSTOMER_SUBJECT },
      status: 'USABLE',
      currency: 'SYP',
      totalMinor: amount.amountMinor,
    });
    const obligation = await billingCall('POST', '/obligations', {
      token: BILLING_TOKENS.customer,
      key: key(),
      body: { quoteId },
    });
    assert.equal(obligation.status, 201, JSON.stringify(obligation.body));
    const obligationId = obligation.body.obligationId;
    const intent = await billingCall('POST', `/obligations/${obligationId}/payment-intents`, {
      token: BILLING_TOKENS.customer,
      key: key(),
      body: { expectedRevision: obligation.body.revision, method: 'SHAM_CASH' },
    });
    assert.equal(intent.status, 201, JSON.stringify(intent.body));
    const reference = `FUND${randomUUID().replaceAll('-', '')}`;
    const attempt = await billingCall('POST', `/obligations/${obligationId}/payment-attempts`, {
      token: BILLING_TOKENS.customer,
      key: key(),
      body: { expectedRevision: 2, providerReference: reference },
    });
    assert.equal(attempt.status, 202, JSON.stringify(attempt.body));
    const credit = await approvedStatement(billing, {
      provider: 'SHAM_CASH',
      reference,
      amount,
      occurredAt: clock.now(),
    });
    assert.equal(credit.status, 'ALLOCATED');
    const paid = await billingCall('GET', `/obligations/${obligationId}`, {
      token: BILLING_TOKENS.customer,
    });
    assert.equal(paid.body.status, 'SETTLED');
    assert.equal(paid.body.financialStatus, 'PAID');

    const planCode = `funding-http-${randomUUID().slice(0, 8)}`;
    const plan = await subscriptionCall(`/plans/${planCode}/revisions`, {
      expectedRevision: 0,
      effectiveFrom: null,
      terms: termsFixture(),
    });
    assert.equal(plan.status, 201, JSON.stringify(plan.body));
    const pending = await subscriptionCall('/subscriptions', { planCode }, TOKENS.customer);
    assert.equal(pending.status, 201, JSON.stringify(pending.body));
    const subscriptionId = pending.body.subscriptionId;
    releasePath = `/internal/v1/billing/subscription-funding/subscriptions/${subscriptionId}/release`;
    const activated = await subscriptionCall(`/subscriptions/${subscriptionId}/activate`, {
      expectedVersion: 1,
      paymentReference: obligationId,
    });
    assert.equal(activated.status, 200, JSON.stringify(activated.body));
    const claimInput = {
      obligationId,
      subscriptionId,
      periodNo: 1,
      customerSubject: CUSTOMER_SUBJECT,
      amount: Money.parse(amount),
      correlationId: randomUUID(),
    };
    assert.equal(
      await funding.claim(claimInput),
      'CLAIMED',
      'real client replay keeps the same durable funding',
    );
    const claims = calls.filter((call) => call.path.endsWith('/claims'));
    assert.equal(claims.length, 2);
    for (const claim of claims) {
      assert.equal(claim.headers['idempotency-key'], `subscription-claim-${subscriptionId}-1`);
      assert.equal(claim.headers['x-service-client'], 'subscription');
      assert.equal(claim.headers.authorization, undefined);
      assert.equal(claim.headers.cookie, undefined);
    }
    const firstClaim = claims[0];
    const workloadHeaders = { 'x-service-client': 'subscription', 'x-service-token': credential };
    const missingKey = await billing.request('POST', firstClaim.path, {
      headers: workloadHeaders,
      body: firstClaim.body,
    });
    assert.equal(missingKey.status, 400);
    const mixedCaller = await billing.request('POST', firstClaim.path, {
      headers: workloadHeaders,
      token: BILLING_TOKENS.customer,
      key: key(),
      body: firstClaim.body,
    });
    assert.equal(mixedCaller.status, 403);
    const changed = await billing.request('POST', firstClaim.path, {
      headers: workloadHeaders,
      key: firstClaim.headers['idempotency-key'],
      body: { ...firstClaim.body, periodNo: 2 },
    });
    assert.equal(changed.status, 409);
    assert.equal(
      (
        await billingSql.query(
          'SELECT count(*)::int AS n FROM app.subscription_funding_claim WHERE subscription_id=$1',
          [subscriptionId],
        )
      ).rows[0].n,
      1,
    );
    const refundBody = { expectedRevision: paid.body.revision, amount, reason: 'SERVICE_QUALITY' };
    const blocked = await billingCall('POST', `/obligations/${obligationId}/refunds`, {
      token: BILLING_TOKENS.refunder,
      key: key(),
      body: refundBody,
    });
    assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
    const cancelled = await subscriptionCall(`/subscriptions/${subscriptionId}/cancel`, {
      expectedVersion: 2,
      reason: 'CUSTOMER_REQUEST',
    });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));

    const inventory = JSON.parse(
      await readFile(path.join(ROOT, 'infra/runtime-processes.json'), 'utf8'),
    );
    assert.equal(inventory.state, 'desired-not-deployed');
    const processSpec = inventory.processes.find(
      (entry) => entry.id === 'subscription-funding-recovery',
    );
    assert.equal(processSpec.ownerImage, 'subscription/runtime');
    assert.deepEqual(processSpec.command, ['node', 'dist/workers/funding.main.js']);
    assert.deepEqual(processSpec.ingress, { public: false, private: false });
    let worker;
    let workerOutput = '';
    const stop = async () => {
      if (!worker) return;
      const current = worker;
      worker = undefined;
      const exited = once(current, 'exit');
      current.kill('SIGTERM');
      const outcome = await Promise.race([exited, delay(5000).then(() => null)]);
      if (!outcome) current.kill('SIGKILL');
      assert.deepEqual(outcome, [0, null], 'worker drains on SIGTERM');
    };
    cleanups.push(stop);
    const start = () => {
      // Deliberately pass only the worker's own runtime DB and workload secret.
      // No Billing DB, migration credential, provider token or customer session.
      worker = spawn(process.execPath, processSpec.command.slice(1), {
        cwd: path.join(ROOT, processSpec.repositoryWorkingDirectory),
        env: {
          PATH: process.env.PATH,
          NODE_ENV: 'test',
          LOG_LEVEL: 'error',
          OTEL_SDK_DISABLED: 'true',
          DATABASE_URL: subscriptionUrl,
          SUBSCRIPTION_BILLING_ORIGIN: origin,
          SUBSCRIPTION_BILLING_CLIENT_ID: 'subscription',
          SUBSCRIPTION_BILLING_SERVICE_TOKEN: credential,
          SUBSCRIPTION_BILLING_TIMEOUT_MS: '1000',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      for (const stream of [worker.stdout, worker.stderr])
        stream.on('data', (chunk) => {
          workerOutput += chunk.toString();
        });
    };
    const queue = async () =>
      (
        await subscriptionSql.query(
          'SELECT attempts,released_at,locked_by FROM app.subscription_funding_release WHERE subscription_id=$1',
          [subscriptionId],
        )
      ).rows[0];
    start();
    await until(
      async () => dropped && (await queue())?.locked_by === null,
      'lost reply recorded for retry',
    );
    assert.equal(
      (await queue()).released_at,
      null,
      'unknown outcome does not clear the local recovery record',
    );
    assert.ok(
      (
        await billingSql.query(
          'SELECT released_at FROM app.subscription_funding_namespace WHERE subscription_id=$1',
          [subscriptionId],
        )
      ).rows[0].released_at,
      'Billing committed before its reply was lost',
    );
    await stop();
    start();
    await until(
      async () => (await queue())?.released_at,
      'restarted worker reconciles the owner outcome',
    );
    await stop();
    assert.ok((await queue()).attempts >= 2);
    const releases = calls.filter((call) => call.path === releasePath);
    assert.equal(releases.length, 2);
    for (const release of releases) {
      assert.equal(release.headers['idempotency-key'], `subscription-release-${subscriptionId}`);
      assert.equal(release.headers.authorization, undefined);
      assert.deepEqual(release.body, {
        beneficiary: { kind: 'account', subjectId: CUSTOMER_SUBJECT },
      });
    }
    assert.equal(
      (
        await billingSql.query(
          "SELECT count(*)::int AS n FROM app.subscription_funding_command WHERE operation='RELEASE' AND idempotency_key=$1",
          [`subscription-release-${subscriptionId}`],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      await funding.claim({ ...claimInput, correlationId: randomUUID() }),
      'NOT_VERIFIED',
      'released namespace permanently refuses late grant replay',
    );
    const refund = await billingCall('POST', `/obligations/${obligationId}/refunds`, {
      token: BILLING_TOKENS.refunder,
      key: key(),
      body: refundBody,
    });
    assert.equal(refund.status, 201, JSON.stringify(refund.body));
    for (const secret of [credential, billingUrl, subscriptionUrl, BILLING_TOKENS.customer])
      assert.equal(workerOutput.includes(secret), false, 'worker logs exclude credentials');
  },
);
