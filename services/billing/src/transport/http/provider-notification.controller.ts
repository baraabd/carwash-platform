import { Controller, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { billingV1 } from '@carwash/contracts';
import { createLogger } from '@carwash/service-kit';
import { ProviderPaymentsService } from '../../application';
import { PROVIDER_PAYMENTS_SERVICE } from './provider.controller';
import { BILLING_V1 } from './http-support';
import {
  notificationApplicationFailure,
  notificationHeaders,
  refuseNotification,
  type NotificationRequest,
  type NotificationResponse,
} from './provider-notification.http';

/** Canonical billing.v1 ingress. No provider is enabled by adding this route. */
@Controller(BILLING_V1)
export class ProviderNotificationController {
  private readonly logger = createLogger({ service: 'billing' });

  constructor(
    @Inject(PROVIDER_PAYMENTS_SERVICE) private readonly payments: ProviderPaymentsService,
  ) {}

  @Post('provider-notifications/:provider')
  async notification(
    @Param('provider') providerPath: string,
    @Req() request: NotificationRequest,
    @Res() response: NotificationResponse,
  ): Promise<void> {
    const ids = notificationHeaders(request, response);
    let provider: billingV1.PaymentProvider;
    try {
      provider = billingV1.parsePaymentProvider(providerPath);
    } catch {
      refuseNotification(response, ids, 404, 'NOT_FOUND');
      return;
    }
    const contentType = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
    if (contentType !== 'application/json' && contentType !== 'application/x-www-form-urlencoded') {
      refuseNotification(response, ids, 400, 'REQUEST_INVALID');
      return;
    }
    const raw = request.rawBody;
    if (!raw || raw.length === 0) {
      refuseNotification(response, ids, 400, 'REQUEST_INVALID');
      return;
    }
    if (raw.length > billingV1.PROVIDER_NOTIFICATION_MAX_BYTES) {
      refuseNotification(response, ids, 413, 'REQUEST_INVALID');
      return;
    }
    // Direct owner calls get the same credential isolation as Gateway calls.
    const headers: Record<string, string | undefined> = { 'content-type': contentType };
    for (const name of billingV1.PROVIDER_NOTIFICATION_HEADERS) {
      const value = request.headers[name];
      if (typeof value === 'string') headers[name] = value;
    }
    let status: number;
    try {
      const result = await this.payments.receiveNotification(
        provider.replaceAll('-', '_'),
        { rawBody: new Uint8Array(raw), headers },
        ids.correlationId,
      );
      if (![200, 201, 202].includes(result.status)) throw new Error('NOTIFICATION_OUTCOME_INVALID');
      // New, identical retry and authentic non-final notifications disclose no
      // financial data. Only the existing settlement rules can allocate money.
      response.status(204).end();
      status = 204;
    } catch (error: unknown) {
      status = notificationApplicationFailure(error, response, ids);
    }
    this.logger.info('billing_canonical_notification', {
      correlationId: ids.correlationId,
      status,
    });
  }
}
