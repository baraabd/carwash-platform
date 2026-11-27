/**
 * Real PostgreSQL/RabbitMQ and six COMPILED production worker entrypoints.
 * Real Workforce HTTP facts and real Dispatch HTTP execution projection.
 * Pricing/Billing snapshot ports and Media evidence are declared fixtures;
 * this proves process wiring/restarts/fences, not S11 hosted end-to-end acceptance.
 * Reporting and Communications consume the real native owner publications.
 * Requires lane-C plus Reporting/Communications owner DBs, and built services.
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
const { serviceTelemetry } = require(path.join(ROOT, 'packages/service-kit/dist/index.js'));
const { PrismaService: ReportingPrisma } = serviceDist('reporting', 'prisma.service.js');
const { PrismaService: CommunicationsPrisma } = serviceDist('communications', 'prisma.service.js');
const intentionalCrashes = new WeakSet();
const gracefulStops = new WeakSet();

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
  if (!proc) return;
  if (force) {
    assert.equal(proc.child.exitCode, null, 'crash seam requires a running worker');
    assert.equal(proc.child.signalCode, null, 'crash seam requires an unsignalled worker');
    intentionalCrashes.add(proc);
    await proc.kill();
    return;
  }
  if (intentionalCrashes.has(proc) || gracefulStops.has(proc)) return;
  if (proc.child.exitCode !== null || proc.child.signalCode !== null) {
    assert.fail(
      `worker exited before requested shutdown (${proc.child.exitCode ?? proc.child.signalCode}): ${proc.stderr().slice(-500)}`,
    );
  }
  proc.child.kill('SIGTERM');
  const timer = setTimeout(() => proc.child.kill('SIGKILL'), 20_000);
  const exit = await proc.exited;
  clearTimeout(timer);
  assert.equal(exit.code, 0, `worker graceful shutdown: ${proc.stderr().slice(-500)}`);
  gracefulStops.add(proc);
}

test(
  'six production workers: hold → durable assignment fallback → work completion → Booking, Reporting and Communications effects',
  { timeout: 180_000 },
  async (t) => {
    const processes = [];
    const databases = [];
    let connection, channel;
    // Register before opening any resource: setup failures must not leak pools or children.
    t.after(
      async () => {
        const shutdowns = await Promise.allSettled(
          processes.reverse().map(async (process) => {
            try {
              await stop(process);
            } catch (error) {
              await process.kill();
              throw error;
            }
          }),
        );
        await channel?.close().catch(() => {});
        await connection?.close().catch(() => {});
        const disconnected = await Promise.allSettled(
          databases.map((db) => db.client.$disconnect()),
        );
        const telemetry = await Promise.allSettled(
          ['scheduling', 'dispatch', 'workforce', 'booking', 'reporting', 'communications'].map(
            (owner) => serviceTelemetry(owner).shutdown(),
          ),
        );
        const failed = [...shutdowns, ...disconnected, ...telemetry].filter(
          (result) => result.status === 'rejected',
        );
        if (failed.length)
          throw new AggregateError(
            failed.map((result) => result.reason),
            'Worker shutdown failed',
          );
      },
      { timeout: 30_000 },
    );
    const context = await readContext();
    const S = support('scheduling'),
      D = support('dispatch'),
      W = support('workforce');
    const scheduling = S.replica(clock),
      dispatch = D.replica(clock),
      workforce = W.replica(clock);
    databases.push(scheduling.prisma, dispatch.prisma, workforce.prisma);
    const bookingPrisma = new BookingPrisma(context.databases.booking.appUrl);
    databases.push(bookingPrisma);
    const reporting = new ReportingPrisma(context.databases.reporting.appUrl);
    databases.push(reporting);
    const communications = new CommunicationsPrisma(context.databases.communications.appUrl);
    databases.push(communications);
    const bookingStore = new PrismaBookingStore(bookingPrisma, { sagaLeaseMs: 30_000 });
    connection = await amqplib().connect(context.brokerUrl);
    channel = await connection.createConfirmChannel();
    try {
      // Infra identity bootstraps producer exchanges. Workers themselves declare only owned topology.
      for (const owner of ['booking', 'dispatch', 'scheduling', 'workforce']) {
        await channel.assertExchange(`${owner}.events`, 'topic', { durable: true });
      }
      await channel.assertExchange('washgo.billing.events', 'topic', { durable: true });
      await messaging().assertTopology(
        channel,
        serviceDist('booking', 'workers/runtime.js').executionTopology,
      );
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
        const entry =
          name === 'reporting'
            ? 'inbox/operations-consumer.runner.js'
            : name === 'communications'
              ? 'inbox/event-notifications-consumer.runner.js'
              : 'workers/runtime.main.js';
        const p = startProcess(path.join(ROOT, 'services', name, 'dist', entry), workerEnv(name));
        processes.push(p);
        return p;
      };
      let reportingWorker = startWorker('reporting');
      let communicationsWorker = startWorker('communications');
      await Promise.all(
        [reportingWorker, communicationsWorker].map((p) =>
          p.waitFor((line) => line.event === 'consumer_started'),
        ),
      );
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
          // checkQueue closes a channel when startup has not declared the queue yet.
          // Consume its expected error event as well as handling the rejected RPC.
          probe.on('error', () => {});
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
      const intent = await eventually(
        () => communications.client.notification.findFirst({ where: { subjectRef: booking.id } }),
        (row) => row?.state === 'QUEUED',
        'native Booking publication persisted one Communications intent',
      );
      assert.equal(intent.recipientNamespace, 'IDENTITY_ACCOUNT');
      assert.equal(intent.recipientRef, beneficiary.subjectId);
      assert.equal(intent.attemptCount, 0, 'no provider delivery is claimed by this suite');
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
      const projection = await eventually(
        () =>
          reporting.client.opsOwnerObservation.findUnique({
            where: {
              eventType_aggregateId: {
                eventType: 'booking.lifecycle-progressed.v1',
                aggregateId: booking.id,
              },
            },
          }),
        (row) => row?.state.status === 'COMPLETED',
        'native Booking completion applied by Reporting consumer',
      );
      assert.equal(projection.version, completed.booking.version);
      const projectedBooking = await reporting.client.opsBooking.findUnique({
        where: { bookingId: booking.id },
      });
      assert.equal(projectedBooking.customerRef, beneficiary.subjectId);
      assert.equal(projectedBooking.slotHoldId, hold.holdId);
      const projectedAssignment = await eventually(
        () => reporting.client.opsAssignment.findUnique({ where: { assignmentId: assignment.id } }),
        (row) => row?.status === 'ASSIGNED',
        'Dispatch assignment applied by Reporting consumer',
      );
      assert.equal(projectedAssignment.resourceId, nextOffer.resourceId);
      for (const person of technicians)
        await eventually(
          () =>
            reporting.client.opsResourceEligibility.findUnique({
              where: { resourceId: person.operatorId },
            }),
          Boolean,
          'Workforce eligibility applied by Reporting consumer',
        );
      await eventually(
        () =>
          reporting.client.opsOwnerObservation.count({
            where: { eventType: 'workforce.shift-updated.v1' },
          }),
        (n) => n >= 2,
        'Workforce shifts applied by Reporting consumer',
      );
      await eventually(
        () =>
          reporting.client.opsOwnerObservation.findMany({
            where: { eventType: 'dispatch.cash-declared.v1' },
          }),
        (rows) =>
          rows.some(
            (row) =>
              row.state.bookingId === booking.id && row.state.outcome === 'CASH_NOT_COLLECTED',
          ),
        'Dispatch declaration persisted without inventing Billing payment',
      );
      assert.equal(await reporting.client.opsObligation.count(), 0);

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
      const [created] = await bookingPrisma.client.$queryRawUnsafe(
        `SELECT payload FROM app.outbox_message WHERE event_type='booking.created.v1'
         AND payload::jsonb#>>'{aggregate,id}'=$1`,
        booking.id,
      );
      const createdEvent = JSON.parse(created.payload);
      await Promise.all([stop(reportingWorker, true), stop(communicationsWorker, true)]);
      channel.publish('booking.events', createdEvent.eventType, Buffer.from(created.payload), {
        persistent: true,
        messageId: createdEvent.eventId,
      });
      await channel.waitForConfirms();
      reportingWorker = startWorker('reporting');
      communicationsWorker = startWorker('communications');
      await Promise.all(
        [reportingWorker, communicationsWorker].map((p) =>
          p.waitFor(
            (line) =>
              line.event === 'consumer_committed' &&
              line.eventId === createdEvent.eventId &&
              line.outcome === 'DUPLICATE',
          ),
        ),
      );
      assert.equal(
        await communications.client.notification.count({ where: { subjectRef: booking.id } }),
        1,
      );
      assert.equal(
        (await reporting.client.opsBooking.findUnique({ where: { bookingId: booking.id } }))
          .confirmationVersion,
        projectedBooking.confirmationVersion,
      );
      for (const queue of ['reporting.operations.dlq', 'communications.event-notifications.dlq'])
        assert.equal((await channel.checkQueue(queue)).messageCount, 0, `${queue} remains empty`);
    } catch (error) {
      t.diagnostic(error instanceof Error ? error.stack : String(error));
      for (const proc of processes) if (proc.stderr()) t.diagnostic(proc.stderr().slice(-1_000));
      throw error;
    }
  },
);
