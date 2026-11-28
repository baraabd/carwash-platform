import type { IncomingMessage } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { RECEIPT_MAX_BYTES } from '../../infrastructure/provider/connector-receipts';

export const NOTIFICATION_RECEIPTS_V1 = '/internal/v1/communications/notification-receipts';
export interface ReceiptRequest extends IncomingMessage {
  readonly rawBody?: Buffer;
}
export interface ReceiptResponse {
  status(code: number): ReceiptResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): unknown;
  end(): void;
}

function receiptPath(request: IncomingMessage): boolean {
  return (
    request.method === 'POST' &&
    /^\/internal\/v1\/communications\/notification-receipts\/?(?:\?.*)?$/i.test(request.url ?? '')
  );
}

export function refuseReceipt(response: ReceiptResponse, status: number, code: string): void {
  response.setHeader('cache-control', 'no-store');
  response
    .status(status)
    .json({ error: { code, message: 'The notification receipt could not be accepted.' } });
}

/** Exact bytes are bounded before parsing; compression cannot bypass the bound. */
export function configureNotificationReceiptTransport(app: NestExpressApplication): void {
  app.useBodyParser('raw', { type: receiptPath, limit: RECEIPT_MAX_BYTES, inflate: false });
  app.use(
    (
      error: unknown,
      request: ReceiptRequest,
      response: ReceiptResponse,
      next: (error: unknown) => void,
    ) => {
      if (!receiptPath(request)) return next(error);
      const status =
        typeof error === 'object' && error !== null && 'status' in error ? error.status : null;
      refuseReceipt(
        response,
        status === 413 ? 413 : status === 400 || status === 415 ? 400 : 500,
        status === 413 || status === 400 || status === 415
          ? 'RECEIPT_REQUEST_INVALID'
          : 'INTERNAL_ERROR',
      );
    },
  );
}
