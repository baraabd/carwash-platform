import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MediaService, mediaPolicy } from '../../src/application';
import { MediaError, storageUnavailable, type ContentType } from '../../src/domain';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { PrismaMediaStore } from '../../src/infrastructure/persistence/prisma-media.store';
import { uuidGenerator } from '../../src/infrastructure/runtime/system';
import type {
  Actor,
  Clock,
  MediaPolicy,
  ObjectStore,
  PresignedRequest,
  RequestMeta,
  StoredRead,
} from '../../src/ports';

/**
 * Real-infrastructure test support. Requires the lane-C stack:
 *   node scripts/production/C/stack.mjs up
 * The context is found through CW_PROD_C_CONTEXT or the stack's pointer file.
 * Connections use the RUNTIME role (DML only), never the migration role.
 */
export interface LaneContext {
  readonly runId: string;
  readonly databases: Record<string, { appUrl: string; migrateUrl: string }>;
  readonly containers: Record<string, string>;
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
}

const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

export function laneContext(): LaneContext {
  const file =
    process.env.CW_PROD_C_CONTEXT ??
    (
      JSON.parse(
        readFileSync(path.join(ROOT, '.acceptance', 'production-C', 'current.json'), 'utf8'),
      ) as { contextFile: string }
    ).contextFile;
  return JSON.parse(readFileSync(file, 'utf8')) as LaneContext;
}

export class TestClock implements Clock {
  constructor(private current: Date = new Date()) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  set(at: Date): void {
    this.current = new Date(at.getTime());
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/**
 * In-memory double of the ObjectStore port, used ONLY where these suites
 * prove database behaviour (locks, constraints, idempotency). Real S3
 * behaviour is proven by tests/production/C/media-s3.test.mjs. Failures and
 * latency can be injected to widen race windows.
 */
export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, Buffer>();
  readonly removed: string[] = [];
  failing: 'read' | 'write' | 'remove' | null = null;
  delayMs = 0;

  private async pause(op: 'read' | 'write' | 'remove'): Promise<void> {
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.failing === op) throw storageUnavailable();
  }

  presignUpload(
    key: string,
    content: { readonly contentType: ContentType; readonly contentLength: number },
    expiresAt: Date,
  ): PresignedRequest {
    return {
      method: 'PUT',
      url: `memory://${key}`,
      headers: {
        'content-type': content.contentType,
        'content-length': String(content.contentLength),
      },
      expiresAt,
    };
  }

  presignDownload(key: string, expiresAt: Date): PresignedRequest {
    return { method: 'GET', url: `memory://${key}`, headers: {}, expiresAt };
  }

  async read(key: string, limit: number): Promise<StoredRead> {
    await this.pause('read');
    const bytes = this.objects.get(key);
    if (!bytes) return { kind: 'MISSING' };
    return { kind: 'FOUND', bytes: bytes.subarray(0, limit), truncated: bytes.length > limit };
  }

  async write(key: string, bytes: Uint8Array): Promise<void> {
    await this.pause('write');
    this.objects.set(key, Buffer.from(bytes));
  }

  async remove(key: string): Promise<void> {
    await this.pause('remove');
    this.objects.delete(key);
    this.removed.push(key);
  }
}

export interface Replica {
  readonly prisma: PrismaService;
  readonly store: PrismaMediaStore;
  readonly service: MediaService;
}

/** One "replica" = its own connection pool, like a separate process would have. */
export function replica(
  clock: Clock,
  objects: ObjectStore,
  policy: MediaPolicy = mediaPolicy(),
): Replica {
  const prisma = new PrismaService(laneContext().databases.media!.appUrl);
  const store = new PrismaMediaStore(prisma);
  return {
    prisma,
    store,
    service: new MediaService(store, store, objects, clock, uuidGenerator, policy),
  };
}

export function technician(subject: string = randomUUID()): Extract<Actor, { kind: 'USER' }> {
  return { kind: 'USER', subject, permissions: ['work.read:assigned', 'work.execute:assigned'] };
}

export const DISPATCH: Actor = {
  kind: 'SERVICE',
  clientId: 'dispatch',
  scopes: ['media.object.read', 'media.object.claim'],
};

export function meta(actor: Actor): RequestMeta {
  return { actor, correlationId: randomUUID() };
}

export function key(): string {
  return `it-${randomUUID()}`;
}

export const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

/** A small genuine-signature JPEG body (not a decodable picture: sniffing only). */
export function jpeg(size = 256, seed: number = Math.floor(Math.random() * 255)): Buffer {
  const body = Buffer.alloc(size, seed);
  body[0] = 0xff;
  body[1] = 0xd8;
  body[2] = 0xff;
  body[3] = 0xe0;
  return body;
}

export function declare(bytes: Buffer, contentType: ContentType = 'image/jpeg') {
  return {
    purpose: 'WORK_EVIDENCE',
    contentType,
    byteLength: bytes.length,
    sha256: sha256(bytes),
  };
}

export async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MediaError) return error.code;
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : (error as Error).name;
  }
  return 'OK';
}
