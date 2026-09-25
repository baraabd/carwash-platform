import test from 'node:test';
import assert from 'node:assert/strict';
import { amqp, brokerUrl, brokerUrlAs, context, infraBrokerUrl, messaging } from './_support.mjs';

/**
 * Real-RabbitMQ authorisation proof.
 *
 * Structural validation inside an event payload proves nothing about who sent
 * it. Producer identity is established by the broker, so these tests exercise the
 * broker's own refusals.
 *
 * Each case opens its own connection: an ACL violation closes the channel (and
 * usually the connection), so sharing one would make later assertions test the
 * wrong thing.
 */

const { CATALOG_EVENTS_EXCHANGE, FOUNDATION_PROBE_ROUTING_KEY, subscriberQueueName } = messaging();

/**
 * Run an operation as a given identity and classify the outcome.
 * A refusal must be a genuine 403 ACCESS_REFUSED; a 404 or a connection error is
 * a different fault and must not be mistaken for an authorisation result.
 */
function isAccessRefused(error) {
  if (!error) return false;
  return error.code === 403 || /ACCESS_REFUSED/i.test(String(error.message ?? error));
}

async function attempt(url, operation) {
  const { connect } = amqp();
  let connection;
  try {
    connection = await connect(url);
  } catch (error) {
    return {
      outcome: 'connection-refused',
      code: error?.code ?? null,
      message: String(error?.message ?? error),
    };
  }

  // An ACL violation is reported as a CHANNEL-level error and then the channel
  // is closed. An operation whose own promise rejects therefore often sees only
  // "channel closed"; the 403 is on the channel's error event. Both are captured
  // so a refusal is classified by the broker's actual reason and a non-ACL
  // failure is never silently accepted as one.
  let asyncError;
  const remember = (error) => {
    if (asyncError === undefined && isAccessRefused(error)) asyncError = error;
  };
  connection.on('error', remember);

  try {
    const channel = await connection.createConfirmChannel();
    channel.on('error', remember);
    channel.on('close', () => {});
    await operation(channel);
    await channel.close().catch(() => {});
    if (asyncError) {
      return {
        outcome: 'refused',
        code: asyncError.code ?? null,
        message: String(asyncError.message),
      };
    }
    return { outcome: 'allowed', code: null, message: null };
  } catch (error) {
    // Give the channel error event a turn to arrive before classifying.
    await new Promise((resolve) => setImmediate(resolve));
    const reported = isAccessRefused(error) ? error : asyncError;
    if (reported) {
      return {
        outcome: 'refused',
        code: reported.code ?? null,
        message: String(reported.message ?? reported),
      };
    }
    return {
      outcome: 'error',
      code: error?.code ?? null,
      message: String(error?.message ?? error),
    };
  } finally {
    await connection.close().catch(() => {});
  }
}

function assertRefused(result, what) {
  assert.equal(
    result.outcome,
    'refused',
    `${what} was ${result.outcome} (code=${result.code} message=${result.message})`,
  );
}

function assertAllowed(result, what) {
  assert.equal(result.outcome, 'allowed', `${what} was ${result.outcome}: ${result.message}`);
}

/* ------------------------------ positive controls ------------------------------ */
/* Without these, every refusal below could simply mean "nothing works at all".   */

test('the infrastructure identity may declare the shared exchange', async () => {
  const result = await attempt(infraBrokerUrl(context), async (channel) => {
    await channel.assertExchange(CATALOG_EVENTS_EXCHANGE, 'topic', { durable: true });
  });
  assertAllowed(result, 'infra declaring the shared exchange');
});

test('the catalog producer may declare and publish to its own exchange', async () => {
  const result = await attempt(brokerUrl(context, 'catalog'), async (channel) => {
    await channel.assertExchange(CATALOG_EVENTS_EXCHANGE, 'topic', { durable: true });
    await new Promise((resolve, reject) => {
      channel.publish(
        CATALOG_EVENTS_EXCHANGE,
        FOUNDATION_PROBE_ROUTING_KEY,
        Buffer.from('{}'),
        { persistent: true },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  });
  assertAllowed(result, 'catalog publishing to catalog.events');
});

for (const service of ['communications', 'reporting']) {
  test(`the ${service} subscriber may consume its own queue`, async () => {
    const result = await attempt(brokerUrl(context, service), async (channel) => {
      const reply = await channel.consume(subscriberQueueName(service), () => {}, { noAck: false });
      await channel.cancel(reply.consumerTag);
    });
    assertAllowed(result, `${service} consuming its own queue`);
  });

  test(`the ${service} subscriber may bind its queue to the catalog exchange`, async () => {
    // Binding needs `read` on the source exchange and `write` on the queue, and
    // deliberately NOT `configure` on someone else's exchange.
    const result = await attempt(brokerUrl(context, service), async (channel) => {
      await channel.bindQueue(
        subscriberQueueName(service),
        CATALOG_EVENTS_EXCHANGE,
        FOUNDATION_PROBE_ROUTING_KEY,
      );
    });
    assertAllowed(result, `${service} binding to catalog.events`);
  });
}

/* ------------------------------ producer denials ------------------------------ */

test('the catalog producer cannot consume another service queue', async () => {
  const result = await attempt(brokerUrl(context, 'catalog'), async (channel) => {
    await channel.consume(subscriberQueueName('communications'), () => {}, { noAck: false });
  });
  assertRefused(result, 'catalog consuming the communications queue');
});

test('the catalog producer cannot read the reporting queue either', async () => {
  const result = await attempt(brokerUrl(context, 'catalog'), async (channel) => {
    await channel.checkQueue(subscriberQueueName('reporting'));
  });
  assertRefused(result, 'catalog checking the reporting queue');
});

test('the catalog producer cannot create a queue outside its namespace', async () => {
  const result = await attempt(brokerUrl(context, 'catalog'), async (channel) => {
    await channel.assertQueue('catalog.rogue-queue', { durable: true });
  });
  assertRefused(result, 'catalog declaring catalog.rogue-queue');
});

test('the catalog producer cannot declare an exchange it does not own', async () => {
  const result = await attempt(brokerUrl(context, 'catalog'), async (channel) => {
    await channel.assertExchange('billing.events', 'topic', { durable: true });
  });
  assertRefused(result, 'catalog declaring billing.events');
});

test('the catalog producer cannot bypass its exchange via the DEFAULT exchange', async () => {
  // The default exchange routes straight to a queue by name and would sidestep
  // the whole ownership model if it were writable.
  const result = await attempt(brokerUrl(context, 'catalog'), async (channel) => {
    await new Promise((resolve, reject) => {
      channel.sendToQueue(
        subscriberQueueName('reporting'),
        Buffer.from('{}'),
        { persistent: true },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  });
  assertRefused(result, 'catalog publishing through amq.default');
});

/* ----------------------------- subscriber denials ----------------------------- */

test('a subscriber cannot publish to the producer exchange', async () => {
  // Read access to bind must not imply the ability to forge events.
  const result = await attempt(brokerUrl(context, 'communications'), async (channel) => {
    await channel.assertExchange(CATALOG_EVENTS_EXCHANGE, 'topic', { durable: true });
  });
  assertRefused(result, 'communications declaring catalog.events');
});

test('a subscriber cannot consume the OTHER subscriber queue', async () => {
  const result = await attempt(brokerUrl(context, 'reporting'), async (channel) => {
    await channel.consume(subscriberQueueName('communications'), () => {}, { noAck: false });
  });
  assertRefused(result, 'reporting consuming the communications queue');
});

test('a subscriber cannot create resources in another namespace', async () => {
  const result = await attempt(brokerUrl(context, 'communications'), async (channel) => {
    await channel.assertQueue('reporting.injected', { durable: true });
  });
  assertRefused(result, 'communications declaring reporting.injected');
});

test('a subscriber cannot publish to the other subscriber queue via the default exchange', async () => {
  const result = await attempt(brokerUrl(context, 'communications'), async (channel) => {
    await new Promise((resolve, reject) => {
      channel.sendToQueue(
        subscriberQueueName('reporting'),
        Buffer.from('{}'),
        { persistent: true },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  });
  assertRefused(result, 'communications publishing through amq.default');
});

/* ------------------------- authentication and administration ------------------------- */

test('a wrong password is refused at authentication', async () => {
  const result = await attempt(
    brokerUrlAs(context, 'cw_catalog_app', 'definitely-not-the-password'),
    async () => {},
  );
  assert.equal(
    result.outcome,
    'connection-refused',
    `expected an auth failure, got ${result.outcome}`,
  );
});

test('the default guest account does not exist', async () => {
  // A broker that still has `guest` has an unowned identity with a known password.
  const result = await attempt(brokerUrlAs(context, 'guest', 'guest'), async () => {});
  assert.equal(result.outcome, 'connection-refused');
});

async function management(pathname, user, password) {
  const auth = Buffer.from(`${user}:${password}`).toString('base64');
  const response = await fetch(`http://127.0.0.1:${context.ports.rabbitmqManagement}${pathname}`, {
    headers: { authorization: `Basic ${auth}` },
  });
  return response.status;
}

test('no application identity holds broker administration rights', async () => {
  for (const service of context.brokerServices) {
    const status = await management(
      '/api/users',
      `cw_${service}_app`,
      context.credentials[`${service}_broker`],
    );
    assert.ok(
      status === 401 || status === 403,
      `cw_${service}_app could list broker users (HTTP ${status})`,
    );
  }
});

test('even the topology identity cannot administer the broker', async () => {
  // It owns topology inside one vhost; that is not the same as owning the broker.
  const status = await management(
    '/api/users',
    'cw_infra_topology',
    context.credentials.rabbitInfra,
  );
  assert.ok(
    status === 401 || status === 403,
    `cw_infra_topology could list users (HTTP ${status})`,
  );
});

test('application identities cannot reach another vhost', async () => {
  const result = await attempt(
    `amqp://cw_catalog_app:${encodeURIComponent(context.credentials.catalog_broker)}@127.0.0.1:${context.ports.rabbitmq}/%2F`,
    async () => {},
  );
  assert.equal(result.outcome, 'connection-refused', 'the default vhost must not be reachable');
});
