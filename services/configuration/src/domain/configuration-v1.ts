/**
 * configuration.v1 owner rules: market-scoped, closed namespaces published
 * through draft -> approve (four eyes) -> publish.
 *
 * Pure domain: no Nest, Prisma or HTTP types.
 *
 * Wire shapes are the ones Lane E published in
 * packages/contracts/src/configuration/v1.ts. This service may not import that
 * package yet (the dependency is a lockfile change owned by Lane E,
 * CR-D-P01-03 / CR-D-P05-D5-01), so the parsers below restate the published
 * rules one-to-one. They are not a second contract: the real-infrastructure
 * suite feeds the same accept/reject matrix through the COMPILED published
 * parsers and through these, and fails on any difference.
 */

export const CONFIGURATION_V1_ID = 'configuration.v1';
export const CONFIGURATION_NAMESPACES = ['booking.policy.v1', 'market.presentation.v1'] as const;
export type ConfigurationNamespace = (typeof CONFIGURATION_NAMESPACES)[number];

/** Published by contracts/common/money.ts (CURRENCIES keys). */
export const CURRENCIES = ['SYP', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];
/** Published by contracts/common/time.ts (BUSINESS_TIME_ZONES). */
export const BUSINESS_TIME_ZONES = ['Asia/Damascus'] as const;
export type BusinessTimeZone = (typeof BUSINESS_TIME_ZONES)[number];
export const LOCALES = ['ar', 'en'] as const;
export const SLOT_STEPS = [15, 30, 60] as const;
export const MAX_REVISION = 2_147_483_647;

const MARKET_ID = /^[a-z]{2}(-[a-z0-9]{2,8})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Same semantics as the P01-D3 guard: secrets belong in a secret manager. */
const SECRET_LIKE = /(secret|password|passwd|token|credential|private-?key|api-?key)/i;

/** A wire violation: `code` and `path` mirror the published ContractViolation. */
export class ConfigurationContractViolation extends Error {
  constructor(
    readonly code: string,
    readonly path: string,
  ) {
    super(`${code} at ${path}`);
    this.name = 'ConfigurationContractViolation';
  }
}

export interface BookingPolicyV1 {
  readonly holdTtlSeconds: number;
  readonly quoteTtlSeconds: number;
  readonly minLeadMinutes: number;
  readonly horizonDays: number;
  readonly slotStepMinutes: (typeof SLOT_STEPS)[number];
  readonly cancellationCutoffMinutes: number;
}

export interface MarketPresentationV1 {
  readonly currency: Currency;
  readonly defaultLocale: (typeof LOCALES)[number];
  readonly timezone: BusinessTimeZone;
}

export type ConfigurationContentV1 =
  | { readonly namespace: 'booking.policy.v1'; readonly content: BookingPolicyV1 }
  | { readonly namespace: 'market.presentation.v1'; readonly content: MarketPresentationV1 };

export interface CreateDraftRequestV1 {
  readonly expectedVersion: number | null;
  readonly content: ConfigurationContentV1;
}

export interface DraftTransitionRequestV1 {
  readonly expectedRevision: number;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new ConfigurationContractViolation('EXPECTED_OBJECT', path);
  return value as Record<string, unknown>;
}

function closed(value: unknown, path: string, required: readonly string[]) {
  const v = record(value, path);
  for (const key of required)
    if (!Object.hasOwn(v, key))
      throw new ConfigurationContractViolation('MISSING_FIELD', `${path}.${key}`);
  for (const key of Object.keys(v))
    if (!required.includes(key))
      throw new ConfigurationContractViolation('UNEXPECTED_FIELD', `${path}.${key}`);
  return v;
}

function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw new ConfigurationContractViolation('INVALID_INTEGER', path);
  return value;
}

function oneOf<const T extends readonly string[]>(value: unknown, path: string, allowed: T) {
  if (typeof value !== 'string' || !allowed.includes(value))
    throw new ConfigurationContractViolation('INVALID_ENUM', path);
  return value as T[number];
}

/** contracts/common/protocol.ts parseRevision: integer 1..2^31-1. */
export function parseRevision(value: unknown, path: string): number {
  return integer(value, path, 1, MAX_REVISION);
}

/** contracts/common/wire.ts text() with the market pattern (NFC, 1..11, no controls). */
export function parseMarketId(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new ConfigurationContractViolation('EXPECTED_STRING', path);
  const normalized = value.normalize('NFC');
  const length = [...normalized].length;
  if (length < 1 || length > 11) throw new ConfigurationContractViolation('INVALID_LENGTH', path);
  if (!MARKET_ID.test(normalized)) throw new ConfigurationContractViolation('INVALID_FORMAT', path);
  return normalized;
}

export function parseNamespace(value: unknown, path: string): ConfigurationNamespace {
  return oneOf(value, path, CONFIGURATION_NAMESPACES);
}

export function parseBookingPolicyV1(value: unknown, path: string): BookingPolicyV1 {
  const v = closed(value, path, [
    'holdTtlSeconds',
    'quoteTtlSeconds',
    'minLeadMinutes',
    'horizonDays',
    'slotStepMinutes',
    'cancellationCutoffMinutes',
  ]);
  const step = integer(v.slotStepMinutes, `${path}.slotStepMinutes`, 15, 60);
  const slotStepMinutes = SLOT_STEPS.find((allowed) => allowed === step);
  if (slotStepMinutes === undefined)
    throw new ConfigurationContractViolation('INVALID_ENUM', `${path}.slotStepMinutes`);
  return {
    holdTtlSeconds: integer(v.holdTtlSeconds, `${path}.holdTtlSeconds`, 60, 3600),
    quoteTtlSeconds: integer(v.quoteTtlSeconds, `${path}.quoteTtlSeconds`, 60, 86_400),
    minLeadMinutes: integer(v.minLeadMinutes, `${path}.minLeadMinutes`, 0, 1440),
    horizonDays: integer(v.horizonDays, `${path}.horizonDays`, 1, 60),
    slotStepMinutes,
    cancellationCutoffMinutes: integer(
      v.cancellationCutoffMinutes,
      `${path}.cancellationCutoffMinutes`,
      0,
      1440,
    ),
  };
}

export function parseMarketPresentationV1(value: unknown, path: string): MarketPresentationV1 {
  const v = closed(value, path, ['currency', 'defaultLocale', 'timezone']);
  return {
    currency: oneOf(v.currency, `${path}.currency`, CURRENCIES),
    defaultLocale: oneOf(v.defaultLocale, `${path}.defaultLocale`, LOCALES),
    timezone: oneOf(v.timezone, `${path}.timezone`, BUSINESS_TIME_ZONES),
  };
}

export function parseConfigurationContentV1(
  namespaceValue: unknown,
  contentValue: unknown,
  path: string,
): ConfigurationContentV1 {
  const namespace = parseNamespace(namespaceValue, `${path}.namespace`);
  if (namespace === 'booking.policy.v1')
    return { namespace, content: parseBookingPolicyV1(contentValue, `${path}.content`) };
  return { namespace, content: parseMarketPresentationV1(contentValue, `${path}.content`) };
}

/** Namespace comes from the route (:namespace); the body carries only content. */
export function parseCreateDraftRequestV1(
  namespace: unknown,
  value: unknown,
): CreateDraftRequestV1 {
  const v = closed(value, '$', ['expectedVersion', 'content']);
  return {
    expectedVersion:
      v.expectedVersion === null ? null : parseRevision(v.expectedVersion, '$.expectedVersion'),
    content: parseConfigurationContentV1(namespace, v.content, '$'),
  };
}

export function parseDraftTransitionRequestV1(value: unknown): DraftTransitionRequestV1 {
  const v = closed(value, '$', ['expectedRevision']);
  return { expectedRevision: parseRevision(v.expectedRevision, '$.expectedRevision') };
}

export function parseDraftId(value: unknown, path: string): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new ConfigurationContractViolation('INVALID_UUID', path);
  return value.toLowerCase();
}

/**
 * contracts/common/wire.ts canonicalJson: sorted keys, no whitespace, NFC
 * strings. Used for the content hash and the idempotency fingerprint.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ConfigurationContractViolation('NON_FINITE_NUMBER', '$');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  throw new ConfigurationContractViolation('NON_JSON_VALUE', '$');
}

/**
 * The text whose SHA-256 is `contentHash`: canonical JSON of the namespace
 * content object only (not the namespace, market or version). The published
 * contract fixes the hash format (64 lowercase hex) but not its input; this
 * definition is requested for the contract in CR-D-P05-D5-02.
 */
export function contentHashMaterial(content: ConfigurationContentV1): string {
  return canonicalJson(content.content);
}

/**
 * contracts/common/protocol.ts idempotencyMaterial: the fingerprint covers the
 * contract, operation, actor, target and business body, never headers.
 */
export function idempotencyMaterial(input: {
  readonly operation: string;
  readonly actor: string;
  readonly target: string | null;
  readonly body: unknown;
}): string {
  return canonicalJson({
    v: 1,
    contract: CONFIGURATION_V1_ID,
    operation: input.operation,
    actor: input.actor,
    target: input.target,
    body: input.body ?? null,
  });
}

/** contracts/common/protocol.ts parseIdempotencyKey. */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
export function parseIdempotencyKey(value: unknown): string {
  if (value === undefined || value === null || value === '')
    throw new ConfigurationV1RuleError('IDEMPOTENCY_KEY_REQUIRED');
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY.test(value))
    throw new ConfigurationV1RuleError('IDEMPOTENCY_KEY_INVALID');
  return value;
}

/**
 * Defence in depth for the P01-D3 rule "no secrets in configuration". The v1
 * namespaces are closed (integers and enumerations only), so a secret cannot
 * be expressed; this still refuses a secret-like field name should a future
 * namespace be added without review.
 */
export function assertNoSecrets(content: { readonly content: object }): void {
  for (const key of Object.keys(content.content))
    if (SECRET_LIKE.test(key)) throw new ConfigurationV1RuleError('SECRET_NOT_CONFIGURATION');
}

/* ----------------------------- state machine ------------------------------ */

export const DRAFT_STATUSES = ['DRAFT', 'APPROVED', 'PUBLISHED', 'WITHDRAWN'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/** Owner rule failures. Contract reasons keep their published names. */
export type ConfigurationV1RuleCode =
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_KEY_INVALID'
  | 'SECRET_NOT_CONFIGURATION'
  /** createDraft: expectedVersion is not the scope's current published version. */
  | 'VERSION_CONFLICT'
  /** approve/publish/withdraw: expectedRevision is not the draft's revision. */
  | 'REVISION_CONFLICT'
  /** createDraft: the scope already has an open (DRAFT or APPROVED) draft. */
  | 'DRAFT_ALREADY_OPEN'
  /** The draft is PUBLISHED or WITHDRAWN: it can no longer move. */
  | 'DRAFT_CLOSED'
  /** approve: the draft is already APPROVED. */
  | 'DRAFT_ALREADY_APPROVED'
  /** publish: the scope moved since the draft was based on it. */
  | 'DRAFT_BASE_STALE'
  | 'SELF_APPROVAL_FORBIDDEN'
  | 'DRAFT_NOT_APPROVED'
  | 'POLICY_UNAVAILABLE';

export class ConfigurationV1RuleError extends Error {
  constructor(readonly code: ConfigurationV1RuleCode) {
    super(code);
    this.name = 'ConfigurationV1RuleError';
  }
}

export interface DraftFacts {
  readonly status: DraftStatus;
  readonly revision: number;
  readonly authorSubject: string;
  readonly baseVersion: number | null;
}

/** expectedVersion null means "nothing published yet" (published version 0). */
export function assertDraftBase(expectedVersion: number | null, publishedVersion: number): void {
  if ((expectedVersion ?? 0) !== publishedVersion)
    throw new ConfigurationV1RuleError('VERSION_CONFLICT');
}

export function assertNoOpenDraft(open: boolean): void {
  if (open) throw new ConfigurationV1RuleError('DRAFT_ALREADY_OPEN');
}

function assertRevision(draft: DraftFacts, expectedRevision: number): void {
  if (draft.revision !== expectedRevision) throw new ConfigurationV1RuleError('REVISION_CONFLICT');
}

function assertOpen(draft: DraftFacts): void {
  if (draft.status === 'PUBLISHED' || draft.status === 'WITHDRAWN')
    throw new ConfigurationV1RuleError('DRAFT_CLOSED');
}

/** Four eyes: the approver is a different principal than the author. */
export function assertApprovable(
  draft: DraftFacts,
  approverSubject: string,
  expectedRevision: number,
): void {
  assertRevision(draft, expectedRevision);
  assertOpen(draft);
  if (draft.status === 'APPROVED') throw new ConfigurationV1RuleError('DRAFT_ALREADY_APPROVED');
  if (draft.authorSubject.toLowerCase() === approverSubject.toLowerCase())
    throw new ConfigurationV1RuleError('SELF_APPROVAL_FORBIDDEN');
}

/** Only an approved draft, still based on the current version, is publishable. */
export function assertPublishable(
  draft: DraftFacts,
  expectedRevision: number,
  publishedVersion: number,
): number {
  assertRevision(draft, expectedRevision);
  assertOpen(draft);
  if (draft.status !== 'APPROVED') throw new ConfigurationV1RuleError('DRAFT_NOT_APPROVED');
  if ((draft.baseVersion ?? 0) !== publishedVersion)
    throw new ConfigurationV1RuleError('DRAFT_BASE_STALE');
  return publishedVersion + 1;
}

export function assertWithdrawable(draft: DraftFacts, expectedRevision: number): void {
  assertRevision(draft, expectedRevision);
  assertOpen(draft);
}

/* ---------------------------------- diff ---------------------------------- */

export interface FieldChange {
  readonly field: string;
  readonly from: unknown;
  readonly to: unknown;
}

/** Field-level changes between two contents of one namespace, sorted by field. */
export function diffContent(from: object, to: object): FieldChange[] {
  const before = new Map<string, unknown>(Object.entries(from));
  const after = new Map<string, unknown>(Object.entries(to));
  const fields = [...new Set([...before.keys(), ...after.keys()])].sort();
  return fields
    .filter(
      (field) =>
        canonicalJson(before.get(field) ?? null) !== canonicalJson(after.get(field) ?? null),
    )
    .map((field) => ({ field, from: before.get(field) ?? null, to: after.get(field) ?? null }));
}
