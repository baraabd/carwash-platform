/**
 * Configuration revision rules.
 *
 * Pure domain: no Nest, Prisma or HTTP types. A configuration value is never
 * edited in place. Every change is a new, append-only revision that a second
 * person must approve before it can become the active one, and every read
 * says exactly which revision it resolved, or that nothing is configured.
 * No default is invented.
 */

export const ENVIRONMENTS = ['development', 'staging', 'production'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const VALUE_TYPES = ['boolean', 'integer', 'decimal', 'string', 'duration-ms'] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

/** Stored form of the tenant dimension; `*` means "every tenant in the environment". */
export const ALL_TENANTS = '*';

export class ConfigurationRuleError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ConfigurationRuleError';
  }
}

const NAMESPACE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;
const KEY = /^[a-z][a-z0-9.-]{1,62}[a-z0-9]$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Secrets belong in a secret manager, never in reviewable configuration rows. */
const SECRET_LIKE = /(secret|password|passwd|token|credential|private-?key|api-?key)/;
const DECIMAL = /^-?(0|[1-9]\d{0,17})(\.\d{1,6})?$/;
/** True when the text contains a C0 control character (tab/newline handling is the caller's). */
function hasControl(value: string, allowWhitespace = false): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 && !(allowWhitespace && (code === 0x09 || code === 0x0a || code === 0x0d)))
      return true;
  }
  return false;
}

export const MAX_STRING_VALUE = 512;
export const MAX_REASON = 500;
export const MAX_INTEGER = 9_007_199_254_740_991;

export interface ConfigScope {
  readonly namespace: string;
  readonly key: string;
  readonly environment: Environment;
  /** A tenant UUID, or ALL_TENANTS for the environment-wide value. */
  readonly tenantScope: string;
}

/** A typed value. Decimals are exact strings with at most 6 fraction digits. */
export type ConfigValue =
  | { readonly type: 'boolean'; readonly value: boolean }
  | { readonly type: 'integer'; readonly value: number }
  | { readonly type: 'decimal'; readonly value: string }
  | { readonly type: 'string'; readonly value: string }
  | { readonly type: 'duration-ms'; readonly value: number };

export function configScope(input: {
  namespace: unknown;
  key: unknown;
  environment: unknown;
  tenantId: unknown;
}): ConfigScope {
  const { namespace, key, environment, tenantId } = input;
  if (typeof namespace !== 'string' || !NAMESPACE.test(namespace))
    throw new ConfigurationRuleError('INVALID_NAMESPACE');
  if (typeof key !== 'string' || !KEY.test(key)) throw new ConfigurationRuleError('INVALID_KEY');
  if (SECRET_LIKE.test(`${namespace}.${key}`))
    throw new ConfigurationRuleError('SECRET_NOT_CONFIGURATION');
  if (typeof environment !== 'string' || !ENVIRONMENTS.some((e) => e === environment))
    throw new ConfigurationRuleError('INVALID_ENVIRONMENT');
  let tenantScope = ALL_TENANTS;
  if (tenantId !== null && tenantId !== undefined) {
    if (typeof tenantId !== 'string' || !UUID.test(tenantId))
      throw new ConfigurationRuleError('INVALID_TENANT');
    tenantScope = tenantId.toLowerCase();
  }
  return { namespace, key, environment: environment as Environment, tenantScope };
}

export function configValue(input: { type: unknown; value: unknown }): ConfigValue {
  const { type, value } = input;
  switch (type) {
    case 'boolean':
      if (typeof value !== 'boolean') throw new ConfigurationRuleError('INVALID_BOOLEAN');
      return { type, value };
    case 'integer':
      if (typeof value !== 'number' || !Number.isSafeInteger(value))
        throw new ConfigurationRuleError('INVALID_INTEGER');
      return { type, value };
    case 'duration-ms':
      if (
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > 31_536_000_000
      )
        throw new ConfigurationRuleError('INVALID_DURATION');
      return { type, value };
    case 'decimal':
      // Exact decimal text only: a JSON number would already be a binary float.
      if (typeof value !== 'string' || !DECIMAL.test(value) || value === '-0')
        throw new ConfigurationRuleError('INVALID_DECIMAL');
      return { type, value };
    case 'string':
      if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > MAX_STRING_VALUE ||
        hasControl(value, true)
      )
        throw new ConfigurationRuleError('INVALID_STRING');
      return { type, value };
    default:
      throw new ConfigurationRuleError('INVALID_VALUE_TYPE');
  }
}

export function reasonText(value: unknown): string {
  if (typeof value !== 'string') throw new ConfigurationRuleError('REASON_REQUIRED');
  const reason = value.trim();
  if (reason.length < 10 || reason.length > MAX_REASON || hasControl(reason, true))
    throw new ConfigurationRuleError('REASON_REQUIRED');
  return reason;
}

/** Canonical text of a value, used for the value hash in events and audit. */
export function valueFingerprint(value: ConfigValue): string {
  return JSON.stringify([value.type, value.value]);
}

/** Canonical text of a proposal, used for idempotent replay detection. */
export function proposalFingerprint(
  scope: ConfigScope,
  value: ConfigValue,
  reason: string,
): string {
  return JSON.stringify([
    scope.namespace,
    scope.key,
    scope.environment,
    scope.tenantScope,
    value.type,
    value.value,
    reason,
  ]);
}

export type ReviewDecision = 'APPROVED' | 'REJECTED';

/** Four-eyes rule: nobody approves or rejects their own proposal. */
export function assertReviewer(authorSubject: string, reviewerSubject: string): void {
  if (authorSubject.toLowerCase() === reviewerSubject.toLowerCase())
    throw new ConfigurationRuleError('SELF_REVIEW_FORBIDDEN');
}

export interface ActivationFacts {
  readonly decision: ReviewDecision | null;
  /** The revision currently active for the same scope, if any. */
  readonly activeRevision: number | null;
  readonly candidateRevision: number;
}

/**
 * Only an approved revision may become active, and activation never moves the
 * pointer backwards: re-activating an older revision is a new proposal (a
 * rollback is itself a reviewed change), not a silent pointer rewind.
 */
export function assertActivatable(facts: ActivationFacts): void {
  if (facts.decision !== 'APPROVED') throw new ConfigurationRuleError('REVISION_NOT_APPROVED');
  if (facts.activeRevision !== null && facts.candidateRevision <= facts.activeRevision)
    throw new ConfigurationRuleError('REVISION_NOT_NEWER_THAN_ACTIVE');
}

export interface ResolvedValue {
  readonly status: 'CONFIGURED';
  readonly scope: ConfigScope;
  readonly revision: number;
  readonly value: ConfigValue;
  /** Which level answered: the tenant's own value or the environment-wide one. */
  readonly source: 'TENANT' | 'ENVIRONMENT';
}

export type Resolution = ResolvedValue | { readonly status: 'NOT_CONFIGURED' };

/** Tenant value first, then environment-wide; nothing else, and no invented default. */
export function resolve(
  tenant: Omit<ResolvedValue, 'status' | 'source'> | null,
  environmentWide: Omit<ResolvedValue, 'status' | 'source'> | null,
): Resolution {
  if (tenant) return { status: 'CONFIGURED', source: 'TENANT', ...tenant };
  if (environmentWide) return { status: 'CONFIGURED', source: 'ENVIRONMENT', ...environmentWide };
  return { status: 'NOT_CONFIGURED' };
}
