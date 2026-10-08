import { randomInt, randomUUID } from 'node:crypto';
import type { Clock, IdGenerator, RandomSource } from '../../ports';

export const systemClock: Clock = { now: () => new Date() };
export const uuidGenerator: IdGenerator = { next: () => randomUUID() };
/** Jitter only; not security-sensitive, but a CSPRNG costs nothing here. */
export const systemRandom: RandomSource = { next: () => randomInt(0, 1_000_000) / 1_000_000 };
