# W09-A — owner restore and application compatibility probes

**DECLARATIVE / DATASET_NOT_AVAILABLE / RESTORE_NOT_RUN.** These probes need
accepted product schemas/APIs and E's literal scoped commands. No business SQL,
down migration, backup/restore CLI or staging reset is authored here.

## Actual migration boundary at analysis source

| A owner | Existing migration ID | Actual models / limitation |
| --- | --- | --- |
| Customer | 20260920000000_sprint_02_foundation | ServiceMarker(service,schemaRev,createdAt) only. |
| Vehicle | 20261005060000_w01_foundation | ServiceMarker only; no vehicle/history/revision business tables. |
| Geo | 20261005060000_w01_foundation | ServiceMarker only; no published Aleppo geometry/serviceability data. |

All three app modules set BUSINESS_READY=false; domain/application exports are
empty. A marker backup cannot prove customer data continuity. Existing
`tests/integration/migrations.test.mjs` and `scripts/acceptance/lib/migrations.mjs`
exercise foundation deploy/status/drift/schema/role mechanisms. Disposable shadow
create/drop is destructive test machinery, not a staging business restore path.
New migrations in this proposal: []. Future owner migrations remain append-only.

## Independent pre-fault record and post-restore oracles

Protected baseline receipts are obtained from actual owners before the fault;
expected data cannot be derived from restored output. Owners publish their own
queries/APIs under accepted schemas; A never reads a peer DB/Prisma client.

| Probe | Independently retained baseline | Required post-restore result |
| --- | --- | --- |
| Customer authority | Two accounts/two guests, own/foreign objects, current grants/task bindings and revoked/expired cases. | Correct own reads; foreign/unauthenticated/currently revoked scope denied under accepted disclosure rules. Restored credential bytes alone confer no authority; current accepted Identity/session/key policy and owner grants decide access, and revoked authority cannot be resurrected. |
| Customer data/history | Synthetic profile/contact/address/consent/preferences, revisions/archive/deletion and permitted historical Booking references. | Accepted fields/revisions/consent/history match protected baseline; current masks suppress deleted/restricted data; historical Booking snapshots remain immutable. |
| Customer mutation receipt | Original operation scope/fingerprint/durable receipt and independent pre-fault outcome. | Original lookup resolves lost reply; same meaning does not create a second save, changed meaning conflicts; unavailable authority/status remains unknown. |
| Vehicle | Owned/foreign records, optional empty plate, edited/deleted/archived target and C-issued history snapshot links. | Ownership/revision/history preserved; stale edit cannot recreate deleted record; optional plate preserved and old Booking snapshot unchanged. |
| Geo | Accepted Aleppo geometry/policy revision/digest, approved inside/boundary/outside points and precision/time rules. | Exact approved dataset restored; boundary results match independent expectations; missing/stale required authority is explicit unavailable, not fixture coverage. |
| Runtime isolation | E destination/role/configuration manifest and accepted migration inventory. | Own runtime access works; forbidden DDL/migration-history/cross-owner access denied; separate migration role and schemas preserved. |
| Continued booking | Restored A references plus current B/C owner receipts/versions. | Current catalogue/quote/Geo/capacity/benefit revalidation and one explicit new Booking outcome; old hold, quote or payment is not silently reused. |

## E-controlled recovery ordering

1. Approve current/prior source/tree/image/configuration/contract/migration and
   worker inventories, recovery cut or explicit per-owner convergence vector,
   protected populated backups, destination, fault/abort and RPO/RTO profile.
   An atomic cross-service snapshot or global ordering is not assumed.
2. Record backup integrity, coverage, independent original receipts and authority/
   privacy checkpoint. Stop/fence only allocated processes with recorded handles.
3. Restore only approved owner destinations and required authorized C Media
   dependencies. Restore metadata **and actual bytes**, checksum, scan/quarantine/
   finalize/link generations, retention/legal holds/tombstones and private access.
   DB references alone do not prove media recovery.
4. Apply **current** Identity revocation and owner privacy/suppression rules
   before private disclosure, export, replay or resumed work. An older backup
   cannot resurrect deleted authority or restricted media.
5. Renew execution/incarnation authority to fence surviving pre-restore workers,
   even when restored counters/row revisions move backwards. Preserve original
   business/provider identities and receipts while renewing execution fences.
6. Reconcile owners and approved replay with original event IDs/bytes, durable
   Inbox/effect receipts, gaps/frontiers and current privacy masks. Do not clear
   receipts, mint IDs to bypass deduplication, blanket requeue or repeat money,
   notifications, proof effects or entitlement consumption.
7. Run A probes, all affected full customer/operator/admin journeys and continued
   booking. Record residual UNKNOWN/partial effects and permitted D lookup.
8. Retain actual start/end/time source and per-owner convergence/data-loss results;
   compare with approved RPO/RTO definitions, including measured recovery of usable
   app behavior, not only DB restore completion. Record cleanup/abort failures.

B supplies independent financial/benefit/promotion reconciliation; C supplies
Booking/capacity/work/media; D supplies current projection generation/privacy
and support. A cannot repair those facts, infer payment from evidence, revive
expired capacity or restore an entitlement automatically.

## Previous-application / forward-schema compatibility

E retains the exact prior app/worker/client/event/image set and compatibility
matrix. Test the prior application against the **forward-compatible** restored
schema and current contracts, with accepted writes/reads/recovery and current
auth/privacy. Test compatible events and workers, original receipts and pending
effects, then return to the accepted candidate without duplicate effects.

An incompatible combination is NO_GO and uses the approved forward-recovery
route. No guessed down migration, destructive rollback, historical image tag
or old successful badge qualifies. Source/configuration/fix changes require a
new reviewed deployment and affected evidence. E controls orchestration; A
provides only its own schema/data compatibility and customer observations.

All protected backup references, actual data counts/expected fields, commands,
measurement values and objective approvals remain null / NOT_AVAILABLE.
