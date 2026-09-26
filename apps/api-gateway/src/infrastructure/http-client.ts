import type { GatewayOwner } from '@carwash/contracts';
import { GatewayFault } from '../domain/policy';
import type { HttpPort, UpstreamReply } from '../ports/http';
import type { GatewayConfig } from './config';
/** One attempt only. The owning service, never this client, decides command replay. */
export class BoundedHttpClient implements HttpPort {
  constructor(private readonly config: GatewayConfig) {}
  async request(
    owner: GatewayOwner,
    path: string,
    method: string,
    headers: Readonly<Record<string, string>>,
    body?: unknown,
  ): Promise<UpstreamReply> {
    const origin = this.config.origins[owner];
    if (!origin) throw new GatewayFault(503, 'UPSTREAM_UNAVAILABLE');
    if (!path.startsWith('/') || path.startsWith('//'))
      throw new GatewayFault(500, 'INTERNAL_ERROR');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let response: Response | undefined;
    try {
      response = await fetch(origin + path, {
        method,
        headers,
        redirect: 'error',
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (reader) {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.length;
          if (length > this.config.responseLimit) {
            await reader.cancel();
            throw new GatewayFault(502, 'UPSTREAM_INVALID');
          }
          chunks.push(next.value);
        }
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      let parsed: unknown = null;
      if (raw) {
        if (
          !(response.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')
        )
          throw new GatewayFault(502, 'UPSTREAM_INVALID');
        try {
          parsed = JSON.parse(raw) as unknown;
        } catch {
          throw new GatewayFault(502, 'UPSTREAM_INVALID');
        }
      }
      return {
        status: response.status,
        body: parsed,
        cookies: owner === 'identity' ? response.headers.getSetCookie() : [],
      };
    } catch (error) {
      if (error instanceof GatewayFault) throw error;
      throw new GatewayFault(
        controller.signal.aborted ? 504 : 502,
        controller.signal.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
