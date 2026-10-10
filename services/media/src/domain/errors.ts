/**
 * Media domain errors. Codes are stable machine values; the transport maps them
 * onto the shared API error envelope. Messages are diagnostic English and never
 * carry personal data, object keys, URLs or signatures.
 */
export type MediaErrorCode =
  | 'INVALID_INPUT'
  | 'FORBIDDEN'
  | 'OBJECT_NOT_FOUND'
  | 'OBJECT_NOT_AVAILABLE'
  | 'UPLOAD_MISSING'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'STORAGE_UNAVAILABLE';

export class MediaError extends Error {
  constructor(
    readonly code: MediaErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MediaError';
  }
}

export function invalid(message: string): MediaError {
  return new MediaError('INVALID_INPUT', message);
}

/** The object store did not answer, timed out or failed: never treated as success. */
export function storageUnavailable(): MediaError {
  return new MediaError('STORAGE_UNAVAILABLE', 'The object store is unavailable.');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Opaque identifiers are UUIDs, compared and stored in lower case. */
export function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw invalid(`${field} must be a UUID.`);
  return value.toLowerCase();
}
