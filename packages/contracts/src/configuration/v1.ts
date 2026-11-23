import type { OwnerContract } from '../common/route';
import { CURRENCIES, type Currency } from '../common/money';
import { parseRevision } from '../common/protocol';
import {
  BUSINESS_TIME_ZONES,
  parseUtc,
  type BusinessTimeZone,
  type UtcTimestamp,
} from '../common/time';
import { ContractViolation, closed, integer, oneOf, text, uuid } from '../common/wire';

/**
 * configuration.v1 — owner: Configuration service (Lane D).
 * Versioned, approved market policy read by other owners. Namespaces and their
 * content shapes are closed; a new namespace or field is a contract change.
 *
 * Owner rules (not expressible on the wire): the approver of a draft must be a
 * different principal than its author (SELF_APPROVAL_FORBIDDEN); only approved
 * drafts are publishable (DRAFT_NOT_APPROVED); a consumer that cannot read a
 * current policy fails closed (POLICY_UNAVAILABLE), never falls back to defaults.
 */
export const CONFIGURATION_V1 = {
  id: 'configuration.v1',
  owner: 'configuration',
  prefix: '/internal/v1/configuration',
  routes: {
    getCurrent: {
      method: 'GET',
      path: '/scopes/:marketId/:namespace/current',
      access: 'service:configuration.read',
    },
    createDraft: {
      method: 'POST',
      path: '/scopes/:marketId/:namespace/drafts',
      access: 'permission:configuration.write',
      idempotent: true,
    },
    approveDraft: {
      method: 'POST',
      path: '/drafts/:draftId/approve',
      access: 'permission:configuration.approve',
      idempotent: true,
    },
    publishDraft: {
      method: 'POST',
      path: '/drafts/:draftId/publish',
      access: 'permission:configuration.publish',
      idempotent: true,
    },
  },
  reasons: ['POLICY_UNAVAILABLE', 'SELF_APPROVAL_FORBIDDEN', 'DRAFT_NOT_APPROVED'],
} as const satisfies OwnerContract;

export const CONFIGURATION_NAMESPACES = ['booking.policy.v1', 'market.presentation.v1'] as const;
export type ConfigurationNamespace = (typeof CONFIGURATION_NAMESPACES)[number];

const MARKET_ID = /^[a-z]{2}(-[a-z0-9]{2,8})?$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
export const SLOT_STEPS = [15, 30, 60] as const;

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
  readonly defaultLocale: 'ar' | 'en';
  readonly timezone: BusinessTimeZone;
}

export type ConfigurationContentV1 =
  | { readonly namespace: 'booking.policy.v1'; readonly content: BookingPolicyV1 }
  | { readonly namespace: 'market.presentation.v1'; readonly content: MarketPresentationV1 };

export type PublishedConfigurationV1 = ConfigurationContentV1 & {
  readonly marketId: string;
  readonly version: number;
  readonly effectiveAt: UtcTimestamp;
  readonly contentHash: string;
};

export interface CreateDraftRequestV1 {
  /** Current published version the draft is based on; null for the first version. */
  readonly expectedVersion: number | null;
  readonly content: ConfigurationContentV1;
}

export function parseMarketId(value: unknown, path: string): string {
  return text(value, path, { max: 11, pattern: MARKET_ID });
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
  if (slotStepMinutes === undefined) {
    throw new ContractViolation('INVALID_ENUM', `${path}.slotStepMinutes`);
  }
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
    currency: oneOf(v.currency, `${path}.currency`, Object.keys(CURRENCIES) as Currency[]),
    defaultLocale: oneOf(v.defaultLocale, `${path}.defaultLocale`, ['ar', 'en'] as const),
    timezone: oneOf(v.timezone, `${path}.timezone`, BUSINESS_TIME_ZONES),
  };
}

export function parseConfigurationContentV1(
  namespaceValue: unknown,
  contentValue: unknown,
  path: string,
): ConfigurationContentV1 {
  const namespace = parseNamespace(namespaceValue, `${path}.namespace`);
  if (namespace === 'booking.policy.v1') {
    return { namespace, content: parseBookingPolicyV1(contentValue, `${path}.content`) };
  }
  return { namespace, content: parseMarketPresentationV1(contentValue, `${path}.content`) };
}

export function parsePublishedConfigurationV1(
  value: unknown,
  path = '$',
): PublishedConfigurationV1 {
  const v = closed(value, path, [
    'marketId',
    'namespace',
    'version',
    'effectiveAt',
    'contentHash',
    'content',
  ]);
  return {
    marketId: parseMarketId(v.marketId, `${path}.marketId`),
    version: parseRevision(v.version, `${path}.version`),
    effectiveAt: parseUtc(v.effectiveAt, `${path}.effectiveAt`),
    contentHash: text(v.contentHash, `${path}.contentHash`, {
      min: 64,
      max: 64,
      pattern: SHA256_HEX,
    }),
    ...parseConfigurationContentV1(v.namespace, v.content, path),
  };
}

/** Namespace comes from the route (:namespace), the body carries only content. */
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

export function parseDraftId(value: unknown, path: string): string {
  return uuid(value, path);
}

/** Body of approve/publish: optimistic concurrency on the draft. */
export interface DraftTransitionRequestV1 {
  readonly expectedRevision: number;
}

export function parseDraftTransitionRequestV1(value: unknown): DraftTransitionRequestV1 {
  const v = closed(value, '$', ['expectedRevision']);
  return { expectedRevision: parseRevision(v.expectedRevision, '$.expectedRevision') };
}
