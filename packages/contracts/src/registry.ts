import { GATEWAY_V1 } from './gateway';
import { IDENTITY_V1 } from './identity';

export type HttpContractStatus = 'foundation-runtime' | 'routing-contract-only';

export interface HttpContractDescriptor {
  readonly id: 'identity.v1' | 'gateway.v1';
  readonly domain: 'identity' | 'gateway';
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
    openApi: 'docs/contracts/gateway.openapi.json#identity-owned-routes',
  },
  {
    id: 'gateway.v1',
    domain: 'gateway',
    version: 1,
    prefix: GATEWAY_V1,
    status: 'routing-contract-only',
    openApi: 'docs/contracts/gateway.openapi.json',
  },
] as const;

export function httpContract(id: HttpContractDescriptor['id']): HttpContractDescriptor {
  const contract = HTTP_CONTRACTS.find((candidate) => candidate.id === id);
  if (!contract) throw new Error('UNKNOWN_HTTP_CONTRACT');
  return contract;
}
