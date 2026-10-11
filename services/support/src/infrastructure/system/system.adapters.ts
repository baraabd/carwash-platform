import { randomUUID } from 'node:crypto';
import type { Clock, IdSource } from '../../ports';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class RandomIds implements IdSource {
  uuid(): string {
    return randomUUID();
  }
}
