#!/usr/bin/env node
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SECTIONS = [
  'users',
  'vhosts',
  'permissions',
  'topic_permissions',
  'parameters',
  'global_parameters',
  'policies',
  'queues',
  'exchanges',
  'bindings',
];
const builtinExchanges = new Map([
  ['', { type: 'direct', internal: false }],
  ['amq.direct', { type: 'direct', internal: false }],
  ['amq.fanout', { type: 'fanout', internal: false }],
  ['amq.headers', { type: 'headers', internal: false }],
  ['amq.match', { type: 'headers', internal: false }],
  ['amq.rabbitmq.trace', { type: 'topic', internal: true }],
  ['amq.topic', { type: 'topic', internal: false }],
]);
const fail = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = (value) =>
  JSON.stringify(
    Array.isArray(value)
      ? value.map((entry) => JSON.parse(canonical(entry)))
      : record(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, JSON.parse(canonical(value[key]))]),
          )
        : value,
  );
const same = (a, b) => canonical(a) === canonical(b);
export const exact = (names) =>
  names.length
    ? '^(?:' +
      [...new Set(names)]
        .sort()
        .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|') +
      ')$'
    : '(?!)';

function rows(value, code) {
  if (!Array.isArray(value) || value.some((entry) => !record(entry))) fail(code);
  return value;
}
function index(values, key) {
  const result = new Map();
  for (const value of values) {
    const id = key(value);
    if (result.has(id)) fail('DUPLICATE_DEFINITION');
    result.set(id, value);
  }
  return result;
}
function passwordHash(password, salt = randomBytes(4), algorithm = 'sha256') {
  return Buffer.concat([
    salt,
    createHash(algorithm).update(salt).update(password).digest(),
  ]).toString('base64');
}
function matchesPassword(user, password) {
  const algorithms = {
    rabbit_password_hashing_sha256: 'sha256',
    rabbit_password_hashing_sha512: 'sha512',
  };
  const algorithm = algorithms[user.hashing_algorithm];
  if (!algorithm || typeof user.password_hash !== 'string') return false;
  const actual = Buffer.from(user.password_hash, 'base64');
  if (
    actual.length !== (algorithm === 'sha256' ? 36 : 68) ||
    actual.toString('base64') !== user.password_hash
  )
    return false;
  const expected = Buffer.from(passwordHash(password, actual.subarray(0, 4), algorithm), 'base64');
  return timingSafeEqual(actual, expected);
}

export function buildDefinitions(manifest, credentials) {
  if (manifest.schemaVersion !== 1 || manifest.state !== 'desired-not-deployed')
    fail('MANIFEST_VERSION');
  const owners = [...new Set(manifest.requiredBrokerRoles.map((role) => role.owner))].sort();
  if (
    !record(credentials) ||
    credentials.schemaVersion !== 1 ||
    typeof credentials.vhost !== 'string' ||
    typeof credentials.usernamePrefix !== 'string' ||
    !/^[a-z][a-z0-9_-]{2,48}$/.test(credentials.vhost) ||
    !/^[a-z][a-z0-9_]{0,31}_$/.test(credentials.usernamePrefix) ||
    !record(credentials.passwords) ||
    !same(Object.keys(credentials).sort(), [
      'passwords',
      'schemaVersion',
      'usernamePrefix',
      'vhost',
    ]) ||
    !same(Object.keys(credentials.passwords).sort(), owners)
  )
    fail('CREDENTIALS_SHAPE');
  const passwords = Object.values(credentials.passwords);
  if (
    passwords.some(
      (password) =>
        typeof password !== 'string' ||
        Buffer.byteLength(password) < 32 ||
        Buffer.byteLength(password) > 256 ||
        /[\0\r\n]/.test(password),
    ) ||
    new Set(passwords).size !== owners.length
  )
    fail('CREDENTIALS_STRENGTH_OR_REUSE');
  const vhost = credentials.vhost;
  const output = Object.fromEntries(SECTIONS.map((section) => [section, []]));
  output.vhosts.push({ name: vhost, metadata: { default_queue_type: 'classic' } });
  const grants = new Map(
    owners.map((owner) => [
      owner,
      {
        configure: new Set(),
        write: new Set(),
        read: new Set(),
        topics: new Map(),
      },
    ]),
  );
  const owned = (owner, name) => {
    if (
      !grants.has(owner) ||
      (!name.startsWith(owner + '.') && !(owner === 'billing' && name === 'washgo.billing.events'))
    )
      fail('FOREIGN_RESOURCE');
  };
  const add = (section, value) => {
    const key = definitionKey(section, value);
    const previous = output[section].find((row) => definitionKey(section, row) === key);
    if (previous && !same(previous, value)) fail('CONFLICTING_MANIFEST_RESOURCE');
    if (!previous) output[section].push(value);
  };
  const exchange = (owner, name, type = 'topic') => {
    owned(owner, name);
    add('exchanges', { name, vhost, type, durable: true, auto_delete: false, arguments: {} });
    grants.get(owner).configure.add(name);
    grants.get(owner).write.add(name);
  };
  const topic = (owner, name, operation, keys) => {
    const entries = grants.get(owner).topics;
    if (!entries.has(name)) entries.set(name, { write: new Set(), read: new Set() });
    keys.forEach((key) => entries.get(name)[operation].add(key));
  };
  const queue = (owner, name, type, args = {}) => {
    owned(owner, name);
    add('queues', { name, vhost, type, durable: true, auto_delete: false, arguments: args });
    grants.get(owner).configure.add(name);
    grants.get(owner).write.add(name);
  };
  const bind = (source, destination, key) =>
    add('bindings', {
      source,
      vhost,
      destination,
      destination_type: 'queue',
      routing_key: key,
      arguments: {},
    });
  for (const producer of manifest.producers) {
    exchange(producer.owner, producer.exchange);
    topic(producer.owner, producer.exchange, 'write', producer.keys);
  }
  for (const consumer of manifest.consumers) {
    const { owner, dlx, dlq } = consumer;
    exchange(owner, dlx);
    queue(
      owner,
      dlq,
      consumer.dlqType ?? 'classic',
      consumer.dlqType === 'quorum' ? { 'x-queue-type': 'quorum' } : {},
    );
    if (!Number.isInteger(consumer.deliveryLimit) || consumer.deliveryLimit < 1)
      fail('DELIVERY_LIMIT');
    queue(owner, consumer.queue, 'quorum', {
      'x-queue-type': 'quorum',
      'x-delivery-limit': consumer.deliveryLimit,
      'x-dead-letter-exchange': dlx,
      ...(consumer.deadLetterKey ? { 'x-dead-letter-routing-key': consumer.deadLetterKey } : {}),
    });
    grants.get(owner).read.add(consumer.queue);
    grants.get(owner).read.add(dlx);
    topic(owner, dlx, 'read', ['#']);
    topic(
      owner,
      dlx,
      'write',
      consumer.deadLetterKey
        ? [consumer.deadLetterKey]
        : consumer.bindings.flatMap((binding) => binding.keys),
    );
    bind(dlx, dlq, '#');
    if (consumer.retryExchange) {
      exchange(owner, consumer.retryExchange, 'direct');
      grants.get(owner).read.add(consumer.retryExchange);
    }
    for (const binding of consumer.bindings) {
      if (!output.exchanges.some((entry) => entry.name === binding.exchange))
        fail('UNKNOWN_PRODUCER');
      grants.get(owner).read.add(binding.exchange);
      topic(owner, binding.exchange, 'read', binding.keys);
      for (const key of binding.keys) {
        bind(binding.exchange, consumer.queue, key);
        if (consumer.retryExchange) bind(consumer.retryExchange, consumer.queue, key);
      }
    }
  }
  for (const owner of owners) {
    const name = credentials.usernamePrefix + owner + '_app';
    output.users.push({
      name,
      password_hash: passwordHash(credentials.passwords[owner]),
      hashing_algorithm: 'rabbit_password_hashing_sha256',
      tags: [],
      limits: {},
    });
    const grant = grants.get(owner);
    output.permissions.push({
      user: name,
      vhost,
      configure: exact([...grant.configure]),
      write: exact([...grant.write]),
      read: exact([...grant.read]),
    });
    for (const target of output.exchanges.filter((entry) => entry.type === 'topic')) {
      const rights = grant.topics.get(target.name);
      output.topic_permissions.push({
        user: name,
        vhost,
        exchange: target.name,
        write: exact([...(rights?.write ?? [])]),
        read: exact([...(rights?.read ?? [])]),
      });
    }
  }
  output.policies.push({
    vhost,
    name: 'carwash_required_durable_dlq_v1',
    pattern: exact(manifest.consumers.map((c) => c.queue)),
    'apply-to': 'queues',
    priority: 100,
    definition: { 'dead-letter-strategy': 'at-least-once', overflow: 'reject-publish' },
  });
  return output;
}

function definitionKey(section, row) {
  if (section === 'permissions') return canonical([row.vhost, row.user]);
  if (section === 'topic_permissions') return canonical([row.vhost, row.user, row.exchange]);
  if (section === 'bindings')
    return canonical([
      row.vhost,
      row.source,
      row.destination,
      row.destination_type,
      row.routing_key,
      row.arguments,
    ]);
  return canonical([row.vhost ?? '', row.name]);
}
function comparable(section, row) {
  if (section === 'vhosts')
    return { name: row.name, defaultQueueType: row.metadata?.default_queue_type ?? 'classic' };
  if (section === 'queues' || section === 'exchanges')
    return {
      name: row.name,
      vhost: row.vhost,
      type: row.type,
      durable: row.durable,
      auto_delete: row.auto_delete,
      arguments: row.arguments,
    };
  return row;
}

/** Only add missing, compatible definitions. Existing users are verified and never imported again. */
export function reconcile(manifest, credentials, snapshot, { verify = false } = {}) {
  const desired = buildDefinitions(manifest, credentials);
  if (
    !record(snapshot) ||
    snapshot.schemaVersion !== 1 ||
    snapshot.vhost !== credentials.vhost ||
    !record(snapshot.definitions) ||
    !/^4\.2\./.test(snapshot.definitions.rabbitmq_version ?? '')
  ) {
    fail('SNAPSHOT_VERSION_OR_SCOPE');
  }
  if (
    !same(Object.keys(snapshot).sort(), [
      'definitions',
      'exchanges',
      'operatorPolicies',
      'queues',
      'schemaVersion',
      'vhost',
    ])
  )
    fail('SNAPSHOT_FIELDS');
  const observed = snapshot.definitions;
  for (const section of SECTIONS) rows(observed[section], 'INCOMPLETE_CLUSTER_EXPORT');
  rows(snapshot.exchanges, 'EXCHANGE_INSPECTION_REQUIRED');
  rows(snapshot.queues, 'QUEUE_INSPECTION_REQUIRED');
  if (rows(snapshot.operatorPolicies, 'OPERATOR_POLICY_INSPECTION_REQUIRED').length)
    fail('OPERATOR_POLICIES_PRESENT');
  const vhost = credentials.vhost;
  const existingVhost = observed.vhosts.find((entry) => entry.name === vhost);
  if (existingVhost?.limits && Object.keys(existingVhost.limits).length > 0)
    fail('VHOST_LIMITS_PRESENT');
  index(snapshot.exchanges, (entry) => entry.name);
  index(snapshot.queues, (entry) => entry.name);
  if (
    existingVhost &&
    [...builtinExchanges.keys()].some(
      (name) => !snapshot.exchanges.some((entry) => entry.name === name),
    )
  )
    fail('BUILTIN_INSPECTION_INCOMPLETE');
  const exportedExchanges = observed.exchanges.filter((entry) => entry.vhost === vhost);
  const exportedQueues = observed.queues.filter((entry) => entry.vhost === vhost);
  for (const row of snapshot.exchanges) {
    if (
      !same(Object.keys(row).sort(), ['internal', 'name', 'type']) ||
      typeof row.name !== 'string' ||
      typeof row.type !== 'string' ||
      typeof row.internal !== 'boolean'
    )
      fail('EXCHANGE_INSPECTION_INVALID');
    const builtin = builtinExchanges.get(row.name);
    if (builtin ? row.type !== builtin.type || row.internal !== builtin.internal : row.internal) {
      fail('EXCHANGE_INSPECTION_INVALID');
    }
    const exported = exportedExchanges.find((entry) => entry.name === row.name);
    if (exported && exported.type !== row.type) fail('EXCHANGE_INSPECTION_INCONSISTENT');
  }
  for (const row of snapshot.queues) {
    if (
      !same(Object.keys(row).sort(), ['exclusive', 'name', 'type']) ||
      typeof row.name !== 'string' ||
      !['classic', 'quorum'].includes(row.type) ||
      !(row.exclusive === false || (row.type === 'quorum' && row.exclusive === ''))
    ) {
      fail('QUEUE_INSPECTION_INVALID');
    }
    const exported = exportedQueues.find((entry) => entry.name === row.name);
    if (exported && exported.type !== row.type) fail('QUEUE_INSPECTION_INCONSISTENT');
  }
  const actualExchangeNames = snapshot.exchanges
    .map((entry) => entry.name)
    .filter((name) => !builtinExchanges.has(name));
  if (
    !same([...actualExchangeNames].sort(), exportedExchanges.map((entry) => entry.name).sort()) ||
    !same(
      snapshot.queues.map((entry) => entry.name).sort(),
      exportedQueues.map((entry) => entry.name).sort(),
    )
  ) {
    fail('HIDDEN_OR_INCONSISTENT_RESOURCES');
  }
  if (
    !existingVhost &&
    (snapshot.exchanges.length ||
      snapshot.queues.length ||
      exportedExchanges.length ||
      exportedQueues.length)
  )
    fail('ABSENT_VHOST_HAS_RESOURCES');
  if (observed.parameters.some((entry) => entry.vhost === vhost)) fail('VHOST_PARAMETERS_PRESENT');
  const wantedUsers = new Map(desired.users.map((user) => [user.name, user]));
  for (const row of [...observed.permissions, ...observed.topic_permissions]) {
    if (wantedUsers.has(row.user) && row.vhost !== vhost)
      fail('RUNTIME_IDENTITY_SHARED_WITH_OTHER_VHOST');
  }
  const patch = Object.fromEntries(SECTIONS.map((section) => [section, []]));
  for (const section of SECTIONS.filter(
    (name) => !['parameters', 'global_parameters'].includes(name),
  )) {
    const expected = index(desired[section], (row) => definitionKey(section, row));
    const all = index(observed[section], (row) => definitionKey(section, row));
    const relevant = [...all.values()].filter((row) =>
      section === 'users'
        ? wantedUsers.has(row.name)
        : section === 'vhosts'
          ? row.name === vhost
          : row.vhost === vhost,
    );
    for (const row of relevant) {
      const key = definitionKey(section, row);
      const wanted = expected.get(key);
      if (!wanted) fail('EXTRANEOUS_' + section.toUpperCase());
      if (section === 'users') {
        const owner = manifest.requiredBrokerRoles.find(
          (role) => credentials.usernamePrefix + role.owner + '_app' === row.name,
        ).owner;
        if (
          !same(row.tags, []) ||
          !same(row.limits ?? {}, {}) ||
          !matchesPassword(row, credentials.passwords[owner])
        )
          fail('EXISTING_USER_MISMATCH');
      } else if (!same(comparable(section, row), comparable(section, wanted))) {
        fail('INCOMPATIBLE_' + section.toUpperCase());
      }
      expected.delete(key);
    }
    patch[section] = [...expected.values()];
  }
  const counts = Object.fromEntries(SECTIONS.map((section) => [section, patch[section].length]));
  if (verify && Object.values(counts).some((count) => count > 0)) fail('POST_IMPORT_INCOMPLETE');
  return { definitions: patch, counts };
}

/** Private regular files only; output is exclusive-create, never a replacement. */
export async function privateFile(file, value) {
  if (!path.isAbsolute(file)) fail('ABSOLUTE_PRIVATE_PATH_REQUIRED');
  const parent = path.dirname(file);
  const directory = await stat(parent);
  if (
    (await realpath(parent)) !== parent ||
    directory.uid !== process.getuid() ||
    (directory.mode & 0o077) !== 0 ||
    !directory.isDirectory()
  )
    fail('PRIVATE_DIRECTORY_REQUIRED');
  const handle = await open(
    file,
    value === undefined
      ? constants.O_RDONLY | constants.O_NOFOLLOW
      : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.uid !== process.getuid() ||
      (metadata.mode & 0o077) !== 0 ||
      metadata.size > 8 * 1024 * 1024
    )
      fail('PRIVATE_FILE_REQUIRED');
    if (value === undefined) {
      const content = await handle.readFile('utf8');
      try {
        return JSON.parse(content);
      } catch {
        fail('PRIVATE_JSON_INVALID');
      }
    }
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!/^--[a-z-]+$/.test(args[i]) || !args[i + 1] || options[args[i]]) fail('ARGUMENTS');
    options[args[i]] = args[i + 1];
  }
  const allowed = {
    bundle: [
      '--credentials',
      '--definitions',
      '--exchanges',
      '--queues',
      '--operator-policies',
      '--output',
    ],
    prepare: ['--credentials', '--snapshot', '--output'],
    verify: ['--credentials', '--snapshot'],
  }[command];
  if (!allowed || !same(Object.keys(options).sort(), allowed.sort())) fail('ARGUMENTS');
  const manifest = JSON.parse(
    await readFile(new URL('./hosted-topology.v1.json', import.meta.url), 'utf8'),
  );
  const credentials = await privateFile(options['--credentials']);
  const snapshot =
    command === 'bundle'
      ? {
          schemaVersion: 1,
          vhost: credentials.vhost,
          definitions: await privateFile(options['--definitions']),
          exchanges: await privateFile(options['--exchanges']),
          queues: await privateFile(options['--queues']),
          operatorPolicies: await privateFile(options['--operator-policies']),
        }
      : await privateFile(options['--snapshot']);
  const result = reconcile(manifest, credentials, snapshot, { verify: command === 'verify' });
  if (command !== 'verify') {
    await privateFile(options['--output'], command === 'bundle' ? snapshot : result.definitions);
  }
  process.stdout.write(
    JSON.stringify({
      status: command === 'verify' ? 'VERIFIED' : command === 'bundle' ? 'BUNDLED' : 'PREPARED',
      additions: result.counts,
    }) + '\n',
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Never include credentials, hashes, JSON parse fragments or child process output.
    const code = /^[A-Z_]{3,80}$/.test(error.code ?? '') ? error.code : 'INVALID_PRIVATE_INPUT';
    process.stderr.write('HOSTED_BROKER_DEFINITIONS_REFUSED:' + code + '\n');
    process.exitCode = 1;
  });
}
