/**
 * catalog domain layer.
 *
 * Framework- and IO-free business rules: definitions, compatibility and the
 * append-only revision schedule. Catalog never owns money; the legacy
 * `quote.ts` helper is unconnected and is not exported here.
 */
export * from './catalog-definitions';
export * from './catalog-revision';
