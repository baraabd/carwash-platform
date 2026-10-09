import { DispatchError } from '../../domain';
import type { EvidenceObject, EvidenceObjects } from '../../ports';
import type { ServiceHttp } from '../http/service-http';

/**
 * Consumer of the REQUESTED media.v1 (interface spec C2, CR-P03-C2): object
 * read with `media.object.read` and idempotent claims with
 * `media.object.claim`. Producer-pending: nothing here treats the shape as
 * published; parity with the Media provider is proven only in the P03-C
 * merge candidate. Any failure is EVIDENCE_UNAVAILABLE (503).
 */
const PREFIX = '/internal/v1/media/objects';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unavailable(): DispatchError {
  return new DispatchError('EVIDENCE_UNAVAILABLE', 'Evidence storage is unavailable.');
}

/** Reads only the fields Dispatch needs; the rest of ObjectView is ignored. */
export function parseEvidenceObject(body: unknown): EvidenceObject {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw unavailable();
  const { objectId, status, purpose, contentType, ownerSubjectId } = body as Record<
    string,
    unknown
  >;
  if (
    typeof objectId !== 'string' ||
    !UUID.test(objectId) ||
    typeof status !== 'string' ||
    typeof purpose !== 'string' ||
    typeof contentType !== 'string' ||
    typeof ownerSubjectId !== 'string' ||
    !UUID.test(ownerSubjectId)
  ) {
    throw unavailable();
  }
  return {
    objectId: objectId.toLowerCase(),
    status,
    purpose,
    contentType,
    ownerSubjectId: ownerSubjectId.toLowerCase(),
  };
}

export class MediaEvidenceClient implements EvidenceObjects {
  constructor(private readonly http: ServiceHttp) {}

  async inspect(objectId: string, correlationId: string): Promise<EvidenceObject | null> {
    const outcome = await this.http.request('GET', `${PREFIX}/${objectId}`, correlationId);
    if (outcome.kind === 'status' && outcome.status === 404) return null;
    if (outcome.kind !== 'ok') throw unavailable();
    return parseEvidenceObject(outcome.body);
  }

  async claim(objectId: string, claimRef: string, correlationId: string): Promise<void> {
    const outcome = await this.http.request(
      'POST',
      `${PREFIX}/${objectId}/claims`,
      correlationId,
      {
        claimRef,
        holder: 'dispatch.task-evidence',
      },
      { idempotent: true },
    );
    if (outcome.kind === 'ok') return;
    // A refused claim (object not AVAILABLE any more) is not usable evidence.
    if (outcome.kind === 'status' && (outcome.status === 404 || outcome.status === 409)) {
      throw new DispatchError('EVIDENCE_INVALID', 'The photo is not usable evidence.');
    }
    throw unavailable();
  }
}
