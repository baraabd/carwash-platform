/**
 * Structural wire parsing shared by every versioned HTTP contract.
 * Parsing is NOT authentication or authorization; owners re-check actor/object/purpose.
 */

export class ContractViolation extends Error {
  constructor(
    readonly code: string,
    readonly path: string,
  ) {
    super(`${code} at ${path}`);
    this.name = 'ContractViolation';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type Json =
  null | boolean | number | string | readonly Json[] | { readonly [k: string]: Json };

export function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractViolation('EXPECTED_OBJECT', path);
  }
  return value as Record<string, unknown>;
}

/** Closed objects: unknown fields are refused so silent contract drift is impossible. */
export function closed(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  const v = record(value, path);
  for (const key of required) {
    if (!Object.hasOwn(v, key)) throw new ContractViolation('MISSING_FIELD', `${path}.${key}`);
  }
  for (const key of Object.keys(v)) {
    if (!required.includes(key) && !optional.includes(key)) {
      throw new ContractViolation('UNEXPECTED_FIELD', `${path}.${key}`);
    }
  }
  return v;
}

export function uuid(value: unknown, path: string): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new ContractViolation('INVALID_UUID', path);
  return value.toLowerCase();
}

export function text(
  value: unknown,
  path: string,
  options: { readonly min?: number; readonly max: number; readonly pattern?: RegExp },
): string {
  if (typeof value !== 'string') throw new ContractViolation('EXPECTED_STRING', path);
  const normalized = value.normalize('NFC');
  const length = [...normalized].length;
  if (length < (options.min ?? 1) || length > options.max) {
    throw new ContractViolation('INVALID_LENGTH', path);
  }
  // Control characters are never valid user text and break logs/terminals.
  if (hasControlCharacter(normalized)) {
    throw new ContractViolation('INVALID_CHARACTERS', path);
  }
  if (options.pattern && !options.pattern.test(normalized)) {
    throw new ContractViolation('INVALID_FORMAT', path);
  }
  return normalized;
}

/** C0 controls except TAB/LF/CR, plus DEL. */
function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export function optionalText(
  value: unknown,
  path: string,
  options: { readonly min?: number; readonly max: number; readonly pattern?: RegExp },
): string | null {
  if (value === null || value === undefined) return null;
  return text(value, path, options);
}

export function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new ContractViolation('EXPECTED_BOOLEAN', path);
  return value;
}

export function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ContractViolation('INVALID_INTEGER', path);
  }
  return value;
}

export function oneOf<const T extends readonly string[]>(
  value: unknown,
  path: string,
  allowed: T,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ContractViolation('INVALID_ENUM', path);
  }
  return value;
}

export function list<T>(
  value: unknown,
  path: string,
  max: number,
  item: (entry: unknown, path: string) => T,
): T[] {
  if (!Array.isArray(value)) throw new ContractViolation('EXPECTED_ARRAY', path);
  if (value.length > max) throw new ContractViolation('TOO_MANY_ITEMS', path);
  return value.map((entry, index) => item(entry, `${path}[${index}]`));
}

/**
 * Deterministic JSON used for idempotency fingerprints: sorted keys, no
 * whitespace, NFC strings. Non-finite numbers and non-JSON values are refused.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ContractViolation('NON_FINITE_NUMBER', '$');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  throw new ContractViolation('NON_JSON_VALUE', '$');
}
