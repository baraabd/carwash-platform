/**
 * F002 compatibility facade.
 *
 * Persistence moved into the infrastructure layer in F003. Existing acceptance
 * harnesses import this path, so the facade remains until those consumers are
 * migrated in a separately owned change.
 */
export * from './infrastructure/persistence/prisma.service';
