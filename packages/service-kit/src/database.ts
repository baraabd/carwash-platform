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

export function databaseSchemaFromUrl(url: string): string {
  try {
    const schema = new URL(url).searchParams.get('schema');
    return schema && schema.length > 0 ? schema : DEFAULT_DATABASE_SCHEMA;
  } catch {
    return DEFAULT_DATABASE_SCHEMA;
  }
}
