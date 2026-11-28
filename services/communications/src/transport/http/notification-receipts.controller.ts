import { Controller, Inject, Post, Req, Res } from '@nestjs/common';
import { NotificationAdministration } from '../../application/notification.service';
import {
  ConnectorReceiptVerifier,
  ReceiptIngressError,
} from '../../infrastructure/provider/connector-receipts';
import {
  NOTIFICATION_RECEIPTS_V1,
  refuseReceipt,
  type ReceiptRequest,
  type ReceiptResponse,
} from './notification-receipts.http';

export const RECEIPT_VERIFIER = 'COMMUNICATIONS_RECEIPT_VERIFIER';

/** Service ingress for a trusted connector; browser sessions never authorize receipts. */
@Controller(NOTIFICATION_RECEIPTS_V1)
export class NotificationReceiptsController {
  constructor(
    private readonly administration: NotificationAdministration,
    @Inject(RECEIPT_VERIFIER) private readonly verifier: ConnectorReceiptVerifier | null,
  ) {}

  @Post()
  async receive(@Req() request: ReceiptRequest, @Res() response: ReceiptResponse): Promise<void> {
    response.setHeader('cache-control', 'no-store');
    if (!this.verifier) return refuseReceipt(response, 503, 'RECEIPT_NOT_CONFIGURED');
    if (
      request.url?.includes('?') ||
      request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json' ||
      !request.rawBody?.length
    )
      return refuseReceipt(response, 400, 'RECEIPT_REQUEST_INVALID');
    const headers: Record<string, string | undefined> = {};
    for (const name of [
      'x-provider-signature',
      'x-provider-timestamp',
      'x-provider-notification-id',
    ]) {
      const value = request.headers[name];
      if (typeof value === 'string') headers[name] = value;
    }
    try {
      const receipt = this.verifier.verify({ rawBody: request.rawBody, headers, now: new Date() });
      const result = await this.administration.recordReceipt(receipt);
      if (result === 'NOT_FOUND') return refuseReceipt(response, 404, 'RECEIPT_TARGET_UNKNOWN');
      if (result === 'CORRELATION_PENDING' || result === 'CONFLICT')
        return refuseReceipt(
          response,
          409,
          result === 'CONFLICT' ? 'RECEIPT_CONFLICT' : 'RECEIPT_CORRELATION_PENDING',
        );
      response.status(204).end();
    } catch (error: unknown) {
      if (error instanceof ReceiptIngressError)
        return refuseReceipt(response, error.status, error.message);
      // Never expose provider IDs, raw payloads, signatures, tokens or DB errors.
      refuseReceipt(response, 503, 'RECEIPT_UNAVAILABLE');
    }
  }
}
