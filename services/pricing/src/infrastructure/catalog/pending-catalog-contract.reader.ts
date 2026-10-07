import { CatalogUnavailable, type CatalogRevisionReader } from '../../ports';
import type { CatalogSnapshot } from '../../domain';

/**
 * Production binding of the Catalog read port until Lane E publishes the
 * `catalog.v1` contract and a service-to-service read identity
 * (docs/production/B/CONTRACT_REQUEST_E_PRICING.md, CR-B2-3/4).
 *
 * Pricing must not copy Catalog's DTOs or replay a user's token against
 * Catalog, so price publication fails closed (503 UPSTREAM_UNAVAILABLE) rather
 * than validating rates against an unverified catalog. Quote issuance does not
 * depend on this port: it uses the catalog view stored with each price version.
 */
export class PendingCatalogContractReader implements CatalogRevisionReader {
  read(): Promise<CatalogSnapshot | null> {
    return Promise.reject(new CatalogUnavailable());
  }
}
