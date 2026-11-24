# Canonical Billing provider notification transport

Status: implemented in the PR147 candidate; production provider activation remains blocked.

The published `billing.v1` route and the existing Gateway upstream now meet at
`POST /internal/v1/billing/provider-notifications/:provider`. Only `sham-cash`
and `syriatel-cash` are recognized. The existing
`providers/{sham_cash|syriatel_cash}/notifications` route keeps its legacy behavior.

## Behavior and financial boundary

- A configured adapter authenticates the exact received bytes before parsing
  provider content. The canonical route uses a raw parser with a16384-byte
  limit and rejects compressed input. JSON and form content types are supported
  at the transport; the provider adapter decides which authenticated payloads
  its documented protocol accepts.
- Only content type and the three published provider headers reach the adapter.
  Browser cookies, bearer credentials and workload identity headers cannot
  authenticate a provider notification.
- Accepted final credits, authentic non-final notifications and identical
  retries return204 with no financial response body. The existing owner
  transaction, credit uniqueness, append-only ledger and exact-match allocation
  rules remain authoritative.
- A mismatched amount is a recorded unallocated credit. The customer obligation
  remains under review; an ingress204 never establishes payment success.
- Unknown providers return404; disabled production adapters return503
  `SERVICE_NOT_READY` / `NOTIFICATION_PROVIDER_DISABLED`. Invalid or stale
  authentication returns401 with the published reason. Oversized requests
  return413 before authentication, including malformed oversized JSON.
- Errors use the published closed envelope, correlation ID and `no-store`.
  No merchant account, amount, transaction reference or signature is reflected.

Both production adapters still declare notifications unavailable. This change
does not supply merchant agreements, official API documents, credentials,
sandbox evidence or live-money acceptance. The authorized test HMAC scheme is
confined to a test double; it is not asserted to be either provider's protocol.

## Verification

The focused real-PostgreSQL run passes27 tests: six new canonical notification
cases and21 existing provider/ledger/refund cases. It exercises actual Nest
HTTP, least-privileged Billing SQL, concurrent duplicate delivery across two
replicas, raw-byte signatures, stale/relabelled/tampered input, private-header
isolation, the exact size boundary, disabled capabilities, and amount mismatch.
Identity and Pricing are explicitly declared HTTP doubles.

The local diagnostic database is PostgreSQL17.12. The pinned PostgreSQL16.10
CI job, production image and complete final candidate gates remain required.
The existing Gateway ingress tests separately prove exact raw forwarding and
header isolation; they are not merchant acceptance or an actual live payment.

`FIN-PROV-01` in `finance-matrix.json` now records the served canonical
implementation and its tests, while retaining `productionGate: FAIL_CLOSED`
and external blocker `B-11`.
