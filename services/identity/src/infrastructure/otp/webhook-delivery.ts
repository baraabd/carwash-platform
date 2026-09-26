import type { OtpDelivery } from '../../ports/identity.ports';

/** Deployment-supplied HTTPS delivery connector. There is no production fake adapter. */
export class WebhookOtpDelivery implements OtpDelivery {
  constructor(
    private readonly endpoint: URL,
    private readonly authorization: string,
  ) {
    if (
      endpoint.protocol !== 'https:' ||
      endpoint.username ||
      endpoint.password ||
      endpoint.hash ||
      !authorization ||
      /[\r\n]/.test(authorization)
    )
      throw new Error('INVALID_OTP_DELIVERY_CONFIG');
  }
  async deliver(input: Parameters<OtpDelivery['deliver']>[0]): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(3_000),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.authorization}`,
        'idempotency-key': `${input.challengeId}:${input.generation}`,
      },
      body: JSON.stringify({
        channel: 'email',
        recipient: input.recipient,
        code: input.code,
        expiresAt: input.expiresAt.toISOString(),
      }),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error('OTP_DELIVERY_UNAVAILABLE');
  }
}
