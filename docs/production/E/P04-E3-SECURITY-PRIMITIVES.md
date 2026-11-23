# P04-E3 — shared provider-security primitives and CodeQL disposition

Parent: **P04-E** (parent status: **INTEGRATION_PENDING**). Lane E.
Child: P04-E3. This child adds technical libraries only. It contains no business
rule, no service adoption and no runtime configuration change.

## 1. `@carwash/service-kit` additions

These are technical primitives only. They are allowed in a shared package because
they contain no domain rule, no data and no knowledge of any owner. Each owner
keeps its own scope vocabulary and its own decisions.

| Module | Purpose | Key rules |
| --- | --- | --- |
| `service-clients.ts` | Generic `parseServiceClients<TScope>` and `ServiceClientAuthenticator<TScope>` (`authenticate`, `authorize`) | See the detail below. |
| `provider-signature.ts` | `verifyProviderSignature`, `signProviderNotification` (test provider and tests only), and the `NotificationReplayGuard` port | Scheme `washgo-hmac-v1`, detailed below. |
| `secrets.ts` | `readSecret` and `readSecrets` | See the detail below. |

**`service-clients.ts`**
- Replaces four copied implementations (Dispatch, Media, Scheduling, Workforce)
  for Lane B and later adopters. Existing owners migrate in their own lanes; this
  child does not edit them.
- Configuration holds only SHA-256 digests. Configuration objects take exact keys.
- Ids and digests must be unique, and every scope must be in the owner's own list.
- Credentials are compared in constant time against every client.
- An absent configuration denies everything.
- Callers authenticate with `x-service-client` and `x-service-token`.

**`provider-signature.ts`**
- Scheme `washgo-hmac-v1` computes HMAC-SHA256 over
  `timestamp + "." + notificationId + "." + rawBody`.
- Verification runs over the exact raw bytes, before any parsing, with a body
  limit of 16 KiB and a ±300 s timestamp window.
- The notification id is inside the signed material, so a re-labelled capture
  fails verification.
- Rotation: up to 4 active secrets and up to 4 presented `v1=` signatures. The
  comparison does not exit early.
- Failure reasons are for logs and metrics only.
- De-duplication belongs to the owner's database, not process memory.

**`secrets.ts`**
- A secret comes from `<NAME>` (local/CI) or `<NAME>_FILE` (a mounted
  secret-manager file, with an absolute path). Setting both is an error.
- A file may hold several secrets, one per line, newest first, for rotation.
- Each secret must be at least 32 bytes.
- Errors name the variable, never the value.
- A missing secret returns `null` or `[]`, so callers fail closed.

### Scope of the signature scheme

`washgo-hmac-v1` is the platform's normalized scheme for the authorized test
provider and for any provider or aggregator that documents HMAC-SHA256.

Sham Cash and Syriatel Cash publish no merchant webhook scheme, sandbox or
credentials. That is an **external blocker**, so no live provider uses this
scheme yet. A provider with a different documented scheme gets its own verifier
in Billing's adapter. It never weakens this one.

## 2. CodeQL disposition (open alerts at base `c65db70`)

None of the five open alerts is in payment, Billing, Identity or Gateway runtime
code. All of them are in CI tooling or test harnesses. Nothing was suppressed or
dismissed in GitHub; dismissal is the repository owner's decision, using the
dispositions below.

| # | Rule | Location | Disposition |
| --- | --- | --- | --- |
| 16 | `js/http-to-file-access` | `scripts/ci/install-tools.mjs:30` (archive written to disk) | **Fixed in this PR.** The verified archive is streamed to `tar` on stdin and never written. The only file written is the extracted binary, and only after its own pinned SHA-256 (`binarySha256`) matches. A re-raised alert on that line would be an accepted disposition: the download origin is asserted to be `https://github.com`, and both archive and binary are checksum-pinned in the reviewed `scripts/ci/tools.lock.json`. Exercised locally with `CI_TOOLS_DIR=<tmp> node scripts/ci/install-tools.mjs actionlint`: checksum verified, no archive left. |
| 12 | `js/file-access-to-http` | `scripts/ci/install-tools.mjs:22` (URL read from the lock file) | **Accepted by design.** The URL comes from the committed, reviewed lock file, and the code asserts its origin and checksums before use. No user or runtime input reaches it. |
| 13, 14 | `js/file-access-to-http` | `tests/integration/rabbitmq-acl.test.mjs:255-256` | **Accepted (test-only).** The acceptance test reads credentials it generated for a disposable broker and sends them to that broker's management API on `127.0.0.1`, to prove that application identities are refused administration. Not reachable in production. |
| 28 | `js/file-system-race` | `packages/service-kit/src/secrets.ts:57` (raised on this PR's first head) | **Fixed in this PR.** The first version checked the size with `statSync` and then read the file separately (TOCTOU). It now uses one descriptor and a bounded read; a file that grows past 16 KiB is refused. A regression test covers the oversized file. |
| 27 | `js/file-access-to-http` | `tests/production/C/media-s3.test.mjs:331` (Lane C) | **Accepted (test-only); Lane C owns it.** A presigned URL returned by the local S3 test adapter is fetched to prove expiry and privacy. Lane E does not edit Lane C tests. |

## 3. Evidence (this head)

| Family | Command | Result |
| --- | --- | --- |
| Primitive unit tests: scopes, signature, tamper, replay window, rotation, secrets | `node --test tests/production/E/security-primitives.test.mjs` | PASSED 7/7 |
| Lane E suite | `node --test tests/production/E/*.test.mjs` | see PR |
| Build | `pnpm build:packages` | PASSED |
| CI tool install (changed script) | `CI_TOOLS_DIR=<tmp> node scripts/ci/install-tools.mjs actionlint` | PASSED (no archive written) |
| Billing logging review | `grep logger.* services/billing/src` | Only correlation id, status and replay flag are logged; no amounts or references |
| Owner adoption, durable replay store, HTTP ingress | — | **Not in this child.** Billing (P04-B) adopts these; P04-E2 adds the Gateway ingress; P04-E4 certifies the replay and signature behaviour end-to-end. |

## 4. Rollback

Revert the PR. Nothing imports the new modules yet. The install-tools change is
self-contained: revert it to restore writing the archive to disk.
