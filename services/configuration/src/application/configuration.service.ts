import {
  ALL_TENANTS,
  ConfigurationRuleError,
  configScope,
  configValue,
  proposalFingerprint,
  reasonText,
  resolve,
  valueFingerprint,
  type ReviewDecision,
  type Resolution,
} from '../domain/configuration';
import type {
  ActivateResult,
  Actor,
  Clock,
  ConfigurationRepository,
  Hasher,
  IdGenerator,
  ProposeResult,
  RevisionRecord,
} from '../ports/configuration.ports';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9:._-]{7,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_HISTORY = 50;

function uuid(value: unknown, code: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new ConfigurationRuleError(code);
  return value.toLowerCase();
}

export class ConfigurationCommands {
  constructor(
    private readonly repository: ConfigurationRepository,
    private readonly clock: Clock,
    private readonly hash: Hasher,
    private readonly newId: IdGenerator,
  ) {}

  propose(
    actor: Actor,
    idempotencyKey: unknown,
    input: {
      namespace: unknown;
      key: unknown;
      environment: unknown;
      tenantId: unknown;
      type: unknown;
      value: unknown;
      reason: unknown;
    },
  ): Promise<ProposeResult> {
    if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(idempotencyKey))
      throw new ConfigurationRuleError('IDEMPOTENCY_KEY_REQUIRED');
    const scope = configScope(input);
    const value = configValue(input);
    const reason = reasonText(input.reason);
    return this.repository.propose({
      id: this.newId(),
      scope,
      value,
      valueHash: this.hash(valueFingerprint(value)),
      requestHash: this.hash(proposalFingerprint(scope, value, reason)),
      reason,
      actor,
      idempotencyKey,
      auditId: this.newId(),
      now: this.clock.now(),
    });
  }

  async review(actor: Actor, revisionId: unknown, input: { decision: unknown; note: unknown }) {
    const id = uuid(revisionId, 'INVALID_REVISION_ID');
    if (input.decision !== 'APPROVED' && input.decision !== 'REJECTED')
      throw new ConfigurationRuleError('INVALID_DECISION');
    const decision: ReviewDecision = input.decision;
    return this.repository.review({
      revisionId: id,
      decision,
      note: reasonText(input.note),
      actor,
      auditId: this.newId(),
      now: this.clock.now(),
    });
  }

  activate(
    actor: Actor,
    revisionId: unknown,
    expectedVersion: unknown,
  ): Promise<ActivateResult | 'NOT_FOUND'> {
    const id = uuid(revisionId, 'INVALID_REVISION_ID');
    if (
      typeof expectedVersion !== 'number' ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0
    )
      throw new ConfigurationRuleError('EXPECTED_VERSION_REQUIRED');
    return this.repository.activate({
      revisionId: id,
      expectedVersion,
      actor,
      auditId: this.newId(),
      now: this.clock.now(),
    });
  }
}

export class ConfigurationQueries {
  constructor(private readonly repository: ConfigurationRepository) {}

  /** The effective value: the tenant's active revision, else the environment-wide one. */
  async effective(input: {
    namespace: unknown;
    key: unknown;
    environment: unknown;
    tenantId: unknown;
  }): Promise<Resolution> {
    const tenantScope = configScope(input);
    const environmentScope = { ...tenantScope, tenantScope: ALL_TENANTS };
    const [tenant, environmentWide] = await Promise.all([
      tenantScope.tenantScope === ALL_TENANTS ? null : this.repository.active(tenantScope),
      this.repository.active(environmentScope),
    ]);
    const view = (found: Awaited<ReturnType<ConfigurationRepository['active']>>) =>
      found && {
        scope: found.record.scope,
        revision: found.record.revision,
        value: found.record.value,
      };
    return resolve(view(tenant), view(environmentWide));
  }

  async history(input: {
    namespace: unknown;
    key: unknown;
    environment: unknown;
    tenantId: unknown;
    limit: unknown;
  }): Promise<readonly RevisionRecord[]> {
    const limit = input.limit === undefined ? 20 : Number(input.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_HISTORY)
      throw new ConfigurationRuleError('INVALID_LIMIT');
    return this.repository.history(configScope(input), limit);
  }
}
