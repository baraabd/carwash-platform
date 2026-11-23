import { ContractViolation, closed, parseUtc, uuid } from '@carwash/contracts';
import type { Address } from '../domain';

export function addressCursor(owner: string, address: Address): string {
  return Buffer.from(
    JSON.stringify({ owner, id: address.id, at: address.createdAt.toISOString() }),
  ).toString('base64url');
}

export function readAddressCursor(
  owner: string,
  cursor: string | null,
): { createdAt: Date; id: string } | null {
  if (cursor === null) return null;
  try {
    const data = Buffer.from(cursor, 'base64url');
    if (data.toString('base64url') !== cursor) throw new Error('encoding');
    const value = closed(JSON.parse(data.toString('utf8')) as unknown, 'query.cursor', [
      'owner',
      'id',
      'at',
    ]);
    if (uuid(value.owner, 'query.cursor') !== owner) throw new Error('owner');
    return {
      id: uuid(value.id, 'query.cursor'),
      createdAt: new Date(parseUtc(value.at, 'query.cursor')),
    };
  } catch {
    throw new ContractViolation('INVALID_CURSOR', 'query.cursor');
  }
}
