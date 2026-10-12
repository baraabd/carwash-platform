import { setTimeout as delay } from 'node:timers/promises';

const clientErrors = new WeakMap();

// node-postgres emits connection errors independently of query rejections.
// Retain those errors instead of letting an injected SIGKILL terminate Node.
export function observePostgresClient(client) {
  client.on('error', (error) => {
    if (!clientErrors.has(client)) clientErrors.set(client, error);
  });
  return client;
}

export function assertPostgresClientHealthy(client) {
  const error = clientErrors.get(client);
  if (error) throw error;
}

function disconnected(error) {
  return (
    ['57P01', '57P02', '08000', '08003', '08006', 'ECONNRESET', 'EPIPE'].includes(error.code) ||
    /connection (?:terminated|closed)|connection error and is not queryable/i.test(error.message)
  );
}

export function startAcknowledgedWrites(client, { now = Date.now, pause = delay } = {}) {
  const acknowledgements = [];
  let stopping = false;
  let disasterStarted = false;
  let unexpectedError;
  const recordError = (error) => {
    if (!disasterStarted || !disconnected(error)) unexpectedError ??= error;
    stopping = true;
  };
  client.on('error', recordError);
  const done = (async () => {
    let seq = 0;
    while (!stopping) {
      assertPostgresClientHealthy(client);
      seq += 1;
      try {
        await client.query('INSERT INTO ledger (seq) VALUES ($1)', [seq]);
        acknowledgements.push({ seq, at: now() });
      } catch (error) {
        recordError(error);
      }
      if (!stopping) await pause(10);
    }
  })().catch(recordError);
  return {
    acknowledgements,
    beginDisaster() {
      if (unexpectedError) throw unexpectedError;
      assertPostgresClientHealthy(client);
      disasterStarted = true;
    },
    async stop() {
      stopping = true;
      await done;
      client.off('error', recordError);
      if (unexpectedError) throw unexpectedError;
    },
  };
}
