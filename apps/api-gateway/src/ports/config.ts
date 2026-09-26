import type { GatewayOwner } from '@carwash/contracts';
export interface GatewayConfig {
  readonly origins: Readonly<Partial<Record<GatewayOwner, string>>>;
  readonly issuer: string;
  readonly audience: string;
  readonly cookiePrefix: '__Host-wg_' | 'wg_';
  readonly timeoutMs: number;
  readonly responseLimit: number;
  readonly allowedOrigins: readonly string[];
}
