# Communications: authenticated connector receipts

Implementation scope: a deployment-owned connector can submit an authenticated,
correlated delivery fact to the Communications owner. This does not select an SMS
vendor, implement recipient resolution, certify provider delivery, or approve a
hosted environment. `booking.confirmed` still uses SMS. The connector remains
responsible for verifying the actual provider's authentic receipt and resolving
only its explicitly supported recipient namespaces.

## Deployment inputs

| Process | Input | Meaning |
| --- | --- | --- |
| Delivery worker | `NOTIFICATION_PROVIDER_CONNECTOR_ID` | Stable lower-case identity of this connector/provider account, 1–64 characters matching `[a-z][a-z0-9._-]*`. Required by the deployed HTTP adapter. Persisted on each attempt before submission. Changing connector/account requires a new identity. |
| Communications API | `NOTIFICATION_RECEIPT_CONNECTOR_ID` | The exact connector identity whose signed receipts this deployment accepts. It must match the attempt's stored identity. |
| Communications API | `NOTIFICATION_RECEIPT_SIGNING_KEY_FILE` | Absolute path to an independently generated 32–256-byte HMAC key file; bytes are read verbatim. A regular file with no symlink, group writes or world access is required (for example `0400`, `0440`, `0600` or `0640`). Mount with permissions readable by the non-root runtime. |
| Connector | Independent receipt signing key | The same protected receipt key, provisioned only to the connector and receiver. Never reuse `NOTIFICATION_PROVIDER_TOKEN`, an Identity key, another environment's key or a merchant secret. |

The outbound bearer token and the receipt key have separate purposes and
provisioning. The API does not need the outbound token. If it is present and
equals the receipt key, startup refuses it. A raw
`NOTIFICATION_RECEIPT_SIGNING_KEY` environment value is refused; no default key
exists. Missing both receiver inputs leaves this ingress returning 503. Partial
or unsafe configuration aborts startup. These are configuration states, not
evidence of a running connector or successful SMS delivery.

Apply owner migration `20261128090000_authenticated_notification_receipts`
before this API/worker release, using the canonical owner schema `app`. The
receipt row lock targets that same schema. It adds a nullable connector identity to attempts
and an immutable owner-local receipt ledger. Old attempts remain NULL; there is
no backfill inventing their connector. The previous worker can still run against
the additive schema, but its unbound attempts cannot satisfy the new correlation
check. `notification_receipt` is included in the API's schema readiness probe.

## Internal v1 contract

The connector calls the owner through its restricted HTTPS ingress:

```text
POST /internal/v1/communications/notification-receipts
Content-Type: application/json
x-provider-timestamp: <Unix seconds>
x-provider-notification-id: <stable receipt ID>
x-provider-signature: v1=<lower-case HMAC-SHA256 hex>
```

There is no browser/session authorization and no new public Gateway alias.
Restrict network access to the connector where the platform supports it; network
membership does not replace signature verification. The route rejects query
strings, compressed bodies and bodies larger than 4096 bytes. Do not put tokens,
keys, phone numbers, recipients or message content in its URL or body.

The exact closed JSON shape is:

```json
{
  "schema": "carwash.notification-receipt/v1",
  "connectorId": "<configured connector identity>",
  "notificationId": "<lower-case notification UUID>",
  "submissionKey": "cw-notification:<same notification UUID>",
  "providerMessageId": "<the messageId actually returned by this connector>",
  "receipt": "DELIVERED"
}
```

`receipt` is only `DELIVERED` or `FAILED`; provider acceptance is never accepted
as a delivery receipt. `providerMessageId` matches `[A-Za-z0-9._:-]{1,128}`. The
signed receipt ID matches `[A-Za-z0-9_-]{8,128}` and identifies one provider fact
within this connector. The connector must persist a stable mapping from the
outbound idempotency key to its real provider message and receipt identities.
Its own random response ID without a verified delivery fact is not evidence.

The existing `washgo-hmac-v1` technical verifier is reused. Sign the following
bytes, without JSON reserialization or a newline:

```text
UTF8(timestamp + "." + receiptId + ".") || exact HTTP body bytes
```

The timestamp must be within 300 seconds of the receiver clock, including future
skew. Verification happens before JSON parsing, compares MACs in constant time,
and binds the receipt ID. Signature headers and keys are not logged or persisted.

## Correlation, replay and ordering

The receiver authenticates the configured connector and the submission key,
then locks its own notification row and requires all of these facts:

- An existing attempt at the notification's **current attempt number and fence**.
- That attempt's recorded connector identity equals the authenticated connector.
- Its outcome is `ACCEPTED` and its stored provider message ID equals the receipt.
- Any message ID already on the notification agrees with the same receipt.

This is deliberately conservative for both receipt outcomes. A receipt from an
older claim cannot terminate a newer claim, including an old `FAILED` arriving
after reclaim. Historical delivery facts need explicit reconciliation; this
change does not invent a provider lookup or widen the domain transitions.

If the receipt arrives before the submission response is committed, return 409
without reserving its replay ID. The connector retries the **same body bytes and
receipt ID**, with a fresh timestamp/signature, after the submission settles.
The same applies to a connector/message mismatch. An unknown target returns
404. If the response was entirely lost and there is no recorded ACCEPTED message
ID, the notification remains UNKNOWN; verified provider lookup/reconciliation is
still required before that case can be automated.

The ledger key is `(connectorId, receiptId)`. Its SHA256 binds the exact body;
signature/timestamp headers are excluded so a legitimate retry can be re-signed.
The replay claim and state effect commit in one database transaction:

- Identical replay: acknowledge without another effect, including after restart.
- Reused receipt ID with changed body: 409 `RECEIPT_CONFLICT`, without changes.
- New correlated receipt: run the existing `afterReceipt` rule and record
  `APPLIED` or `IGNORED` in the immutable ledger.

No receipt creates a send/retry/claim or removes a booking cancellation. Terminal
states remain terminal. Cancellation suppresses unsent work; it cannot erase an
authentic receipt for a submission that already happened. Worker completion
still requires its fence and an eligible state, so a receipt cannot be regressed
by a late completion. Notifications are locked before attempts; the receipt
transaction never takes the booking lock after the notification lock.

| HTTP result | Meaning / connector action |
| --- | --- |
| 204 | Correlated fact applied, safely ignored by the existing domain policy, or identical replay. No delivery inference from HTTP alone. |
| 400 / 413 | Invalid closed contract, content encoding/query or body size. Correct the sender; do not retry unchanged. |
| 401 | Missing/invalid/stale signature or wrong configured connector. No business state touched. |
| 404 | Target notification unknown. Investigate mapping/environment. |
| 409 `RECEIPT_CORRELATION_PENDING` | No current accepted correlation; no replay key consumed. Retry only after confirming submission state. |
| 409 `RECEIPT_CONFLICT` | Same receipt identity with different bytes; investigate integrity. |
| 503 | Ingress unconfigured or transaction unavailable; no success is asserted. Retry the stable receipt after recovery. |

The ledger stores identifiers, body hash, signed/received times, outcome and
application result, never raw content or credentials. Keep the ledger for the
notification's lifetime; removing it independently would reopen replay history.
Use a new connector ID when changing the provider account. Do not relabel old
attempts or repurpose an old signing key to make their receipts pass.

## Verification and remaining external evidence

Focused compiled unit/real-socket tests live in
`services/communications/test/notification-receipts.spec.ts`. They cover exact
HMAC binding, freshness, changed body/ID, wrong connector, protected-file loading,
body limits/compression, the actually mounted HTTP controller, and application
dispatch only after authentication. Their application port is explicit test
instrumentation, so they do not prove PostgreSQL or vendor behavior.

The existing `tests/production/D/communications-delivery.test.mjs` real PostgreSQL
suite includes concurrent replay, changed replay payload, current-claim
correlation, early receipt retries, legacy attempts, actual reclaim/completion
ordering, atomic rollback, immutable receipts, cancellation and mounted HTTP
ingress across app restarts. It is already selected by
`node scripts/production/D/run-real-infra.mjs --suite communications` and its CI
workflow. Local tests with a signed connector fixture are not hosted acceptance.

Still required externally: the chosen SMS connector/account, authentic provider
receipt verification, actual supported recipient resolvers and namespaces,
documented outbound idempotency behavior, HTTPS deployment, key provisioning,
real delivery proof, and deployed worker progress. This change claims none of
those inputs or S10/S11 acceptance from source code alone.
