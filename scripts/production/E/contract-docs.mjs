// Generates the published contract documents from the BUILT contract packages,
// so documentation can never drift from code. `--write` regenerates; default
// (`--check`) fails on any difference. Run after `pnpm build:packages`.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const contracts = require(path.join(root, 'packages/contracts/dist/index.js'));
const events = require(path.join(root, 'packages/event-contracts/dist/index.js'));

const errorEnvelope = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      required: [
        'code',
        'reason',
        'message',
        'requestId',
        'correlationId',
        'retryable',
        'retryAfterMs',
        'issues',
      ],
      properties: {
        code: { type: 'string', enum: [...contracts.API_ERROR_CODES] },
        reason: { type: ['string', 'null'] },
        message: { type: 'string' },
        requestId: { type: 'string' },
        correlationId: { type: 'string' },
        retryable: { type: 'boolean' },
        retryAfterMs: { type: ['integer', 'null'] },
        issues: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['field', 'code'],
            properties: { field: { type: 'string' }, code: { type: 'string' } },
          },
        },
      },
    },
  },
};

function openApi(contract) {
  const paths = {};
  for (const [name, route] of Object.entries(contract.routes)) {
    const template = `${contract.prefix}${route.path.replace(/:([A-Za-z]+)/g, '{$1}')}`;
    const parameters = [...route.path.matchAll(/:([A-Za-z]+)/g)].map(([, p]) => ({
      name: p,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    if (route.idempotent)
      parameters.push({
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{16,128}$' },
      });
    if (route.revisioned)
      parameters.push({
        name: 'If-Match',
        in: 'header',
        required: true,
        schema: { type: 'string', pattern: '^"[1-9][0-9]{0,9}"$' },
      });
    if (route.paged)
      parameters.push(
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: contracts.MAX_PAGE_LIMIT },
        },
        { name: 'cursor', in: 'query', required: false, schema: { type: 'string' } },
      );
    paths[template] ??= {};
    paths[template][route.method.toLowerCase()] = {
      operationId: `${contract.owner}.${name}`,
      'x-access': route.access,
      'x-idempotent': route.idempotent === true,
      'x-revisioned': route.revisioned === true,
      'x-safe-post': route.safe === true,
      'x-wire-parsers': `@carwash/contracts ${contract.owner}V1 (closed objects; unknown fields refused)`,
      parameters,
      responses: {
        '2XX': { description: 'Owner response validated by the published parser.' },
        default: {
          description: 'Error envelope.',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ApiErrorEnvelope' } },
          },
        },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: `WashGo ${contract.id}`,
      version: '1.0.0',
      description:
        `Published wire contract owned by the ${contract.owner} service. Status published-provider-pending: ` +
        'this document does not assert the provider endpoint is implemented. Request/response shapes ' +
        'are defined by the closed parsers in @carwash/contracts.',
    },
    'x-owner': contract.owner,
    'x-error-reasons': [...contract.reasons],
    paths,
    components: { schemas: { ApiErrorEnvelope: errorEnvelope } },
  };
}

function asyncApi(set, title, description) {
  const lines = [
    "asyncapi: '2.6.0'",
    'info:',
    `  title: ${title}`,
    "  version: '1.0.0'",
    '  description: >',
    ...description.map((line) => `    ${line}`),
    'defaultContentType: application/json',
    'channels:',
  ];
  for (const spec of set) {
    const message = spec.eventType.replace(/[^a-z0-9]+/gi, '_');
    lines.push(
      `  ${spec.producer}.events/${spec.eventType}:`,
      '    publish:',
      `      operationId: publish_${message}`,
      '      message:',
      `        name: ${spec.eventType}`,
      '        correlationId:',
      '          location: $message.payload#/correlationId',
      '        payload:',
      '          type: object',
      '          additionalProperties: false',
      '          required: [eventId, eventType, envelopeVersion, producer, occurredAt, correlationId, causationId, traceparent, aggregate, actor, data]',
      '          properties:',
      '            eventType:',
      `              const: ${spec.eventType}`,
      '            envelopeVersion:',
      '              const: 2',
      '            producer:',
      `              const: ${spec.producer}`,
      '            aggregate:',
      '              type: object',
      '              properties:',
      '                type:',
      `                  const: ${spec.aggregateType}`,
      '            data:',
      '              type: object',
      '              additionalProperties: false',
    );
  }
  return lines.join('\n') + '\n';
}

const outputs = new Map();
for (const contract of contracts.OWNER_CONTRACTS) {
  outputs.set(
    `docs/contracts/${contract.id}.openapi.json`,
    JSON.stringify(openApi(contract), null, 2) + '\n',
  );
}
outputs.set(
  'docs/asyncapi/business-events-v1.yaml',
  asyncApi(events.BUSINESS_EVENTS_V1, 'WashGo business events V1 (envelope v2)', [
    'Published wire contracts for the first business event set. Status',
    'published-producer-pending: no accepted producer emits these yet.',
    'Data is closed and carries opaque IDs/revisions only; data shapes are',
    'defined by the parsers in @carwash/event-contracts business-v1.',
  ]),
);
outputs.set(
  'docs/asyncapi/billing-events-v1.yaml',
  asyncApi(events.BILLING_EVENTS_V1, 'WashGo billing events V1 (envelope v2)', [
    'Published wire contracts for Billing payment, cash custody and refund',
    'events (exchange washgo.billing.events, routing key = event type).',
    'Status published-producer-pending: no accepted relay publishes these yet.',
    'Data is closed and carries opaque IDs, statuses, closed reasons and exact',
    'minor-unit amounts only; shapes are defined by the parsers in',
    '@carwash/event-contracts billing-v1.',
  ]),
);
outputs.set(
  'docs/asyncapi/contract-registry.json',
  JSON.stringify(
    {
      schemaVersion: 1,
      status: 'foundation-and-contract-registry-not-runtime-completion',
      contracts: events.EVENT_CONTRACTS,
    },
    null,
    2,
  ) + '\n',
);
const published = new Set(contracts.HTTP_CONTRACTS.map((c) => c.domain));
const allDomains = JSON.parse(
  await readFile(path.join(root, 'architecture/service-catalog.json'), 'utf8'),
);
const domains = (allDomains.services ?? []).map((s) => s.name ?? s.id).filter(Boolean);
outputs.set(
  'docs/api/contract-registry.json',
  JSON.stringify(
    {
      schemaVersion: 1,
      status: 'foundation-contract-registry-not-product-api-completion',
      contracts: contracts.HTTP_CONTRACTS.map((c) => ({
        ...c,
        scope:
          c.status === 'published-provider-pending'
            ? 'Published wire contract. The owner provider is not accepted; presence here does not claim the endpoint works.'
            : c.id === 'identity.v1'
              ? 'Identity-owned routes represented through the current gateway routing discovery document; not a complete standalone Identity business OpenAPI.'
              : 'Gateway/BFF routing discovery. Route presence does not claim the owning business endpoint is implemented.',
      })),
      unpublishedBusinessDomains: domains
        .filter((d) => d !== 'identity' && !published.has(d))
        .sort(),
    },
    null,
    2,
  ) + '\n',
);

const write = process.argv.includes('--write');
const drift = [];
for (const [relative, content] of outputs) {
  const target = path.join(root, relative);
  if (write) await writeFile(target, content);
  else {
    const actual = await readFile(target, 'utf8').catch(() => null);
    if (actual !== content) drift.push(relative);
  }
}
if (drift.length) {
  console.error(
    `CONTRACT_DOCS_DRIFT: ${drift.join(', ')} — run scripts/production/E/contract-docs.mjs --write and review`,
  );
  process.exit(1);
}
console.log(
  write
    ? `Wrote ${outputs.size} contract documents; review the diff.`
    : `${outputs.size} contract documents match code.`,
);
