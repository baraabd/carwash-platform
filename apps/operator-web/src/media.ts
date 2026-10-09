import { putBytes } from './api/client';
import { finalizeUpload, freshUploadUrl, readUrl, reserveUpload } from './api/operator-api';
import type { PresignedUpload } from './api/types';
import { S } from './state';

/**
 * Evidence images.
 *
 * Local processing keeps the reference `loadLocalPhoto` rules exactly:
 * JPEG/PNG/WebP only, 20 B..10 MiB, decode, at most 40 M decoded pixels,
 * white-backed re-encode to JPEG with the longest side <= 1000 px at quality
 * .76, and an encoded data URL no longer than 850000 characters.
 *
 * The result is then hashed with WebCrypto SHA-256 and sent through the C2
 * Media flow: reserve (Idempotency-Key) -> presigned PUT -> finalize
 * (Idempotency-Key). A failed or unknown PUT asks for a fresh `upload-url`
 * on the same reservation. Bytes, keys and object ids live only in memory.
 */

export type LocalPhotoError = 'type' | 'size' | 'empty' | 'decode';

export function checkFile(file: File): LocalPhotoError | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'type';
  if (file.size > 10 * 1024 * 1024) return 'size';
  if (file.size < 20) return 'empty';
  return null;
}

function decode(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('decode'));
    image.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

function dataUrlBytes(dataUrl: string): Uint8Array<ArrayBuffer> {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Reference processing; throws `Error('decode'|'dimensions'|'canvas'|'too-big')`. */
export async function processPhoto(file: File): Promise<Uint8Array<ArrayBuffer>> {
  const img = await decode(file);
  if (img.naturalWidth * img.naturalHeight > 40_000_000) throw new Error('dimensions');
  const scale = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL('image/jpeg', 0.76);
  if (data.length > 850000) throw new Error('too-big');
  return dataUrlBytes(data);
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** One upload intent; retried with the same reservation and keys. */
export interface UploadIntent {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly sha256: string;
  readonly reserveKey: string;
  finalizeKey: string;
  objectId: string | null;
  upload: PresignedUpload | null;
  stored: boolean;
}

export type UploadOutcome =
  | { readonly kind: 'available'; readonly objectId: string }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'failed'; readonly status: number; readonly code: string }
  | { readonly kind: 'unknown' };

async function putWithFallback(intent: UploadIntent): Promise<'ok' | 'failed' | 'unknown'> {
  if (!intent.objectId) return 'failed';
  const body = new Blob([intent.bytes], { type: 'image/jpeg' });
  if (intent.upload && Date.parse(intent.upload.expiresAt) > Date.now() + 5_000) {
    const first = await putBytes(intent.upload.url, intent.upload.headers, body);
    if (first === 'ok') return 'ok';
  }
  const fresh = await freshUploadUrl(intent.objectId);
  if (fresh.kind === 'unknown') return 'unknown';
  if (fresh.kind === 'error') return fresh.retryable ? 'unknown' : 'failed';
  intent.upload = fresh.value.upload;
  return putBytes(fresh.value.upload.url, fresh.value.upload.headers, body);
}

export async function runUpload(intent: UploadIntent): Promise<UploadOutcome> {
  if (!intent.objectId) {
    const reserved = await reserveUpload(
      { byteLength: intent.bytes.byteLength, sha256: intent.sha256 },
      intent.reserveKey,
    );
    if (reserved.kind === 'unknown') return { kind: 'unknown' };
    if (reserved.kind === 'error') {
      return reserved.retryable
        ? { kind: 'unknown' }
        : { kind: 'failed', status: reserved.status, code: reserved.code };
    }
    intent.objectId = reserved.value.objectId;
    intent.upload = reserved.value.upload;
    if (reserved.value.status === 'AVAILABLE') intent.stored = true;
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!intent.stored) {
      const put = await putWithFallback(intent);
      if (put === 'unknown') return { kind: 'unknown' };
      if (put === 'failed') return { kind: 'failed', status: 0, code: 'UPLOAD_FAILED' };
      intent.stored = true;
    }
    const finalized = await finalizeUpload(intent.objectId, intent.finalizeKey);
    if (finalized.kind === 'unknown') return { kind: 'unknown' };
    if (finalized.kind === 'error') {
      if (finalized.code === 'UPLOAD_MISSING' || finalized.reason === 'UPLOAD_MISSING') {
        intent.stored = false;
        intent.finalizeKey = crypto.randomUUID();
        continue;
      }
      return finalized.retryable
        ? { kind: 'unknown' }
        : { kind: 'failed', status: finalized.status, code: finalized.code };
    }
    if (finalized.value.status === 'AVAILABLE')
      return { kind: 'available', objectId: intent.objectId };
    if (finalized.value.status === 'REJECTED') return { kind: 'rejected' };
    return { kind: 'unknown' };
  }
  return { kind: 'failed', status: 409, code: 'UPLOAD_MISSING' };
}

/** Refresh short-lived read URLs (memory only) for the given objects. */
export async function ensureReadUrls(objectIds: readonly string[]): Promise<void> {
  const now = Date.now();
  await Promise.all(
    [...new Set(objectIds)].map(async (objectId) => {
      const cached = S.mediaUrls.get(objectId);
      if (cached && cached.expiresAt > now + 15_000) return;
      const result = await readUrl(objectId);
      if (result.kind === 'ok') {
        S.mediaUrls.set(objectId, {
          url: result.value.url,
          expiresAt: Date.parse(result.value.expiresAt),
        });
      } else {
        S.mediaUrls.delete(objectId);
      }
    }),
  );
}
