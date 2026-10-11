import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Money, normalizeProviderReference, type ProviderId } from '../../src/domain';
import {
  NotificationRejected,
  type AuthenticatedNotification,
  type CreditQueryResult,
  type InboundNotification,
  type PaymentProviderAdapter,
  type ProviderCapabilities,
  type ProviderDiagnostics,
  type RefundInstruction,
  type RefundProviderAnswer,
} from '../../src/ports';
import type { SecretValue } from '../../src/infrastructure/providers/secret-value';
import { accountsFingerprint } from '../../src/infrastructure/providers/merchant-providers';

/**
 * DETERMINISTIC FAKE PROVIDER — TEST DOUBLE ONLY, never wired in production and
 * never acceptance evidence for ShamCash or Syriatel Cash. It exercises
 * Billing's provider-neutral paths that a real, officially documented adapter
 * would use: authenticated notifications (an HMAC-SHA256 scheme invented for
 * this double, NOT a provider protocol), verified queries and an idempotent
 * refund API, plus programmable failures (timeouts, lost answers).
 */
export const FAKE_TIMESTAMP_HEADER = 'x-fake-provider-timestamp';
export const FAKE_SIGNATURE_HEADER = 'x-fake-provider-signature';
const WINDOW_MS = 5 * 60_000;
const MAX_BODY = 16 * 1024;

export type FakeQueryAnswer = CreditQueryResult | 'THROW';
export type FakeRefundMode = 'SUCCEED' | 'PEND' | 'FAIL' | 'TIMEOUT' | 'LOSE_ANSWER' | 'THROW';

export interface FakeCredit {
  readonly merchantAccount: string;
  readonly reference: string;
  readonly amount: Money;
  readonly occurredAt: Date;
}

function digest(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export class FakeSignedProvider implements PaymentProviderAdapter {
  readonly capabilities: ProviderCapabilities = Object.freeze({
    notifications: true,
    creditQuery: true,
    refunds: 'PROVIDER_API',
    statementEvidence: true,
  });
  /** Programmed query answers by normalised reference (default NOT_FOUND). */
  readonly queries = new Map<string, FakeQueryAnswer>();
  /** Programmed refund behaviour by refund id (default SUCCEED). */
  readonly refundModes = new Map<string, FakeRefundMode>();
  /** Money the fake actually paid out, once per refund id (idempotency proof). */
  readonly paidOut = new Map<string, Money>();
  readonly submissions: string[] = [];
  readonly statusChecks: string[] = [];
  private readonly accounts: ReadonlySet<string>;

  constructor(
    readonly provider: ProviderId,
    private readonly merchantAccounts: readonly string[],
    private readonly secret: SecretValue,
  ) {
    this.accounts = new Set(merchantAccounts);
  }

  acceptsMerchantAccount(account: string): boolean {
    return this.accounts.has(account);
  }

  /** Builds a signed notification exactly as this fake expects it. */
  sign(
    body: Readonly<Record<string, unknown>>,
    at: Date,
    secret: SecretValue = this.secret,
  ): { readonly raw: string; readonly headers: Record<string, string> } {
    const raw = JSON.stringify(body);
    const timestamp = String(at.getTime());
    const signature = createHmac('sha256', secret.reveal())
      .update(`${timestamp}.${raw}`)
      .digest('hex');
    return {
      raw,
      headers: { [FAKE_TIMESTAMP_HEADER]: timestamp, [FAKE_SIGNATURE_HEADER]: signature },
    };
  }

  static creditBody(credit: FakeCredit, type = 'credit.final'): Record<string, unknown> {
    return {
      type,
      merchantAccount: credit.merchantAccount,
      reference: credit.reference,
      amount: credit.amount.toWire(),
      occurredAt: credit.occurredAt.toISOString(),
    };
  }

  authenticateNotification(
    notification: InboundNotification,
    now: Date,
  ): Promise<AuthenticatedNotification> {
    try {
      return Promise.resolve(this.authenticate(notification, now));
    } catch {
      return Promise.reject(new NotificationRejected());
    }
  }

  private authenticate(notification: InboundNotification, now: Date): AuthenticatedNotification {
    const { rawBody, headers } = notification;
    if (rawBody.byteLength === 0 || rawBody.byteLength > MAX_BODY) throw new Error('BODY');
    const timestamp = headers[FAKE_TIMESTAMP_HEADER];
    const signature = headers[FAKE_SIGNATURE_HEADER];
    if (
      !timestamp ||
      !/^\d{1,16}$/.test(timestamp) ||
      !signature ||
      !/^[0-9a-f]{64}$/.test(signature)
    )
      throw new Error('HEADERS');
    if (Math.abs(now.getTime() - Number(timestamp)) > WINDOW_MS) throw new Error('REPLAY_WINDOW');
    const raw = Buffer.from(rawBody).toString('utf8');
    const expected = createHmac('sha256', this.secret.reveal())
      .update(`${timestamp}.${raw}`)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new Error('SIGNATURE');
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (body.type === 'credit.pending') return { kind: 'IGNORED' };
    if (body.type !== 'credit.final') throw new Error('TYPE');
    const reference = normalizeProviderReference(body.reference);
    if (
      !reference ||
      typeof body.merchantAccount !== 'string' ||
      typeof body.occurredAt !== 'string'
    )
      throw new Error('FIELDS');
    const occurredAt = new Date(body.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) throw new Error('TIME');
    return {
      kind: 'CREDIT_FINAL',
      fact: {
        merchantAccount: body.merchantAccount,
        reference,
        amount: Money.parse(body.amount),
        occurredAt,
      },
      evidenceDigest: digest(rawBody),
    };
  }

  /** Programs a FOUND_FINAL answer for a credit. */
  found(credit: FakeCredit): void {
    const reference = normalizeProviderReference(credit.reference);
    if (!reference) throw new Error('FAKE_REFERENCE_INVALID');
    this.queries.set(reference, {
      kind: 'FOUND_FINAL',
      fact: { ...credit, reference },
      evidenceDigest: digest(JSON.stringify(FakeSignedProvider.creditBody(credit))),
    });
  }

  queryCredit(reference: string): Promise<CreditQueryResult> {
    const answer = this.queries.get(reference) ?? { kind: 'NOT_FOUND' };
    if (answer === 'THROW') return Promise.reject(new Error('FAKE_PROVIDER_TRANSPORT'));
    return Promise.resolve(answer);
  }

  submitRefund(instruction: RefundInstruction): Promise<RefundProviderAnswer> {
    this.submissions.push(instruction.refundId);
    const mode = this.refundModes.get(instruction.refundId) ?? 'SUCCEED';
    if (mode === 'THROW') return Promise.reject(new Error('FAKE_PROVIDER_TRANSPORT'));
    if (mode === 'TIMEOUT')
      return Promise.resolve({ outcome: 'UNKNOWN', providerRefundReference: null });
    if (mode === 'FAIL')
      return Promise.resolve({ outcome: 'FAILED', providerRefundReference: null });
    // Idempotent on the Billing refund id: money moves at most once.
    if (!this.paidOut.has(instruction.refundId))
      this.paidOut.set(instruction.refundId, instruction.amount);
    if (mode === 'PEND')
      return Promise.resolve({ outcome: 'PENDING', providerRefundReference: null });
    if (mode === 'LOSE_ANSWER')
      return Promise.resolve({ outcome: 'UNKNOWN', providerRefundReference: null });
    return Promise.resolve({
      outcome: 'SUCCEEDED',
      providerRefundReference: this.refundRef(instruction),
    });
  }

  refundStatus(instruction: RefundInstruction): Promise<RefundProviderAnswer> {
    this.statusChecks.push(instruction.refundId);
    if (this.paidOut.has(instruction.refundId))
      return Promise.resolve({
        outcome: 'SUCCEEDED',
        providerRefundReference: this.refundRef(instruction),
      });
    const mode = this.refundModes.get(instruction.refundId);
    if (mode === 'FAIL')
      return Promise.resolve({ outcome: 'FAILED', providerRefundReference: null });
    return Promise.resolve({ outcome: 'UNKNOWN', providerRefundReference: null });
  }

  private refundRef(instruction: RefundInstruction): string {
    return `RF${instruction.refundId.replaceAll('-', '').slice(0, 20).toUpperCase()}`;
  }

  diagnostics(): ProviderDiagnostics {
    return {
      provider: this.provider,
      integration: 'SANDBOX',
      capabilities: { ...this.capabilities },
      merchantAccountCount: this.accounts.size,
      merchantAccountsFingerprint: accountsFingerprint(this.merchantAccounts),
      secretsConfigured: [this.secret.name],
    };
  }
}
