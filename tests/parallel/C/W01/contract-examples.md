# W01-C — Declarative proposed contract examples

Status: `PROPOSAL_ONLY / NOT_RUN`. These synthetic request/response examples illustrate the schemas in [CONTRACT_REQUESTS.md](../../../../docs/parallel/C/W01/CONTRACT_REQUESTS.md); they are neither fixtures executed against a provider nor published contracts. Every UUID below is synthetic. E must accept exact schemas, scopes, codes and policy versions before a conformance harness can validate them. Numeric file size/revision/money/expiry values are example data, not approved production limits/prices/retention.

## EX-MEDIA-01 — Private Workforce document reservation

Preconditions: E's real Identity/delegation provider and the narrow Workforce case/actor-binding provider have merged. The actor is authorized for the case. Transport derives that actor; the request cannot select it. `Idempotency-Key: W01C_media_example_01` is synthetic and conforms to the proposed transport alphabet.

```json
{
  "purpose": "WORKFORCE_DOCUMENT",
  "binding": {
    "ownerDomain": "workforce",
    "resourceId": "10000000-0000-4000-8000-000000000001",
    "resourceRevision": 1
  },
  "declaredMime": "image/jpeg",
  "declaredBytes": 4096,
  "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

Proposed semantic response: stable `uploadId`/`objectId`, revision 1, `RESERVED`, policy revision and a private limited upload grant with real provider-derived expiry. Reservation is not clean evidence and no Workforce approval follows. This semantic sketch omits an invented URL/expiry; the eventual provider must supply and test every required field.

| Variant | Expected proposed result | Related future case |
| --- | --- | --- |
| Same actor/operation/case/key and equivalent validated request, JSON keys reordered | Same stable reservation/outcome; no renewed grant expiry or second object | C-MED-01 |
| Same idempotency scope/key with different digest or size | Fingerprint conflict; initial reservation unchanged | C-MED-01 |
| Another unrelated actor or forged acting-subject header uses the same case | Denied/concealed; no object/URL returned | C-SEC-01/C-SEC-02 |
| Own upload changes binding to another case after byte transfer | Finalize refuses rebind; quarantined content remains private | C-SEC-03/C-MED-01 |
| Reviewer asks to read while `QUARANTINED`, scan errored, or object revoked | No read grant regardless of reviewer role; positive read uses separate clean finalized object | C-SEC-02/C-MED-01 |
| Case owner requests clean document `SELF_VIEW`; scoped reviewer requests `REVIEW` | Access is separately authorized by purpose; self-view never grants review decisions | C-SEC-02 |

## EX-WORK-01 — Current revision and assignment fence

Preconditions: real Dispatch, Booking Work and clean Media providers are accepted in W04; production payment/evidence prerequisites are approved. This is a schema sketch for the proposed Work transition, not a currently published route.

```json
{
  "workId": "20000000-0000-4000-8000-000000000001",
  "expectedRevision": 3,
  "assignmentId": "30000000-0000-4000-8000-000000000001",
  "assignmentRevision": 2,
  "intendedTransition": "BEGIN_WASH",
  "beforeEvidence": [
    {
      "objectId": "40000000-0000-4000-8000-000000000001",
      "objectRevision": 4
    }
  ]
}
```

Proposed semantic response: same Work ID with new Work revision and actual approved execution state, its persisted command/audit receipt and independent payment/custody projections. Neither `BEGIN_WASH` nor any output state name is an accepted enum yet; E/Booking publish that mapping. A location refresh increments its own location revision and cannot overwrite Work's phase.

| Variant | Expected proposed result | Related future case |
| --- | --- | --- |
| Valid actor + current assignment/grant + all approved evidence/payment prerequisites | One authorized Work mutation/audit/outbox; no Billing/custody change | C-WRK-01 |
| Old assignment revision after reassignment, or grant revoked | Refused; no new phase or private evidence access | C-SEC-04 |
| Media object belongs to BOOKING-B or is merely local/demo/quarantined | Refused; no clean-evidence fallback | C-SEC-03/C-MED-01 |
| Duplicate same-scope key/request after lost response | One persisted transition; stable receipt, current authorization rechecked | C-WRK-01/C-SAGA-01 |
| Pending ShamCash | Behavior blocked until C-D06 owner/B decision; never assume either start or payment approval | C-WRK-01 |

## EX-CASH-01 — Independent collection and custody

Preconditions: B's accepted schema and receipt/claim policy, exact currency exponent and authorized collector relationship; Work result exists. Synthetic money `"100"` is not a service price or a Syrian-lira unit choice. The scope is collector + collect operation + obligation + key. `collectedAt` is a synthetic declaration; B must validate and assign authoritative server receipt/audit time.

```json
{
  "bookingId": "50000000-0000-4000-8000-000000000001",
  "bookingRevision": 4,
  "workId": "20000000-0000-4000-8000-000000000001",
  "workRevision": 8,
  "assignmentId": "30000000-0000-4000-8000-000000000001",
  "assignmentRevision": 2,
  "obligationId": "60000000-0000-4000-8000-000000000001",
  "obligationRevision": 1,
  "amount": { "minorUnits": "100", "currency": "SYP" },
  "collectedAt": "2026-09-20T09:00:00.000Z"
}
```

Proposed semantic response: B's stable collection/receipt ID and source revision; custody holder/reference/state separately; company acceptance/reconciliation separately. Whether collection is a claimed or verified receipt follows B's explicit policy. No financial success is inferred from this example, Work completion, image or HTTP navigation.

| Variant | Expected proposed result | Related future case |
| --- | --- | --- |
| Two concurrent identical requests in the same scope/key | One collection effect/posting reference and one replayable result | C-FIN-01/C-FIN-03 |
| Same collector/operation/obligation/key, changed amount/currency | Fingerprint conflict; original result/effect preserved | C-FIN-02 |
| Different actor/operation/obligation with the same text key | Evaluate its own scope and authorization; do not promise a cross-scope fingerprint conflict. Business uniqueness still blocks duplicate collection | C-FIN-02 |
| Actor lost current/historical collector authorization | Denied; no late collection via stale assignment alone | C-SEC-04/C-FIN-04 |
| Cash delivery submitted by holder, not accepted by approved company recipient | Pending custody delivery; not company-settled | C-FIN-04 |
| Duplicate acceptance/discrepancy or response lost | B-owned durable replay/reconciliation; no second custody transfer | C-FIN-03/C-FIN-04 |

## EX-GUEST-01 — Booking intent resubmission

Proposed same guest, same booking intent, same key and canonical quote/hold/contact/service request with absent optional plate returns one durable booking result. A changed payload within that scope conflicts; a different guest capability or guessed booking intent is denied, not adopted through a submitted phone number. Quote expiry is rejected without fabricated confirmation; fresh quote/availability requires explicit review. Capability expiry/recovery and exact optional `plate` representation are unaccepted E/A decisions. Cases: C-BKG-01/C-BKG-02/C-SCH-01/C-SAGA-02.

Example/spec files must not be bundled into production fallbacks. All examples here remain source-analysis artifacts until real provider/consumer gates are implemented and executed on the accepted wave base.
