import { argon2id, hash, verify, needsRehash } from 'argon2';
import { randomBytes } from 'node:crypto';
import type { Passwords } from '../../ports/identity.ports';

export interface ArgonPolicy {
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
}
export const PASSWORD_HASH_POLICY: ArgonPolicy = Object.freeze({
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
});
export class ArgonPasswords implements Passwords {
  private constructor(
    readonly dummyHash: string,
    private readonly policy: ArgonPolicy,
  ) {}
  static async create(policy: ArgonPolicy = PASSWORD_HASH_POLICY): Promise<ArgonPasswords> {
    if (
      !Number.isInteger(policy.memoryCost) ||
      policy.memoryCost < 19_456 ||
      policy.memoryCost > 262_144 ||
      !Number.isInteger(policy.timeCost) ||
      policy.timeCost < 2 ||
      policy.timeCost > 6 ||
      !Number.isInteger(policy.parallelism) ||
      policy.parallelism < 1 ||
      policy.parallelism > 4
    )
      throw new Error('INVALID_ARGON_POLICY');
    const dummy = await hash(randomBytes(32), {
      ...policy,
      type: argon2id,
      version: 0x13,
      hashLength: 32,
    });
    return new ArgonPasswords(dummy, Object.freeze({ ...policy }));
  }
  hash(value: string): Promise<string> {
    if (value.length > 128) return Promise.reject(new Error('PASSWORD_TOO_LONG'));
    return hash(value, { ...this.policy, type: argon2id, version: 0x13, hashLength: 32 });
  }
  async verify(encoded: string, value: string): Promise<boolean> {
    if (value.length > 128 || encoded.length > 512) return false;
    const parts = encoded.split('$');
    if (
      parts.length !== 6 ||
      !['argon2id', 'argon2i'].includes(parts[1] ?? '') ||
      parts[2] !== 'v=19'
    )
      return false;
    // PHC parameter ordering is not semantic; current argon2 emits m,p,t.
    // Accept each recognized parameter exactly once before applying resource caps.
    const params = new Map<string, number>();
    for (const item of (parts[3] ?? '').split(',')) {
      const match = /^([mpt])=(\d{1,9})$/.exec(item);
      if (!match?.[1] || !match[2] || params.has(match[1])) return false;
      params.set(match[1], Number(match[2]));
    }
    const memory = params.get('m') ?? 0;
    const time = params.get('t') ?? 0;
    const parallelism = params.get('p') ?? 0;
    if (
      params.size !== 3 ||
      parallelism < 1 ||
      parallelism > 4 ||
      memory < 8 * parallelism ||
      memory > 262_144 ||
      time < 1 ||
      time > 6
    )
      return false;
    try {
      return await verify(encoded, value);
    } catch {
      return false;
    }
  }
  needsRehash(encoded: string): boolean {
    try {
      return (
        !encoded.startsWith('$argon2id$') || needsRehash(encoded, { ...this.policy, version: 0x13 })
      );
    } catch {
      return true;
    }
  }
}
