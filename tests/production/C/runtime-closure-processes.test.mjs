/**
 * Real PostgreSQL/RabbitMQ and the four COMPILED production worker entrypoints.
 * Real Workforce HTTP facts and real Dispatch HTTP execution projection.
 * Pricing/Billing snapshot ports and Media evidence are declared fixtures;
 * this proves process wiring/restarts/fences, not S11 hosted end-to-end acceptance.
 * Requires the lane-C Docker stack and build:tests for all four owner services.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ROOT,
  require,
  serviceDist,
  readContext,
  amqplib,
  messaging,
  startProcess,
  freePort,
  waitHttp,
  digest,
} from './_support.mjs';

const support = (service) =>
  require(path.join(ROOT, 'services', service, 'dist-tests/test/integration/support.js'));
const fixtures = require(path.join(ROOT, 'services/booking/dist-tests/test/support/fixtures.js'));
const core = serviceDist('booking', 'domain/index.js');
const { BookingProcessManager } = serviceDist('booking', 'application/process-manager.js');
const { PrismaService: BookingPrisma } = serviceDist(
  'booking',
  'infrastructure/persistence/prisma.service.js',
);
const { PrismaBookingStore } = serviceDist(
  'booking',
  'infrastructure/persistence/prisma-booking.store.js',
);
const { DispatchService } = serviceDist('dispatch', 'application/dispatch.service.js');
const { WorkforceCapacityClient } = serviceDist(
  'dispatch',
  'infrastructure/workforce/workforce-capacity.client.js',
);
const { ServiceHttp } = serviceDist('dispatch', 'infrastructure/http/service-http.js');
const ids = { next: randomUUID };
const clock = { now: () => new Date() };

async function eventually(read, predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (predicate(value)) return value;
    await delay(50);
  }
  throw new Error(`Timed out: ${label}`);
}
async function stop(proc, force = false) {
  if (!proc || proc.child.exitCode !== null || proc.child.signalCode !== null) return;
  if (force) {
    await proc.kill();
    return;
  }
  proc.child.kill('SIGTERM');
  const timer = setTimeout(() => proc.child.kill('SIGKILL'), 20_000);
  const exit = await proc.exited;
  clearTimeout(timer);
  assert.equal(exit.code, 0, `worker graceful shutdown: ${proc.stderr().slice(-500)}`);
}

test(
  'production runtime: committed hold → durable automatic fallback after crash → genuine work completion → Booking projection',
  { timeout: 180_000 },
  async () => {
    const context = await readContext();
    const S = support('scheduling'),
      D = support('dispatch'),
      W = support('workforce');
    const scheduling = S.replica(clock),
      dispatch = D.replica(clock),
      workforce = W.replica(clock);
    const bookingPrisma = new BookingPrisma(context.databases.booking.appUrl);
    const bookingStore = new PrismaBookingStore(bookingPrisma, { sagaLeaseMs: 30_000 });
    const processes = [];
    const connection = await amqplib().connect(context.brokerUrl);
    const channel = await connection.createConfirmChannel();
    const observed = [];
    try {
      // Infra identity bootstraps producer exchanges. Workers themselves declare only owned topology.
      const spy = await channel.assertQueue('', { exclusive: true });
      for (const owner of ['booking', 'dispatch', 'scheduling', 'workforce']) {
        await channel.assertExchange(`${owner}.events`, 'topic', { durable: true });
        await channel.bindQueue(spy.queue, `${owner}.events`, '#');
      }
      await messaging().assertTopology(
        channel,
        serviceDist('booking', 'workers/runtime.js').executionTopology,
      );
      await channel.consume(spy.queue, (message) => {
        observed.push(JSON.parse(message.content));
        channel.ack(message);
      });
      const window = await S.defineWindow(scheduling.capacity, clock, 2);
      const technicians = [];
      for (let i = 0; i < 2; i++) {
        const person = await W.seedOperator(workforce, clock, {
          shifts: [{ zoneId: window.zoneId, startsAt: window.startsAt, endsAt: window.endsAt }],
        });
        await workforce.service.setAvailability(W.meta(W.technician(person.subject)), {
          status: 'AVAILABLE',
          expectedRevision: 0,
        });
        technicians.push(person);
      }
      const workforceToken = 'workforce-runtime-test-credential-'.padEnd(48, 'w');
      const dispatchToken = 'dispatch-runtime-test-credential-'.padEnd(48, 'd');
      const workforcePort = await freePort(),
        dispatchPort = await freePort();
      const workforceEnv = {
        DATABASE_URL: context.databases.workforce.appUrl,
        HOST: '127.0.0.1',
        PORT: String(workforcePort),
        WORKFORCE_SERVICE_CLIENTS: JSON.stringify([
          {
            id: 'dispatch',
            tokenSha256: digest(workforceToken),
            scopes: ['workforce.capacity.read'],
          },
        ]),
      };
      const wfApi = startProcess(path.join(ROOT, 'services/workforce/dist/main.js'), workforceEnv);
      processes.push(wfApi);
      await waitHttp(`http://127.0.0.1:${workforcePort}/health/live`, (s) => s === 200);
      const workforceUrl = `http://127.0.0.1:${workforcePort}`;
      const dispatchEnv = {
        DATABASE_URL: context.databases.dispatch.appUrl,
        HOST: '127.0.0.1',
        PORT: String(dispatchPort),
        DISPATCH_WORKFORCE_URL: workforceUrl,
        DISPATCH_WORKFORCE_CLIENT_ID: 'dispatch',
        DISPATCH_WORKFORCE_CLIENT_TOKEN: workforceToken,
        // No Media work is claimed by this URI. Evidence below uses the declared Media port fixture.
        DISPATCH_MEDIA_URL: workforceUrl,
        DISPATCH_MEDIA_CLIENT_ID: 'dispatch',
        DISPATCH_MEDIA_CLIENT_TOKEN: 'm'.repeat(48),
        DISPATCH_SERVICE_CLIENTS: JSON.stringify([
          {
            id: 'booking',
            tokenSha256: digest(dispatchToken),
            scopes: ['dispatch.assignment.read'],
          },
        ]),
      };
      const dApi = startProcess(path.join(ROOT, 'services/dispatch/dist/main.js'), dispatchEnv);
      processes.push(dApi);
      await waitHttp(`http://127.0.0.1:${dispatchPort}/health/live`, (s) => s === 200);
      const workerEnv = (name) => ({
        DATABASE_URL: context.databases[name].appUrl,
        BROKER_URL: context.brokerUrl,
        ...(name === 'dispatch' ? dispatchEnv : {}),
        ...(name === 'booking'
          ? {
              BOOKING_DISPATCH_URL: `http://127.0.0.1:${dispatchPort}`,
              BOOKING_DISPATCH_CLIENT_ID: 'booking',
              BOOKING_DISPATCH_CLIENT_TOKEN: dispatchToken,
            }
          : {}),
        LOG_LEVEL: 'info',
      });
      const startWorker = (name) => {
        const p = startProcess(
          path.join(ROOT, 'services', name, 'dist/workers/runtime.main.js'),
          workerEnv(name),
        );
        processes.push(p);
        return p;
      };
      let dWorker = startWorker('dispatch');
      let bWorker;
      startWorker('scheduling');
      startWorker('workforce');
      await Promise.all(
        processes
          .slice(-3)
          .map((p) =>
            p.waitFor(
              (line) =>
                line.message === 'runtime_worker_started' || line.msg === 'runtime_worker_started',
            ),
          ),
      );
      // A fresh check channel is used so a missing queue cannot close the observer channel.
      await eventually(
        async () => {
          const probe = await connection.createChannel();
          try {
            return await probe.checkQueue('dispatch.scheduling.hold-changed');
          } catch {
            return null;
          } finally {
            await probe.close().catch(() => {});
          }
        },
        (q) => q?.consumerCount > 0,
        'Dispatch production consumer attached',
      );

      const beneficiary = fixtures.principal();
      const who = {
        kind: 'USER',
        principalKind: 'account',
        subject: beneficiary.subjectId,
        permissions: ['bookings.create:self'],
      };
      const request = S.holdRequestFor(who, window, 60);
      const hold = (await scheduling.holds.createHold(S.meta(who), request, S.key())).body;
      const quote = {
        ...fixtures.quoteSnapshot(beneficiary, clock.now(), window.zoneId),
        quoteId: request.quoteRef.quoteId,
      };
      const booking = core.createBooking({
        id: randomUUID(),
        beneficiary,
        paymentMethod: 'CASH_ON_COMPLETION',
        contact: fixtures.CONTACT,
        vehicle: fixtures.vehicleSnapshot(clock.now()),
        address: fixtures.addressSnapshot(clock.now()),
        quote,
        requestedSlot: {
          holdId: hold.holdId,
          holdRevision: hold.revision,
          zoneId: hold.zoneId,
          startsAt: new Date(hold.startsAt),
          endsAt: new Date(hold.endsAt),
        },
        now: clock.now(),
      });
      const correlationId = randomUUID();
      const key = {
        principalKind: 'account',
        subject: beneficiary.subjectId,
        key: `runtime-${randomUUID()}`,
        fingerprint: 'a'.repeat(64),
      };
      const claim = await bookingStore.claimRequest(key, booking.id, clock.now(), 30_000);
      await bookingStore.insertBooking(
        booking,
        core.newSaga(booking.id, clock.now()),
        { key, fence: claim.fence },
        {
          action: 'booking.created',
          actor: { kind: 'SYSTEM', component: 'runtime-integration-fixture' },
          bookingId: booking.id,
          correlationId,
          details: {},
        },
      );
      let debts = 0;
      const manager = new BookingProcessManager({
        store: bookingStore,
        quotes: { validate: async () => ({ kind: 'VALID', total: quote.total }) },
        billing: {
          create: async () => {
            debts++;
            return { kind: 'CREATED', obligationId: randomUUID() };
          },
          voidForBooking: async () => ({ kind: 'VOIDED' }),
        },
        holds: {
          commit: async (input) => {
            const committed = (
              await scheduling.holds.commitHold(
                S.meta(S.BOOKING),
                input.holdId,
                { bookingId: input.bookingId, expectedRevision: input.expectedRevision },
                `runtime-commit-${booking.id}`,
              )
            ).body;
            return {
              kind: 'COMMITTED',
              slot: {
                holdId: committed.holdId,
                zoneId: committed.zoneId,
                startsAt: new Date(committed.startsAt),
                endsAt: new Date(committed.endsAt),
              },
            };
          },
        },
        clock,
        ids,
        random: { next: () => 0.5 },
        observer: { record: () => {} },
        leaseMs: 30_000,
        traceparent: () => null,
      });
      assert.equal(await manager.drive(booking.id, 'runtime-test-create', 5_000), 'DONE');
      assert.equal((await bookingStore.find(booking.id)).booking.status, 'CONFIRMED');
      assert.equal(debts, 1);
      bWorker = startWorker('booking');
      const assignment = await eventually(
        () => dispatch.store.findAssignmentByBooking(booking.id),
        (x) => x?.status === 'OFFERED',
        'automatic first offer',
      );
      const first = await dispatch.store.findCurrentOffer(assignment.id);
      assert.ok(
        technicians.some(
          (t) => t.subject === first.technicianSubject && t.operatorId === first.resourceId,
        ),
      );

      // A process crash must not forget who was offered already.
      await stop(dWorker, true);
      await dispatch.service.declineOffer(
        D.meta(D.technician(first.technicianSubject)),
        first.id,
        'UNAVAILABLE',
        null,
        D.key(),
      );
      dWorker = startWorker('dispatch');
      const nextOffer = await eventually(
        () => dispatch.store.findCurrentOffer(assignment.id),
        (o) => o?.status === 'OFFERED' && o.id !== first.id,
        'fallback after worker crash',
      );
      assert.notEqual(nextOffer.resourceId, first.resourceId);
      const [policy] = await dispatch.prisma.client.$queryRawUnsafe(
        'SELECT offered_count FROM app.automatic_assignment_policy WHERE assignment_id=$1::uuid',
        assignment.id,
      );
      assert.equal(policy.offered_count, 2);
      const liveService = new DispatchService(
        dispatch.store,
        dispatch.store,
        clock,
        ids,
        new WorkforceCapacityClient(
          new ServiceHttp({
            baseUrl: workforceUrl,
            credential: { clientId: 'dispatch', token: workforceToken },
            timeoutMs: 1500,
          }),
        ),
      );
      const tech = D.technician(nextOffer.technicianSubject);
      const accepted = (await liveService.acceptOffer(D.meta(tech), nextOffer.id, D.key())).value;
      let detail = await dispatch.tasks.getMyTask(D.meta(tech), accepted.task.id);
      const stage = async (action) => {
        detail = (
          await dispatch.tasks[action](D.meta(tech), detail.task.id, detail.task.version, D.key())
        ).value;
      };
      const attach = async (phase) => {
        detail = (
          await dispatch.tasks.attachEvidence(
            D.meta(tech),
            detail.task.id,
            phase,
            0,
            { expectedRevision: detail.task.version, mediaObjectId: D.media.add(tech.subject) },
            D.key(),
          )
        ).value;
      };
      await stage('depart');
      await stage('arrive');
      await attach('BEFORE');
      await stage('start');
      for (const item of detail.task.checklist)
        detail = (
          await dispatch.tasks.setCheck(
            D.meta(tech),
            detail.task.id,
            item.code,
            { expectedRevision: detail.task.version, checked: true },
            D.key(),
          )
        ).value;
      await stage('document');
      await attach('AFTER');
      await stage('finish');
      await eventually(
        () => bookingStore.find(booking.id),
        (r) => r.booking.status === 'IN_PROGRESS',
        'FINISHED is not COMPLETED',
      );
      detail = (
        await dispatch.tasks.close(
          D.meta(tech),
          detail.task.id,
          {
            expectedRevision: detail.task.version,
            collection: { outcome: 'CASH_NOT_COLLECTED', reason: 'Customer will settle later' },
          },
          D.key(),
        )
      ).value;
      assert.equal(detail.task.stage, 'CLOSED');
      const completed = await eventually(
        () => bookingStore.find(booking.id),
        (r) => r.booking.status === 'COMPLETED',
        'Booking completion from production consumer',
      );
      assert.equal(debts, 1, 'completion never creates a second financial obligation');
      assert.ok(observed.some((e) => e.eventType === 'workforce.eligibility-changed.v1'));
      assert.ok(
        observed.some((e) => e.eventType === 'workforce.shift-updated.v1' && e.schemaVersion === 1),
      );
      await eventually(
        async () =>
          observed.some(
            (e) =>
              e.eventType === 'booking.lifecycle-progressed.v1' &&
              e.aggregate.id === booking.id &&
              e.data.status === 'COMPLETED',
          ),
        Boolean,
        'Booking completion outbox relay',
      );

      // Redelivery across a real consumer process restart preserves the same booking revision.
      const [source] = await dispatch.prisma.client.$queryRawUnsafe(
        `SELECT payload FROM app.outbox_message
      WHERE event_type='dispatch.task-progressed.v1' AND payload::jsonb#>>'{data,taskId}'=$1
        AND payload::jsonb#>>'{data,stage}'='CLOSED'`,
        detail.task.id,
      );
      const event = JSON.parse(source.payload);
      await stop(bWorker, true);
      channel.publish('dispatch.events', event.eventType, Buffer.from(source.payload), {
        persistent: true,
        messageId: event.eventId,
      });
      await channel.waitForConfirms();
      bWorker = startWorker('booking');
      await eventually(
        () => channel.checkQueue('booking.dispatch.execution'),
        (q) => q.consumerCount > 0 && q.messageCount === 0,
        'redelivery drained by restarted consumer',
      );
      await stop(bWorker);
      const [receipt] = await bookingPrisma.client.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM app.inbox_message
      WHERE event_id=$1::uuid`,
        event.eventId,
      );
      assert.equal(receipt.n, 1, 'one inbox receipt across restart');
      assert.equal(
        (await bookingStore.find(booking.id)).booking.version,
        completed.booking.version,
      );
    } finally {
      for (const process of processes.reverse())
        await stop(process).catch(async () => {
          await process.kill();
        });
      await channel.close().catch(() => {});
      await connection.close().catch(() => {});
      await Promise.all([
        scheduling.prisma.client.$disconnect(),
        dispatch.prisma.client.$disconnect(),
        workforce.prisma.client.$disconnect(),
        bookingPrisma.client.$disconnect(),
      ]);
    }
  },
);
