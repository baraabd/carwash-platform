/**
 * Communications notification delivery rules.
 *
 * Pure domain: no Nest, Prisma, HTTP or broker types. The central rule is that
 * queued, submitted, accepted and delivered are different facts. A timeout or
 * an interrupted submission is UNKNOWN, never success and never a silent
 * resend, because the provider may already have sent the message.
 */

export const CHANNELS = ['SMS', 'PUSH', 'EMAIL'] as const;
export type Channel = (typeof CHANNELS)[number];

export const DELIVERY_STATES = [
  'QUEUED',
  'SENDING',
  'RETRY_WAIT',
  'UNKNOWN',
  'PROVIDER_ACCEPTED',
  'DELIVERED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const TERMINAL_STATES: ReadonlySet<DeliveryState> = new Set([
  'DELIVERED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
]);

export class NotificationRuleError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'NotificationRuleError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVICE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9:._-]{7,127}$/;
const TEMPLATE_KEY = /^[a-z][a-z0-9.-]{1,62}[a-z0-9]$/;
const PARAM_KEY = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/;
/** True when the text contains a C0 control character (tab/newline handling is the caller's). */
function hasControl(value: string, allowWhitespace = false): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 && !(allowWhitespace && (code === 0x09 || code === 0x0a || code === 0x0d)))
      return true;
  }
  return false;
}

export const MAX_PARAMETERS = 16;
export const MAX_PARAMETER_LENGTH = 256;
/** Upper bound on how long an intent may stay deliverable. */
export const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface DeliveryPolicy {
  readonly maxAttempts: number;
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
  readonly leaseMs: number;
}

export const DEFAULT_DELIVERY_POLICY: DeliveryPolicy = Object.freeze({
  maxAttempts: 5,
  baseBackoffMs: 2_000,
  maxBackoffMs: 300_000,
  leaseMs: 30_000,
});

/**
 * A request to notify. The recipient is an opaque reference resolved by an
 * authorized adapter at send time; raw phone numbers or addresses are never
 * stored, logged or put into events by this service.
 */
export interface NotificationRequest {
  readonly sourceService: string;
  readonly idempotencyKey: string;
  readonly recipientRef: string;
  readonly channel: Channel;
  readonly templateKey: string;
  readonly templateVersion: number;
  readonly parameters: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
}

function text(pattern: RegExp, value: unknown, code: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new NotificationRuleError(code);
  return value;
}

export function notificationRequest(input: {
  sourceService: unknown;
  idempotencyKey: unknown;
  recipientRef: unknown;
  channel: unknown;
  templateKey: unknown;
  templateVersion: unknown;
  parameters: unknown;
  expiresAt: unknown;
  now: Date;
}): NotificationRequest {
  const channel = input.channel;
  if (typeof channel !== 'string' || !CHANNELS.some((c) => c === channel))
    throw new NotificationRuleError('INVALID_CHANNEL');
  const version = input.templateVersion;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1)
    throw new NotificationRuleError('INVALID_TEMPLATE_VERSION');
  const expiresAt = input.expiresAt;
  if (!(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime()))
    throw new NotificationRuleError('INVALID_EXPIRY');
  const ttl = expiresAt.getTime() - input.now.getTime();
  if (ttl <= 0) throw new NotificationRuleError('ALREADY_EXPIRED');
  if (ttl > MAX_TTL_MS) throw new NotificationRuleError('EXPIRY_TOO_FAR');
  const raw = input.parameters;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    throw new NotificationRuleError('INVALID_PARAMETERS');
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_PARAMETERS) throw new NotificationRuleError('TOO_MANY_PARAMETERS');
  const parameters: Record<string, string> = {};
  for (const [key, value] of entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!PARAM_KEY.test(key)) throw new NotificationRuleError('INVALID_PARAMETER_KEY');
    if (typeof value !== 'string' || value.length > MAX_PARAMETER_LENGTH || hasControl(value))
      throw new NotificationRuleError('INVALID_PARAMETER_VALUE');
    parameters[key] = value;
  }
  return {
    sourceService: text(SERVICE, input.sourceService, 'INVALID_SOURCE_SERVICE'),
    idempotencyKey: text(IDEMPOTENCY_KEY, input.idempotencyKey, 'INVALID_IDEMPOTENCY_KEY'),
    recipientRef: text(UUID, input.recipientRef, 'INVALID_RECIPIENT_REF').toLowerCase(),
    channel: channel as Channel,
    templateKey: text(TEMPLATE_KEY, input.templateKey, 'INVALID_TEMPLATE_KEY'),
    templateVersion: version,
    parameters: Object.freeze(parameters),
    expiresAt: new Date(expiresAt.getTime()),
  };
}

/**
 * Canonical request text. The same idempotency key with a different
 * fingerprint is a conflict, so a template change can never silently resend.
 */
export function requestFingerprint(request: NotificationRequest): string {
  return JSON.stringify([
    request.sourceService,
    request.idempotencyKey,
    request.recipientRef,
    request.channel,
    request.templateKey,
    request.templateVersion,
    Object.entries(request.parameters),
    request.expiresAt.toISOString(),
  ]);
}

/** The provider-facing idempotency key: stable across every attempt of one intent. */
export function providerIdempotencyKey(notificationId: string): string {
  return `cw-notification:${notificationId}`;
}

/** Exponential backoff with full jitter; `random` is injected for determinism. */
export function backoffMs(attempt: number, policy: DeliveryPolicy, random: () => number): number {
  const ceiling = Math.min(
    policy.maxBackoffMs,
    policy.baseBackoffMs * 2 ** Math.max(0, attempt - 1),
  );
  const r = random();
  if (!(r >= 0 && r < 1)) throw new NotificationRuleError('INVALID_RANDOM');
  return Math.max(policy.baseBackoffMs, Math.floor(ceiling * r));
}

/** What the provider port reported for one submission. */
export type SubmissionOutcome =
  | { readonly kind: 'ACCEPTED'; readonly providerMessageId: string }
  | { readonly kind: 'REJECTED'; readonly code: string; readonly retryable: boolean }
  /** Proven not to have left this process (e.g. no provider configured). */
  | { readonly kind: 'NOT_SUBMITTED'; readonly code: string }
  /** Sent or possibly sent, with no answer: timeout, reset, 5xx. */
  | { readonly kind: 'AMBIGUOUS'; readonly code: string };

export interface Transition {
  readonly state: DeliveryState;
  readonly nextAttemptAt: Date | null;
  readonly providerMessageId: string | null;
  readonly errorCode: string | null;
}

/**
 * Decide the state after one submission attempt.
 *
 * AMBIGUOUS becomes UNKNOWN. It is only resubmitted when the provider honours
 * our idempotency key, because then a second submission cannot produce a
 * second message. Otherwise it waits for reconciliation.
 */
export function afterSubmission(input: {
  outcome: SubmissionOutcome;
  attempt: number;
  now: Date;
  expiresAt: Date;
  idempotentProvider: boolean;
  policy: DeliveryPolicy;
  random: () => number;
}): Transition {
  const { outcome, attempt, now, policy } = input;
  const retryAt = (code: string): Transition => {
    if (attempt >= policy.maxAttempts)
      return {
        state: 'FAILED',
        nextAttemptAt: null,
        providerMessageId: null,
        errorCode: `${code}:ATTEMPTS_EXHAUSTED`,
      };
    const at = new Date(now.getTime() + backoffMs(attempt, policy, input.random));
    if (at.getTime() >= input.expiresAt.getTime())
      return { state: 'EXPIRED', nextAttemptAt: null, providerMessageId: null, errorCode: code };
    return { state: 'RETRY_WAIT', nextAttemptAt: at, providerMessageId: null, errorCode: code };
  };
  switch (outcome.kind) {
    case 'ACCEPTED':
      return {
        state: 'PROVIDER_ACCEPTED',
        nextAttemptAt: null,
        providerMessageId: outcome.providerMessageId,
        errorCode: null,
      };
    case 'REJECTED':
      return outcome.retryable
        ? retryAt(outcome.code)
        : {
            state: 'FAILED',
            nextAttemptAt: null,
            providerMessageId: null,
            errorCode: outcome.code,
          };
    case 'NOT_SUBMITTED':
      return retryAt(outcome.code);
    case 'AMBIGUOUS':
      if (input.idempotentProvider) return retryAt(outcome.code);
      return {
        state: 'UNKNOWN',
        nextAttemptAt: null,
        providerMessageId: null,
        errorCode: outcome.code,
      };
  }
}

/** Provider receipts may arrive late and out of order; they never regress a fact. */
export function afterReceipt(
  current: DeliveryState,
  receipt: 'DELIVERED' | 'FAILED',
): DeliveryState | null {
  if (TERMINAL_STATES.has(current)) return null;
  if (current === 'PROVIDER_ACCEPTED' || current === 'UNKNOWN' || current === 'SENDING')
    return receipt;
  return null;
}

/** Only intents that never reached a provider may be cancelled. */
export function canCancel(state: DeliveryState): boolean {
  return state === 'QUEUED' || state === 'RETRY_WAIT';
}

/**
 * A SENDING intent whose lease expired belongs to a worker that stopped
 * mid-submission. Whether the provider received it is unknowable here, so it
 * is resubmitted only under the provider's idempotency key; otherwise it is
 * UNKNOWN and waits for reconciliation instead of risking a second message.
 */
export function afterLeaseExpiry(input: {
  idempotentProvider: boolean;
  attempt: number;
  maxAttempts: number;
}): 'RESUBMIT' | 'UNKNOWN' {
  return input.idempotentProvider && input.attempt < input.maxAttempts ? 'RESUBMIT' : 'UNKNOWN';
}
