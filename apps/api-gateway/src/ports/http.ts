import type { IdentitySessionView, GatewayOwner } from '@carwash/contracts';
export interface RequestContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly traceparent: string;
}
export interface UpstreamReply {
  readonly status: number;
  readonly body: unknown;
  readonly cookies: readonly string[];
}
export interface HttpPort {
  request(
    owner: GatewayOwner,
    path: string,
    method: string,
    headers: Readonly<Record<string, string>>,
    /** A Buffer is sent byte-for-byte (provider ingress); anything else as JSON. */
    body?: unknown,
  ): Promise<UpstreamReply>;
}
export interface VerifiedIdentity {
  readonly session: IdentitySessionView;
  readonly token: string;
}
export interface AuthPort {
  authenticate(
    headers: Readonly<Record<string, string>>,
    unsafe: boolean,
    context: RequestContext,
  ): Promise<VerifiedIdentity>;
}
export interface GatewayInput {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: unknown;
  /** Exact request bytes as received; used only by providerIngress routes. */
  readonly rawBody?: Buffer;
  readonly context: RequestContext;
}
