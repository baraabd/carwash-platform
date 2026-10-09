import { createHash, randomUUID } from 'node:crypto';
import type { Clock, Hasher, IdGenerator } from '../../ports';

export class SystemClock implements Clock {
  now(): Date {
    // Millisecond precision matches TIMESTAMPTZ(3) storage, so a value read back
    // from PostgreSQL compares equal to the value that was written.
    return new Date(Math.floor(Date.now()));
  }
}

export class RandomIds implements IdGenerator {
  uuid(): string {
    return randomUUID();
  }
}

export class Sha256Hasher implements Hasher {
  sha256Hex(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
  }
}