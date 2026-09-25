/**
 * A fail-closed validator for the explicitly supported JSON Schema vocabulary.
 * It supports every keyword used by service-catalog.schema.json. It is not a
 * general-purpose replacement for a complete JSON Schema implementation.
 * Remote references, unknown keywords, and reference cycles fail closed.
 */
type ObjectValue = Record<string, unknown>;
const keywords = new Set([
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'title',
  'description',
  'type',
  'const',
  'enum',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minLength',
  'pattern',
]);
const types = new Set(['object', 'array', 'string', 'integer', 'number', 'boolean', 'null']);
function object(value: unknown): value is ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
function pointer(root: ObjectValue, ref: string): unknown {
  if (!/^#\/\$defs\/[A-Za-z][A-Za-z0-9_-]*$/.test(ref)) {
    throw new Error(`Only direct local $defs references are supported: ${ref}`);
  }
  const definitions = root.$defs;
  const key = ref.slice('#/$defs/'.length);
  if (!object(definitions) || !Object.hasOwn(definitions, key))
    throw new Error(`Unresolved schema reference: ${ref}`);
  return definitions[key];
}
function definition(schema: unknown, root: ObjectValue, at: string, seen: Set<unknown>): void {
  if (!object(schema)) throw new Error(`${at}: schema must be an object`);
  if (seen.has(schema)) return;
  seen.add(schema);
  for (const key of Object.keys(schema))
    if (!keywords.has(key)) throw new Error(`${at}: unsupported schema keyword ${key}`);
  for (const key of ['$schema', '$id', 'title', 'description']) {
    if (Object.hasOwn(schema, key) && typeof schema[key] !== 'string')
      throw new Error(`${at}: ${key} must be a string`);
  }
  if (schema.$ref !== undefined) {
    if (typeof schema.$ref !== 'string') throw new Error(`${at}: $ref must be a string`);
    definition(pointer(root, schema.$ref), root, schema.$ref, seen);
  }
  if (schema.type !== undefined && (typeof schema.type !== 'string' || !types.has(schema.type)))
    throw new Error(`${at}: unsupported type`);
  if (
    schema.enum !== undefined &&
    (!Array.isArray(schema.enum) ||
      !schema.enum.length ||
      new Set(schema.enum.map(canonical)).size !== schema.enum.length)
  )
    throw new Error(`${at}: enum must be nonempty and unique`);
  if (
    schema.required !== undefined &&
    (!Array.isArray(schema.required) ||
      schema.required.some((key) => typeof key !== 'string') ||
      new Set(schema.required).size !== schema.required.length)
  )
    throw new Error(`${at}: invalid required list`);
  for (const key of ['minItems', 'maxItems', 'minLength']) {
    const value = schema[key];
    if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0))
      throw new Error(`${at}: invalid ${key}`);
  }
  if (schema.uniqueItems !== undefined && typeof schema.uniqueItems !== 'boolean')
    throw new Error(`${at}: uniqueItems must be boolean`);
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean')
    throw new Error(`${at}: this validator requires boolean additionalProperties`);
  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== 'string') throw new Error(`${at}: pattern must be a string`);
    new RegExp(schema.pattern, 'u');
  }
  for (const key of ['properties', '$defs']) {
    const group = schema[key];
    if (group !== undefined) {
      if (!object(group)) throw new Error(`${at}: ${key} must be an object`);
      for (const [name, child] of Object.entries(group))
        definition(child, root, `${at}/${key}/${name}`, seen);
    }
  }
  if (schema.items !== undefined) definition(schema.items, root, `${at}/items`, seen);
}
function matches(value: unknown, type: unknown): boolean {
  switch (type) {
    case undefined:
      return true;
    case 'object':
      return object(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value);
    default:
      return false;
  }
}
export function validateSchema(schema: unknown, value: unknown): string[] {
  const errors: string[] = [];
  if (!object(schema)) return ['$schema: schema must be an object'];
  try {
    definition(schema, schema, '$schema', new Set());
  } catch (error) {
    return [`$schema: ${error instanceof Error ? error.message : 'Invalid schema'}`];
  }
  const visit = (rule: unknown, current: unknown, at: string, depth: number): void => {
    if (depth > 128) {
      errors.push(`${at}: schema/data recursion limit exceeded`);
      return;
    }
    if (!object(rule)) {
      errors.push(`${at}: invalid schema node`);
      return;
    }
    if (typeof rule.$ref === 'string') visit(pointer(schema, rule.$ref), current, at, depth + 1);
    if (!matches(current, rule.type)) {
      errors.push(`${at}: expected ${String(rule.type)}`);
      return;
    }
    if (Object.hasOwn(rule, 'const') && canonical(current) !== canonical(rule.const))
      errors.push(`${at}: does not match const`);
    if (Array.isArray(rule.enum) && !rule.enum.some((item) => canonical(item) === canonical(current)))
      errors.push(`${at}: not in enum`);
    if (typeof current === 'string') {
      if (typeof rule.minLength === 'number' && [...current].length < rule.minLength)
        errors.push(`${at}: below minLength`);
      if (typeof rule.pattern === 'string' && !new RegExp(rule.pattern, 'u').test(current))
        errors.push(`${at}: pattern mismatch`);
    }
    if (Array.isArray(current)) {
      if (typeof rule.minItems === 'number' && current.length < rule.minItems)
        errors.push(`${at}: below minItems`);
      if (typeof rule.maxItems === 'number' && current.length > rule.maxItems)
        errors.push(`${at}: above maxItems`);
      if (rule.uniqueItems === true && new Set(current.map(canonical)).size !== current.length)
        errors.push(`${at}: duplicate array item`);
      if (rule.items !== undefined)
        current.forEach((item, index) => visit(rule.items, item, `${at}/${index}`, depth + 1));
    }
    if (object(current)) {
      const properties = object(rule.properties) ? rule.properties : {};
      if (Array.isArray(rule.required))
        for (const key of rule.required) {
          if (typeof key === 'string' && !Object.hasOwn(current, key))
            errors.push(`${at}/${key}: required property missing`);
        }
      for (const [key, item] of Object.entries(current)) {
        if (Object.hasOwn(properties, key)) visit(properties[key], item, `${at}/${key}`, depth + 1);
        else if (rule.additionalProperties === false) errors.push(`${at}/${key}: unknown property`);
      }
    }
  };
  visit(schema, value, '$', 0);
  return errors;
}
