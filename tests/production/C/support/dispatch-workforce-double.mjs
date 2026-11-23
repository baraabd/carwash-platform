/**
 * DOUBLE of Workforce's PUBLISHED workforce.v1 `listCapacityResources` for the
 * lane-C Dispatch process suites. Declared as a double in evidence: the real
 * Workforce provider is exercised by the workforce suites and by the P03-C
 * merge-candidate run.
 *
 * Resources must be registered; each is listed ELIGIBLE with one shift that
 * covers the queried window in the queried zone, returned on a second page
 * so the real adapter's cursor handling runs.
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

export const DISPATCH_WORKFORCE_CLIENT = 'dispatch';
export const DISPATCH_WORKFORCE_TOKEN = 'w'.repeat(48);

export async function startWorkforceDouble() {
  const resources = new Map();
  const filler = randomUUID();
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (status, body) =>
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (
      req.headers['x-service-client'] !== DISPATCH_WORKFORCE_CLIENT ||
      req.headers['x-service-token'] !== DISPATCH_WORKFORCE_TOKEN
    ) {
      return send(401, {});
    }
    if (url.pathname !== '/internal/v1/workforce/capacity-resources') return send(404, {});
    const zoneId = url.searchParams.get('zoneId');
    const from = new Date(url.searchParams.get('from'));
    const to = new Date(url.searchParams.get('to'));
    const item = (resourceId, eligibility, eligibilityRevision) => ({
      resourceId,
      revision: 1,
      eligibility,
      eligibilityRevision,
      zoneIds: [zoneId],
      shifts: [
        {
          startsAt: new Date(from.getTime() - 3_600_000).toISOString(),
          endsAt: new Date(to.getTime() + 3_600_000).toISOString(),
        },
      ],
    });
    if (url.searchParams.get('cursor') !== 'p2') {
      return send(200, {
        items: [item(filler, 'ELIGIBLE', 1)],
        nextCursor: 'p2',
        asOf: new Date().toISOString(),
      });
    }
    return send(200, {
      items: [...resources.entries()].map(([id, s]) => item(id, s.eligibility, s.revision)),
      nextCursor: null,
      asOf: new Date().toISOString(),
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    env() {
      return {
        DISPATCH_WORKFORCE_URL: this.url,
        DISPATCH_WORKFORCE_CLIENT_ID: DISPATCH_WORKFORCE_CLIENT,
        DISPATCH_WORKFORCE_CLIENT_TOKEN: DISPATCH_WORKFORCE_TOKEN,
      };
    },
    /** Registers (or updates) a resource and returns its id. */
    resource(id = randomUUID(), eligibility = 'ELIGIBLE', revision = 1) {
      resources.set(id, { eligibility, revision });
      return id;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** In-process port implementation for suites that construct DispatchService directly. */
export const eligibleWorkforce = {
  async findResource(job, resourceId) {
    return {
      resourceId,
      revision: 1,
      eligibility: 'ELIGIBLE',
      eligibilityRevision: 1,
      zoneIds: [job.zoneId],
      shifts: [
        {
          startsAt: new Date(job.startsAt.getTime() - 3_600_000),
          endsAt: new Date(job.endsAt.getTime() + 3_600_000),
        },
      ],
    };
  },
};
