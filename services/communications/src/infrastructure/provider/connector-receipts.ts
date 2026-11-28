import { createHash, timingSafeEqual } from 'node:crypto';
import { constants, closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import {
  PROVIDER_NOTIFICATION_ID_HEADER,
  PROVIDER_SIGNATURE_HEADER,
  PROVIDER_TIMESTAMP_HEADER,
  verifyProviderSignature,
} from '@carwash/service-kit';
import { providerIdempotencyKey } from '../../domain/notification';
import type { VerifiedNotificationReceipt } from '../../ports/notification.ports';

export const RECEIPT_SCHEMA = 'carwash.notification-receipt/v1';
export const RECEIPT_MAX_BYTES = 4_096;
const CONNECTOR_ID = /^[a-z][a-z0-9._-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MESSAGE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export class ReceiptIngressError extends Error {
  constructor(readonly status: 400 | 401 | 503) {
    super(
      status === 401
        ? 'RECEIPT_AUTH_REQUIRED'
        : status === 503
          ? 'RECEIPT_NOT_CONFIGURED'
          : 'RECEIPT_REQUEST_INVALID',
    );
  }
}

/**
 * Authenticates our deployment-owned connector, not an SMS vendor. That
 * connector must verify the vendor's authentic delivery evidence first.
 */
export class ConnectorReceiptVerifier {
  constructor(
    private readonly connectorId: string,
    private readonly secret: Buffer,
  ) {
    if (!CONNECTOR_ID.test(connectorId) || secret.length < 32 || secret.length > 256)
      throw new Error('RECEIPT_CONFIG_INVALID');
  }

  verify(input: {
    readonly rawBody: Buffer;
    readonly headers: Readonly<Record<string, string | undefined>>;
    readonly now: Date;
  }): VerifiedNotificationReceipt {
    const verified = verifyProviderSignature({
      rawBody: input.rawBody,
      signature: input.headers[PROVIDER_SIGNATURE_HEADER],
      timestamp: input.headers[PROVIDER_TIMESTAMP_HEADER],
      notificationId: input.headers[PROVIDER_NOTIFICATION_ID_HEADER],
      secrets: [this.secret],
      now: input.now,
      toleranceSeconds: 300,
      maxBytes: RECEIPT_MAX_BYTES,
    });
    if (!verified.ok) throw new ReceiptIngressError(401);
    let value: unknown;
    try {
      value = JSON.parse(input.rawBody.toString('utf8')) as unknown;
    } catch {
      throw new ReceiptIngressError(400);
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      throw new ReceiptIngressError(400);
    const body = value as Record<string, unknown>;
    if (
      Object.keys(body).sort().join(',') !==
        'connectorId,notificationId,providerMessageId,receipt,schema,submissionKey' ||
      body.schema !== RECEIPT_SCHEMA ||
      typeof body.notificationId !== 'string' ||
      !UUID.test(body.notificationId) ||
      typeof body.providerMessageId !== 'string' ||
      !MESSAGE_ID.test(body.providerMessageId) ||
      (body.receipt !== 'DELIVERED' && body.receipt !== 'FAILED') ||
      body.submissionKey !== providerIdempotencyKey(body.notificationId)
    )
      throw new ReceiptIngressError(400);
    if (body.connectorId !== this.connectorId) throw new ReceiptIngressError(401);
    return {
      connectorId: this.connectorId,
      receiptId: verified.notificationId,
      notificationId: body.notificationId,
      providerMessageId: body.providerMessageId,
      receipt: body.receipt,
      payloadHash: createHash('sha256').update(input.rawBody).digest('hex'),
      signedAt: verified.signedAt,
    };
  }
}

/** One bounded descriptor, no symlink, no group writes or world access. */
function signingKey(file: string): Buffer {
  if (!isAbsolute(file)) throw new Error('RECEIPT_KEY_FILE_INVALID');
  let fd: number | undefined;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(fd);
    if (!info.isFile() || (info.mode & 0o027) !== 0 || info.size < 32 || info.size > 256)
      throw new Error('RECEIPT_KEY_FILE_INVALID');
    const bytes = Buffer.alloc(257);
    const size = readSync(fd, bytes, 0, bytes.length, 0);
    if (size < 32 || size > 256) throw new Error('RECEIPT_KEY_FILE_INVALID');
    return Buffer.from(bytes.subarray(0, size));
  } catch {
    throw new Error('RECEIPT_KEY_FILE_INVALID');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Missing ingress configuration refuses requests; partial/unsafe config aborts startup. */
export function receiptVerifierFromEnv(env: NodeJS.ProcessEnv): ConnectorReceiptVerifier | null {
  if (env.NOTIFICATION_RECEIPT_SIGNING_KEY !== undefined)
    throw new Error('RECEIPT_DIRECT_SECRET_REFUSED');
  const file = env.NOTIFICATION_RECEIPT_SIGNING_KEY_FILE;
  const connectorId = env.NOTIFICATION_RECEIPT_CONNECTOR_ID;
  if (!file && !connectorId) return null;
  if (!file || !connectorId || !CONNECTOR_ID.test(connectorId))
    throw new Error('RECEIPT_CONFIG_INVALID');
  const key = signingKey(file);
  const outbound = env.NOTIFICATION_PROVIDER_TOKEN;
  if (outbound !== undefined) {
    const token = Buffer.from(outbound);
    if (token.length === key.length && timingSafeEqual(token, key))
      throw new Error('RECEIPT_KEY_REUSE_REFUSED');
  }
  return new ConnectorReceiptVerifier(connectorId, key);
}
