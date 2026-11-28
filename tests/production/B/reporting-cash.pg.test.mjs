/**
 * Reporting-only PostgreSQL regression with explicit published event fixtures.
 * This proves constraints, exact amounts and convergence, not a Billing payment
 * or broker delivery. The separate reporting-broker suite supplies that journey.
 * All valid fixture effects roll back, leaving no artificial financial state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(path.join(root, 'services/reporting/package.json'));
const load = (file) => require(path.join(root, 'services/reporting/dist', file));
const database = process.env.REPORTING_TEST_DATABASE_URL;
if (!database) throw new Error('REPORTING_TEST_DATABASE_URL_REQUIRED');
const { PrismaService } = load('infrastructure/persistence/prisma.service.js');
const { PrismaOperationsWriter, PrismaOperationsReader } = load(
  'infrastructure/persistence/prisma-operations.store.js',
);
const { parseOperationsEvent, OperationsProjector, OperationsQueries } = load(
  'application/operations.service.js',
);
const { sha256Hex } = load('infrastructure/persistence/prisma-projection.store.js');
const prisma = new PrismaService(database);
test.after(() => prisma.onModuleDestroy());

test('Reporting PostgreSQL: published Billing states converge exactly; CASH_COLLECTED is distinct and database-enforced', async () => {
  const at = new Date();
  const obligationId = randomUUID();
  const amount = { currency: 'SYP', amountMinor: '123456789012345678', scale: 2 };
  const base = {
    envelopeVersion: 2,
    producer: 'billing',
    occurredAt: at.toISOString(),
    correlationId: randomUUID(),
    causationId: null,
    traceparent: null,
    actor: { kind: 'system', id: null },
  };
  const created = {
    ...base,
    eventId: randomUUID(),
    eventType: 'billing.obligation-created.v1',
    aggregate: { type: 'billing-obligation', id: obligationId, version: 1 },
    data: { quoteId: randomUUID(), amount, financialStatus: 'UNPAID' },
  };
  const collected = {
    ...base,
    eventId: randomUUID(),
    eventType: 'billing.obligation-status-changed.v1',
    aggregate: { type: 'billing-obligation', id: obligationId, version: 3 },
    data: {
      previousFinancialStatus: 'AWAITING_CASH',
      financialStatus: 'CASH_COLLECTED',
      verified: amount,
      outstanding: { ...amount, amountMinor: '0' },
    },
  };
  const clock = { now: () => at };
  const projector = new OperationsProjector(sha256Hex, clock);
  const rollback = new Error('DISCARD_EXPLICIT_TEST_FIXTURES');
  await assert.rejects(
    () =>
      prisma.client.$transaction(
        async (tx) => {
          const writer = new PrismaOperationsWriter(tx);
          const queries = new OperationsQueries(new PrismaOperationsReader(tx), clock);
          const apply = (event) => projector.apply(writer, parseOperationsEvent(event).fact);
          await apply(created);
          assert.equal(
            (await tx.opsObligation.findUnique({ where: { obligationId } })).outstandingMinor,
            123456789012345678n,
          );
          await apply(collected);
          await apply({ ...created, eventId: randomUUID() });
          await apply({ ...collected, eventId: randomUUID() });
          const row = await tx.opsObligation.findUnique({ where: { obligationId } });
          assert.equal(row.version, 3);
          assert.equal(row.cashState, 'CASH_COLLECTED');
          assert.equal(row.outstandingMinor, 0n);
          const cash = await queries.cashKpis();
          assert.ok(cash.states.find((state) => state.cashState === 'CASH_COLLECTED').count >= 1);
          assert.deepEqual(cash.incompleteSources, []);
          const conflict = {
            ...collected,
            eventId: randomUUID(),
            data: { ...collected.data, financialStatus: 'PAID' },
          };
          await assert.rejects(
            () => apply(conflict),
            (error) => error.code === 'FACT_VERSION_CONFLICT',
          );
          assert.equal(
            (await tx.opsObligation.findUnique({ where: { obligationId } })).cashState,
            'CASH_COLLECTED',
          );
          throw rollback;
        },
        { timeout: 15_000 },
      ),
    (error) => error === rollback,
  );
  assert.equal(await prisma.client.opsObligation.findUnique({ where: { obligationId } }), null);
  const invalid = {
    obligationId,
    version: 1,
    cashState: 'CASH_COLLECTED',
    outstandingMinor: 1n,
    currency: 'SYP',
    scale: 2,
    stateSince: at,
    fingerprint: '0'.repeat(64),
    sourceEventId: randomUUID(),
    occurredAt: at,
  };
  await assert.rejects(
    () => prisma.client.opsObligation.create({ data: invalid }),
    /ops_obligation_closed_settled/,
  );
  await assert.rejects(
    () =>
      prisma.client.opsObligation.create({
        data: { ...invalid, cashState: 'SETTLED', outstandingMinor: 0n },
      }),
    /ops_obligation_state_known/,
  );
});
