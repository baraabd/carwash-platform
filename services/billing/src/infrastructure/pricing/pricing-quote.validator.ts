import { SERVICE_CLIENT_HEADER, SERVICE_TOKEN_HEADER, readSecret } from '@carwash/service-kit';
import { Money } from '../../domain';
import {
  QuoteUnavailable,
  type PrincipalRef,
  type QuoteValidation,
  type QuoteValidator,
} from '../../ports';
import { boundedText, type UpstreamConfig } from '../http/bounded-fetch';

/**
 * Validates a quote through the PUBLISHED pricing.v1 `validateQuote` route
 * (`POST /internal/v1/pricing/quotes/:quoteId/validate`, access
 * `service:pricing.quote.validate`, safe) on Billing's own workload credential,
 * for the booking's beneficiary with purpose `booking-create`.
 *
 * billing.v1 `CreateBookingObligationRequestV1` carries no quote revision, while
 * `ValidateQuoteRequestV1` requires `expectedRevision`. Quotes are issued at
 * revision 1; when Pricing answers REVISION_MISMATCH the answer names the
 * current revision and ONE more safe call validates that revision. Requested
 * from Lane E as CR-B-09 (carry `quoteRevision` in the booking request).
 *
 * The answer is checked exactly against `QuoteValidationV1` (closed object,
 * `valid` iff `reason` is null, Money with explicit scale). 404, 422 and every
 * negative reason are NOT_USABLE; any other status (including 401/403, which
 * means Billing's own credential was refused), a timeout or a malformed body is
 * QuoteUnavailable. Never a guessed amount, never success on timeout.
 */
export const PRICING_VALIDATE_SUFFIX = '/validate';
const PRICING_QUOTES = '/internal/v1/pricing/quotes/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CLIENT_ID = /^[a-z][a-z0-9-]{1,63}$/;
const REASONS = ['QUOTE_EXPIRED', 'QUOTE_REVOKED', 'REVISION_MISMATCH', 'BENEFICIARY_MISMATCH'];
const MAX_REVISION = 2_147_483_647;
export const PRICING_CLIENT_ID_ENV = 'BILLING_PRICING_CLIENT_ID';
export const PRICING_TOKEN_SECRET = 'BILLING_PRICING_SERVICE_TOKEN';

export interface WorkloadCredential {
  readonly clientId: string;
  readonly token: string;
}

/** Null when not configured: every booking-saga create then fails closed (503). */
export function pricingCredentialFromEnv(env: NodeJS.ProcessEnv): WorkloadCredential | null {
  const token = readSecret(PRICING_TOKEN_SECRET, env);
  if (!token) return null;
  const clientId = env[PRICING_CLIENT_ID_ENV] ?? 'billing';
  if (!CLIENT_ID.test(clientId)) throw new Error(`${PRICING_CLIENT_ID_ENV}_INVALID`);
  return { clientId, token: token.toString('utf8') };
}

type Parsed =
  | { readonly valid: true; readonly total: Money }
  | { readonly valid: false; readonly reason: string; readonly revision: number };

function parseValidation(value: unknown, quoteId: string): Parsed | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).sort().join(',') !== 'quoteId,reason,revision,total,valid') return null;
  const { revision, valid, reason } = body;
  if (body.quoteId !== quoteId) return null;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) return null;
  if (revision >= MAX_REVISION || typeof valid !== 'boolean') return null;
  if (reason !== null && (typeof reason !== 'string' || !REASONS.includes(reason))) return null;
  if (valid !== (reason === null)) return null;
  let total: Money;
  try {
    total = Money.parse(body.total);
  } catch {
    return null;
  }
  return reason === null ? { valid: true, total } : { valid: false, reason, revision };
}

export class PricingQuoteValidator implements QuoteValidator {
  constructor(
    private readonly config: UpstreamConfig,
    private readonly credential: WorkloadCredential | null,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async validate(
    quoteId: string,
    beneficiary: PrincipalRef,
    correlationId: string,
  ): Promise<QuoteValidation> {
    if (!UUID.test(quoteId)) throw new QuoteUnavailable();
    const first = await this.call(quoteId, 1, beneficiary, correlationId);
    if (first === 'NOT_FOUND') return { kind: 'NOT_USABLE' };
    if (first.valid) return { kind: 'VALID', total: first.total };
    if (first.reason !== 'REVISION_MISMATCH' || first.revision === 1) return { kind: 'NOT_USABLE' };
    const second = await this.call(quoteId, first.revision, beneficiary, correlationId);
    if (second === 'NOT_FOUND' || !second.valid) return { kind: 'NOT_USABLE' };
    return { kind: 'VALID', total: second.total };
  }

  private async call(
    quoteId: string,
    expectedRevision: number,
    beneficiary: PrincipalRef,
    correlationId: string,
  ): Promise<Parsed | 'NOT_FOUND'> {
    if (!this.config.origin || !this.credential) throw new QuoteUnavailable();
    let response: Response;
    try {
      response = await this.fetcher(
        new URL(PRICING_QUOTES + quoteId + PRICING_VALIDATE_SUFFIX, this.config.origin),
        {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            [SERVICE_CLIENT_HEADER]: this.credential.clientId,
            [SERVICE_TOKEN_HEADER]: this.credential.token,
            'x-correlation-id': correlationId,
          },
          body: JSON.stringify({
            expectedRevision,
            beneficiary: { kind: beneficiary.kind, subjectId: beneficiary.subjectId },
            purpose: 'booking-create',
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(this.config.timeoutMs),
        },
      );
    } catch {
      throw new QuoteUnavailable();
    }
    // 404 (no such quote) and 422 (a business-rule rejection) are definite answers.
    if (response.status === 404 || response.status === 422) {
      await response.body?.cancel();
      return 'NOT_FOUND';
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new QuoteUnavailable();
    }
    let parsed: Parsed | null;
    try {
      const text = await boundedText(response);
      parsed = text === null ? null : parseValidation(JSON.parse(text), quoteId);
    } catch {
      parsed = null;
    }
    if (!parsed) throw new QuoteUnavailable();
    return parsed;
  }
}
