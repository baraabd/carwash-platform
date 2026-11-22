import { HttpClient, type FetchLike } from '@carwash/api-clients';
import { parseCatalogV1 } from '@carwash/contracts/catalog-v1';
import { parseCustomerProfileV1 } from '@carwash/contracts/customer-v1';
import type { CustomerSessionState } from '../state/customerSession.ts';
import { emptySession } from '../state/emptySession.ts';

/**
 * Same-origin Gateway reads only. The public catalog never receives cookies;
 * the profile uses the browser's existing session without exposing a token.
 * A malformed or unavailable response never falls back to sample records.
 */
export async function productionSession(
  origin: string,
  fetch: FetchLike,
): Promise<CustomerSessionState> {
  const baseUrl = `${new URL(origin).origin}/api/v1`;
  const publicClient = new HttpClient({ baseUrl, fetch, credentials: 'omit' });
  const privateClient = new HttpClient({ baseUrl, fetch, credentials: 'same-origin' });
  const [catalog, profile] = await Promise.all([
    publicClient.request({ method: 'GET', path: '/customer/packages', parse: parseCatalogV1 }),
    privateClient.request({
      method: 'GET',
      path: '/customer/profile',
      parse: parseCustomerProfileV1,
    }),
  ]);
  const state = emptySession();
  const activeProfile = profile.ok && profile.value.status === 'ACTIVE' ? profile.value : null;
  return {
    ...state,
    profile: activeProfile
      ? { name: activeProfile.contact.displayName ?? '', phone: activeProfile.contact.phone ?? '' }
      : state.profile,
    productionData: {
      catalog: catalog.ok ? catalog.value : null,
      catalogStatus: catalog.ok ? 'available' : 'unavailable',
      profileStatus: activeProfile
        ? 'available'
        : !profile.ok && profile.status === 401
          ? 'anonymous'
          : 'unavailable',
    },
  };
}
