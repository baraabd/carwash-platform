# Current source and approved-reference mapping

Audit source: `3db1afdd04c6ec65a38ca83f3993c964a1bf7587`.
This supersedes W01-B's historical **source inventory observation**, not its
ownership/policy decisions. Source hashes are in [ENTRY_EVIDENCE.json](ENTRY_EVIDENCE.json).

## Real foundation versus requested product

| Owner             | Current source                                                                                                       | Missing W02 product behavior                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog           | Nest health/Prisma foundation; ServiceMarker, FoundationProbe, OutboxMessage; disposable probe transaction and relay | Versioned definitions/descriptions, applicability, retirement, audited authorized publishing and business transport                    |
| Pricing           | W01-E Nest/Prisma foundation; ServiceMarker only; health/runtime tests                                               | Price versions, immutable quotes, quantities/calculation evidence, durable command receipts/audit, business Outbox/Inbox and transport |
| Configuration (D) | Technical foundation with BUSINESS_READY=false                                                                       | Accepted currency/rounding/fee/tax/TTL/catalog policy producer and revision semantics                                                  |
| Identity (E)      | Real signed account/session validation and revocation; current permission vocabulary                                 | Accepted guest capability, Catalog/price publisher and admin actor-to-beneficiary scopes                                               |
| Gateway (E)       | Versioned routing contracts; existing protected customer/packages route                                              | Reviewed Catalog read compatibility and Pricing owner/origin/quote/publication routes/errors                                           |

Catalog and Pricing both set `BUSINESS_READY=false`. Existing DB probes are not
wired as business dependency acceptance; do not make readiness true just to pass CI.
The legacy Catalog README grouping and pure quote helper do not override F001:
Catalog owns definitions/durations/applicability; Pricing owns rates/quotes/promotions.
The helper's rounding, quantity cap and numeric maximum are not approved policy.
No import of that Catalog implementation into Pricing is permitted.

Existing migrations are historical, never edited:

- Catalog: `20260920000000_sprint_02_foundation`,
  `20260927143000_f008_outbox_trace_context`.
- Pricing: `20261005060000_w01_foundation`.

New migration IDs for W02: **none** while entry is blocked. Later B-owned schema
mirrors and appended migrations must match, upgrade the foundation and preserve
its existing data/checksums. Separate canonical identities exist for `cw_catalog`
with `cw_catalog_app`/`cw_catalog_migrate`, and `cw_pricing` with
`cw_pricing_app`/`cw_pricing_migrate`. They are not an allocated B/W02 test run.

## Canonical display identifiers

Read from the frozen customer HTML and
`apps/customer-web/src/fixtures/customerCatalogFixture.ts`. These are reference
identifiers/illustrative display data, **not approved production seeds, rates,
durations, currency or eligibility policy**. E/A/B must accept durable ID mapping.

| Kind          | ID       | Approved reference label |
| ------------- | -------- | ------------------------ |
| Package       | exterior | لمعة سريعة               |
| Package       | complete | نظافة متكاملة            |
| Package       | premium  | عناية استثنائية          |
| Add-on        | seats    | تنظيف المقاعد            |
| Add-on        | wheels   | تلميع الإطارات           |
| Add-on        | fresh    | تعطير المقصورة           |
| Vehicle class | sedan    | سيدان                    |
| Vehicle class | suv      | كروس أوفر                |
| Vehicle class | large    | دفع رباعي                |
| Vehicle class | pickup   | بيك أب                   |

Premium's fixture includes wheels. The accepted production Catalog must publish
its actual inclusion relation, and Pricing must avoid incremental double charging.
Keep the separate VEHICLE surcharge line and category extra duration; do not
merge them into an unexplained package total. Location/zone IDs and authoritative
eligibility revisions are not published: depend on A's Geo and D's Configuration.
Guest quotes remain supported; optional plate is not a price/identity prerequisite.

All three approved HTML references and their customer seven-step flow, Arabic
copy, RTL, icons, motion, focus and payment layout remain unchanged. Cash,
ShamCash and Syriatel Cash remain the frozen UI methods. Paymera's unresolved
scope is not a new method or an implicit exclusion; provider activation is later
and does not follow from an issued quote.

## Contract incompatibilities to reconcile

The W01 closed schemas omit Catalog retirement/description revisions and
quote quantities/actor-versus-beneficiary/delegation fields. E's intake also
records B/C/D differences in money field names and currency-policy revision types.
See [CONTRACT_DELTA_REQUESTS.md](CONTRACT_DELTA_REQUESTS.md); no local private DTO
or runtime fallback resolves a publication incompatibility.
