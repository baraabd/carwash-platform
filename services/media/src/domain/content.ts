import { invalid } from './errors';

/**
 * Accepted evidence formats and their byte-level signatures.
 *
 * The rules mirror the approved technician reference (`loadLocalPhoto()`):
 * JPEG, PNG or WebP, at least 20 bytes and at most 10 MiB. The declared
 * content type is a claim of the uploader; the stored bytes are sniffed and
 * must agree with it. Sniffing is NOT malware scanning and does not decode,
 * re-encode or strip metadata (EXIF) from the image.
 */
export const CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const PURPOSES = ['WORK_EVIDENCE'] as const;
export type Purpose = (typeof PURPOSES)[number];

export const BYTE_LIMITS = Object.freeze({ min: 20, max: 10 * 1024 * 1024 });

/** Bytes needed to recognise every accepted signature. */
export const SNIFF_BYTES = 12;

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function isContentType(value: unknown): value is ContentType {
  return typeof value === 'string' && CONTENT_TYPES.some((type) => type === value);
}

export function isPurpose(value: unknown): value is Purpose {
  return typeof value === 'string' && PURPOSES.some((purpose) => purpose === value);
}

export interface DeclaredUpload {
  readonly purpose: Purpose;
  readonly contentType: ContentType;
  readonly byteLength: number;
  /** Lower-case hex SHA-256 of the exact bytes the client will upload. */
  readonly sha256: string;
}

/** Validates a reservation request; values are normalised, never guessed. */
export function declaredUpload(input: {
  readonly purpose: unknown;
  readonly contentType: unknown;
  readonly byteLength: unknown;
  readonly sha256: unknown;
}): DeclaredUpload {
  if (!isPurpose(input.purpose)) throw invalid('purpose is not supported.');
  if (!isContentType(input.contentType)) throw invalid('contentType is not supported.');
  const length = input.byteLength;
  if (
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length < BYTE_LIMITS.min ||
    length > BYTE_LIMITS.max
  ) {
    throw invalid('byteLength is outside the allowed range.');
  }
  if (typeof input.sha256 !== 'string' || !SHA256_HEX.test(input.sha256)) {
    throw invalid('sha256 must be 64 lower-case hex characters.');
  }
  return {
    purpose: input.purpose,
    contentType: input.contentType,
    byteLength: length,
    sha256: input.sha256,
  };
}

/** Content type implied by the leading bytes, or null when none matches. */
export function sniffContentType(head: Uint8Array): ContentType | null {
  const at = (index: number): number => head[index] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, index) => at(index) === byte)) return 'image/png';
  const ascii = (from: number, text: string): boolean =>
    [...text].every((char, index) => at(from + index) === char.charCodeAt(0));
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  return null;
}

/** What the server observed when it read the stored upload back. */
export interface ObservedUpload {
  /** Bytes actually stored (the read stops after `declared + 1`). */
  readonly byteLength: number;
  /** SHA-256 of the observed bytes, lower-case hex. */
  readonly sha256: string;
  /** Leading bytes, at least SNIFF_BYTES when the object is that long. */
  readonly head: Uint8Array;
}

export const REJECT_REASONS = ['UPLOAD_MISMATCH', 'UNSUPPORTED_MEDIA'] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export type Verification =
  { readonly ok: true } | { readonly ok: false; readonly reason: RejectReason };

/**
 * Exact length and digest first (the bytes are not the ones declared), then
 * the signature (the declared bytes are not the declared format).
 */
export function verifyUpload(declared: DeclaredUpload, observed: ObservedUpload): Verification {
  if (observed.byteLength !== declared.byteLength || observed.sha256 !== declared.sha256) {
    return { ok: false, reason: 'UPLOAD_MISMATCH' };
  }
  if (sniffContentType(observed.head) !== declared.contentType) {
    return { ok: false, reason: 'UNSUPPORTED_MEDIA' };
  }
  return { ok: true };
}
