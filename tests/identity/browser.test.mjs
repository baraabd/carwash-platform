/* global document, localStorage */
import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { fixture, context, email, PASSWORD, IDENTITY_V1 } from './_fixture.mjs';

/** Test-only TLS ingress. It never exposes a delivery adapter or a product screen. */
async function ingress() {
  let upstream;
  const server = https.createServer(
    { key: await readFile(context.tls.keyFile), cert: await readFile(context.tls.certFile) },
    (request, response) => {
      if (request.url === '/fixture') {
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end(
          '<!doctype html><html lang="en"><title>Security fixture</title><body>Cookie transport test</body></html>',
        );
        return;
      }
      if (!upstream || !request.url?.startsWith(`${IDENTITY_V1}/`)) {
        response.writeHead(404);
        response.end();
        return;
      }
      const destination = new URL(request.url, upstream);
      const proxied = http.request(
        destination,
        { method: request.method, headers: request.headers },
        (incoming) => {
          response.writeHead(incoming.statusCode ?? 502, incoming.headers);
          incoming.pipe(response);
        },
      );
      proxied.on('error', () => {
        response.writeHead(502);
        response.end();
      });
      request.pipe(proxied);
    },
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `https://127.0.0.1:${server.address().port}`;
  return {
    origin,
    setUpstream(value) {
      upstream = value;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

test('F006 browser: HTTPS cookie, refresh and CSRF protections are enforced by real Chromium', async (t) => {
  const front = await ingress();
  t.after(() => front.close());
  const f = await fixture({ origins: [front.origin] });
  t.after(() => f.close());
  front.setUpstream(f.base);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const browserContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await browserContext.newPage();
  await page.goto(`${front.origin}/fixture`);
  const request = (route, body, addCsrf = true) =>
    page.evaluate(
      async ({ prefix, route, body, addCsrf }) => {
        const csrfCookie =
          document.cookie
            .split('; ')
            .find((item) => item.startsWith('__Host-wg_csrf='))
            ?.split('=')
            .slice(1)
            .join('=') ?? '';
        const response = await fetch(`${prefix}${route}`, {
          method: body === null ? 'GET' : 'POST',
          credentials: 'include',
          headers:
            body === null
              ? {}
              : {
                  'content-type': 'application/json',
                  ...(addCsrf ? { 'x-csrf-token': csrfCookie } : {}),
                },
          ...(body === null ? {} : { body: JSON.stringify(body) }),
        });
        const text = await response.text();
        return { status: response.status, body: text ? JSON.parse(text) : null };
      },
      { prefix: IDENTITY_V1, route, body, addCsrf },
    );
  assert.equal((await request('/csrf', null)).status, 200);
  const issued = await request('/register', { email: email(), password: PASSWORD });
  assert.equal(issued.status, 202);
  const challenge = f.delivered.get(issued.body.challengeId);
  assert.ok(challenge);
  const verified = await request('/challenges/verify', {
    challengeId: issued.body.challengeId,
    code: challenge.code,
  });
  assert.equal(verified.status, 200);
  assert.equal((await request('/session', null)).status, 200);
  const cookies = await browserContext.cookies();
  for (const name of ['__Host-wg_access', '__Host-wg_refresh']) {
    const cookie = cookies.find((item) => item.name === name);
    assert.ok(cookie);
    assert.equal(cookie.secure, true);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, 'Strict');
    assert.equal(cookie.path, '/');
  }
  const exposed = await page.evaluate(() => ({
    cookies: document.cookie,
    storage: { ...localStorage },
  }));
  assert.ok(
    !exposed.cookies.includes('__Host-wg_access=') &&
      !exposed.cookies.includes('__Host-wg_refresh='),
  );
  assert.equal(Object.keys(exposed.storage).length, 0);
  assert.equal((await request('/logout', {}, false)).status, 403);
  assert.equal((await request('/session', null)).status, 200);
  const previousRefresh = cookies.find((item) => item.name === '__Host-wg_refresh').value;
  assert.equal((await request('/refresh', {})).status, 200);
  assert.ok(
    (await browserContext.cookies()).find((item) => item.name === '__Host-wg_refresh').value !==
      previousRefresh,
  );

  const foreign = await ingress();
  t.after(() => foreign.close());
  const hostile = await browserContext.newPage();
  await hostile.goto(`${foreign.origin}/fixture`);
  const attack = hostile.waitForResponse((response) =>
    response.url().endsWith(`${IDENTITY_V1}/logout`),
  );
  await hostile.evaluate(
    ({ url }) => {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = url;
      document.body.append(form);
      form.submit();
    },
    { url: `${front.origin}${IDENTITY_V1}/logout` },
  );
  assert.equal((await attack).status(), 403);
  assert.equal((await request('/session', null)).status, 200);
  assert.equal((await request('/logout', {})).status, 204);
  assert.equal((await request('/session', null)).status, 401);
  assert.ok(
    !(await browserContext.cookies()).some(
      (item) => item.name === '__Host-wg_refresh' || item.name === '__Host-wg_access',
    ),
  );
  t.diagnostic(
    `Chromium ${browser.version()}; HTTPS/HttpOnly/Secure/SameSite/CSRF; no HAR or credentials retained`,
  );
});
