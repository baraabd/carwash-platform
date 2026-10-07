import { CATALOG_V1 } from './catalog/v1';
import type { OwnerContract } from './common/route';
import { CONFIGURATION_V1 } from './configuration/v1';
import { CUSTOMER_V1 } from './customer/v1';
import { GATEWAY_V1 } from './gateway';
import { GEO_V1 } from './geo/v1';
import { IDENTITY_V1 } from './identity';
import { PRICING_V1 } from './pricing/v1';
import { SCHEDULING_V1 } from './scheduling/v1';
import { VEHICLE_V1 } from './vehicle/v1';
import { WORKFORCE_V1 } from './workforce/v1';

/**
 * foundation-runtime          implemented and exercised by the foundation runtime
 * routing-contract-only       Gateway routing vocabulary, not a business API
 * published-provider-pending  wire contract published by Lane E; the owner's
 *                             provider implementation is NOT yet accepted. This
 *                             status never implies the endpoint works.
 */
export type HttpContractStatus =
  'foundation-runtime' | 'routing-contract-only' | 'published-provider-pending';

export const OWNER_CONTRACTS = [
  CUSTOMER_V1,
  VEHICLE_V1,
  GEO_V1,
  CATALOG_V1,
  PRICING_V1,
  SCHEDULING_V1,
  WORKFORCE_V1,
  CONFIGURATION_V1,
] as const satisfies readonly OwnerContract[];

type OwnerContractId = (typeof OWNER_CONTRACTS)[number]['id'];

export interface HttpContractDescriptor {
  readonly id: 'identity.v1' | 'gateway.v1' | OwnerContractId;
  readonly domain: string;
  readonly version: 1;
  readonly prefix: string;
  readonly status: HttpContractStatus;
  readonly openApi: string;
}

export const HTTP_CONTRACTS: readonly HttpContractDescriptor[] = [
  {
    id: 'identity.v1',
    domain: 'identity',
    version: 1,
    prefix: IDENTITY_V1,
    status: 'foundation-runtime',
    openApi: 'docs/contracts/gateway.openapi.json',
  },
  {
    id: 'gateway.v1',
    domain: 'gateway',
    version: 1,
    prefix: GATEWAY_V1,
    status: 'routing-contract-only',
    openApi: 'docs/contracts/gateway.openapi.json',
  },
  ...OWNER_CONTRACTS.map((contract): HttpContractDescriptor => ({
    id: contract.id,
    domain: contract.owner,
    version: 1,
    prefix: contract.prefix,
    status: 'published-provider-pending',
    openApi: `docs/contracts/${contract.id}.openapi.json`,
  })),
];

export function httpContract(id: HttpContractDescriptor['id']): HttpContractDescriptor {
  const contract = HTTP_CONTRACTS.find((candidate) => candidate.id === id);
  if (!contract) throw new Error('UNKNOWN_HTTP_CONTRACT');
  return contract;
}
