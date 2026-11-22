/** Acceptance-only process death. No crash switches are present in shipped workers. */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const service = process.argv[2];
if (!['billing', 'wallet'].includes(service)) throw new Error('TEST_OWNER_REQUIRED');
const require = createRequire(path.join(root, `services/${service}/package.json`));
const load = (file) => require(path.join(root, `services/${service}/dist`, file));
const {
  BrokerConnection,
  ConfirmingPublisher,
  OutboxRelay,
  assertTopology,
} = require('@carwash/platform-messaging');
const { createLogger } = require('@carwash/service-kit');
const { PrismaService } = load('infrastructure/persistence/prisma.service.js');
const prisma = new PrismaService(process.env.DATABASE_URL);
const logger = createLogger({ service, level: 'error' });
const connection = await BrokerConnection.open({
  url: process.env.BROKER_URL,
  connectionName: `${service}-acceptance-crash`,
  logger,
});
const emit = (event, fields = {}) =>
  process.stdout.write(JSON.stringify({ event, ...fields }) + '\n');
const crash = async (code) => {
  await new Promise((resolve) => process.stdout.write('', resolve));
  process.exit(code);
};
if (service === 'billing') {
  const { PrismaCustodyOutboxStore } = load('outbox/prisma-outbox.store.js');
  const { billingCustodyProducerTopology, validateCustodyOutbox } = load(
    'outbox/custody-events.js',
  );
  await assertTopology(connection.channel, billingCustodyProducerTopology);
  await new OutboxRelay({
    workerId: 'acceptance-crashed-billing',
    store: new PrismaCustodyOutboxStore(prisma),
    publisher: new ConfirmingPublisher(connection.channel, logger),
    validate: validateCustodyOutbox,
    leaseMs: 200,
    batchSize: 20,
    onLeased: async (rows) => {
      if (rows.length) {
        emit('relay_crash_after_lease');
        await crash(8);
      }
    },
  }).runOnce();
  throw new Error('CRASH_EXPECTED_AFTER_LEASE');
} else {
  const { CustodyBrokerConsumer } = load('transport/messaging/custody-broker.consumer.js');
  const { walletCustodyTopology } = load('transport/messaging/custody-topology.js');
  const { CustodyProjector } = load('application/index.js');
  const { PrismaWalletRepository } = load('infrastructure/persistence/prisma-wallet.repository.js');
  const { RandomIds, SystemClock } = load('infrastructure/system/system.adapters.js');
  await assertTopology(connection.channel, walletCustodyTopology);
  await new CustodyBrokerConsumer({
    channel: connection.channel,
    logger,
    projector: new CustodyProjector({
      repository: new PrismaWalletRepository(prisma),
      clock: new SystemClock(),
      ids: new RandomIds(),
    }),
    onBeforeAck: async (eventId, outcome) => {
      emit('consumer_committed', { eventId, outcome: outcome.outcome });
      await crash(9);
    },
  }).start();
  emit('consumer_started');
}
