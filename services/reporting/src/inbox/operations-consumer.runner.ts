import { OperationsProjector, parseOperationsEvent } from '../application/operations.service';
import { PrismaOperationsWriter } from '../infrastructure/persistence/prisma-operations.store';
import { sha256Hex } from '../infrastructure/persistence/prisma-projection.store';
import {
  OPERATIONS_QUEUE,
  operationsTopology,
} from '../infrastructure/messaging/operations-topology';
import { startProjectionWorker } from './projection-worker';

/**
 * Standalone worker for the operations projection (booking confirmations,
 * scheduling holds, workforce eligibility). Transaction, ACK and dead-letter
 * semantics are those of `runProjectionWorker`.
 */
const projector = new OperationsProjector(sha256Hex, { now: () => new Date() });

startProjectionWorker({
  component: 'operations-consumer',
  eventsComponent: 'operations-worker-events',
  connectionName: 'reporting-operations-consumer',
  queue: OPERATIONS_QUEUE,
  topology: () => operationsTopology(),
  parse: parseOperationsEvent,
  apply: async (event, tx) => {
    await projector.apply(new PrismaOperationsWriter(tx), event.fact);
  },
  integrityEvent: 'operations_integrity_conflict',
});
