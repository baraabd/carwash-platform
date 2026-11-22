/**
 * Connection-string helpers.
 *
 * The PostgreSQL driver ignores the `?schema=` query parameter that Prisma's CLI
 * understands, so a client built straight from the DSN would silently run with
 * the default search_path. For this platform that means falling back to `public`
 * — a schema the application role has no rights on — which surfaces much later
 * as a confusing permission error instead of a configuration one.
 *
 * The schema is therefore extracted explicitly and passed to the adapter.
 */

export const DEFAULT_DATABASE_SCHEMA = 'app';

/**
 * PrismaPg serializes Date arguments as UTC wall-clock text and normalizes
 * returned timestamptz offsets. Each connection must therefore use a UTC
 * database session, regardless of the database/role/host default timezone.
 *
 * node-postgres lets connectionString query parameters override Pool options.
 * Normalize the DSN itself, preserving existing startup settings and appending
 * UTC last so an earlier timezone option cannot silently shift persisted times.
 * This changes the transport session, not the user's display timezone.
 */
export function databasePoolConfig(url: string): { connectionString: string } {
  const parsed = new URL(url);
  const options = parsed.searchParams.getAll('options').filter(Boolean).join(' ');
  parsed.searchParams.set('options', [options, '-c timezone=UTC'].filter(Boolean).join(' '));
  return { connectionString: parsed.toString() };
}

export function databaseSchemaFromUrl(url: string): string {
  try {
    const schema = new URL(url).searchParams.get('schema');
    return schema && schema.length > 0 ? schema : DEFAULT_DATABASE_SCHEMA;
  } catch {
    return DEFAULT_DATABASE_SCHEMA;
  }
}
