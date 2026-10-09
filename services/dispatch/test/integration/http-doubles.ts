import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * HTTP DOUBLES of the services Dispatch calls, used only by the Dispatch HTTP
 * suites and declared as doubles in the evidence:
 *   - Workforce: the PUBLISHED workforce.v1 `listCapacityResources` shape
 *     (two pages, so cursor handling of the real adapter is exercised);
 *   - Media: the REQUESTED media.v1 object read and claim.
 * Both require the interim service credential exactly as configured.
 */
export const DISPATCH_CLIENT = 'dispatch';
export const DISPATCH_CLIENT_TOKEN = 'd'.repeat(48);

export interface Double {
  readonly url: string;
  close(): Promise<void>;
  requests: number;
  mode: 'ok' | 'down' | 'malformed';
}

function authorized(req: IncomingMessage): boolean {
  return (
    req.headers['x-service-client'] === DISPATCH_CLIENT &&
    req.headers['x-service-token'] === DISPATCH_CLIENT_TOKEN
  );
}

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse, body: string) => void,
): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => handler(req, res, body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` };
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
}

export interface ResourceSetting {
  eligibility: 'ELIGIBLE' | 'INELIGIBLE';
  eligibilityRevision: number;
}

export async function workforceDouble(resources: Map<string, ResourceSetting>): Promise<Double> {
  const state: Double = {
    url: '',
    requests: 0,
    mode: 'ok',
    close: () => Promise.resolve(),
  };
  const filler = randomUUID();
  const { server, url } = await listen((req, res) => {
    state.requests += 1;
    const parsed = new URL(req.url ?? '/', 'http://x');
    if (!authorized(req)) return json(res, 401, {});
    if (parsed.pathname !== '/internal/v1/workforce/capacity-resources') return json(res, 404, {});
    if (state.mode === 'down') return json(res, 503, {});
    const zoneId = parsed.searchParams.get('zoneId') ?? '';
    const from = new Date(parsed.searchParams.get('from') ?? '');
    const to = new Date(parsed.searchParams.get('to') ?? '');
    const shift = {
      startsAt: new Date(from.getTime() - 3_600_000).toISOString(),
      endsAt: new Date(to.getTime() + 3_600_000).toISOString(),
    };
    const item = (resourceId: string, setting: ResourceSetting) => ({
      resourceId,
      revision: 1,
      eligibility: setting.eligibility,
      eligibilityRevision: setting.eligibilityRevision,
      zoneIds: [zoneId],
      shifts: [shift],
    });
    if (state.mode === 'malformed') {
      return json(res, 200, {
        items: [{ resourceId: filler }],
        nextCursor: null,
        asOf: new Date().toISOString(),
      });
    }
    if (parsed.searchParams.get('cursor') !== 'page-2') {
      return json(res, 200, {
        items: [item(filler, { eligibility: 'ELIGIBLE', eligibilityRevision: 1 })],
        nextCursor: 'page-2',
        asOf: new Date().toISOString(),
      });
    }
    return json(res, 200, {
      items: [...resources.entries()].map(([id, setting]) => item(id, setting)),
      nextCursor: null,
      asOf: new Date().toISOString(),
    });
  });
  return Object.assign(state, {
    url,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}

export interface MediaObjectSetting {
  status: string;
  purpose: string;
  contentType: string;
  ownerSubjectId: string;
}

export async function mediaDouble(
  objects: Map<string, MediaObjectSetting>,
  claims: Map<string, Set<string>>,
): Promise<Double> {
  const state: Double = { url: '', requests: 0, mode: 'ok', close: () => Promise.resolve() };
  const { server, url } = await listen((req, res, body) => {
    state.requests += 1;
    if (!authorized(req)) return json(res, 401, {});
    if (state.mode === 'down') return json(res, 503, {});
    const match = /^\/internal\/v1\/media\/objects\/([0-9a-f-]{36})(\/claims)?$/.exec(
      req.url ?? '',
    );
    const object = match?.[1] ? objects.get(match[1]) : undefined;
    if (!match || !object || !match[1]) return json(res, 404, {});
    if (match[2] && req.method === 'POST') {
      if (object.status !== 'AVAILABLE') return json(res, 409, {});
      const { claimRef } = JSON.parse(body) as { claimRef: string };
      const set = claims.get(match[1]) ?? new Set<string>();
      set.add(claimRef);
      claims.set(match[1], set);
      return json(res, 200, { claimed: true });
    }
    return json(res, 200, {
      objectId: match[1],
      revision: 2,
      ...object,
      byteLength: 1234,
      sha256: 'a'.repeat(64),
      rejectReason: null,
      claimed: claims.has(match[1]),
      createdAt: new Date().toISOString(),
      finalizedAt: new Date().toISOString(),
      expiresAt: null,
    });
  });
  return Object.assign(state, {
    url,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}
