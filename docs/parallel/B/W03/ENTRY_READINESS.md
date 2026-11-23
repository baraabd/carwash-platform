# W03-B — Entry proof required before dependent writes

Observed source: `82e7402ed9ab6cc4f565f423441cd0655f2d627a`,
tree `050b4b8a03be2bc671cbaa00151ea7105891e2d4`. Status: **ENTRY_BLOCKED**.
Publication evidence is assessed from this source, not inferred from a merged
proposal, a planned endpoint or historical green checks.

| ID       | Actual dependency / source fact                                                                                                                                                                             | Producer and concrete proof                                                                                                                                                                                                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ENTRY-01 | No published BASE_W03; BASE_W02 remains null. Merged W02-B is a proposal, with no persistent quote provider. E W02 explicitly disclaims W03/base acceptance.                                                | E: immutable full SHA, reconciled writer record, independent release/barrier record, resulting-target mandatory checks and accepted real W02 Catalog/Pricing evidence.                                                                                                                                      |
| ENTRY-02 | No accepted Billing/Pricing validation/Booking commands, client exports or finance events. Existing B/C/D drafts have incompatible field/revision/method vocabulary.                                        | B/C/A/D + E: reviewed exact schemas/versions, quote ownership/use/expiry rules, unique business reference, allowed transitions, stable command status/replay and compiled public clients in the common base.                                                                                                |
| ENTRY-03 | B-03–B-07/B-15 remain open; approved currency/limits/recognition/account usage/cancellation rules have not been supplied. Configuration is a business-unready shell.                                        | Accounting/product owner + D/B: approved effective policy revisions, authorized account categories/use, journal-producing facts, money precision/bounds, cancellation/reversal and retention/deadline decisions; real published policy provider.                                                            |
| ENTRY-04 | Identity currently exposes billing.read/refund, not Billing intent/obligation/posting/compensation authority or accepted guest/service critical-operation credentials.                                      | E + A/C/B: current principal/service audience, operation scope, guest-object binding, delegation/beneficiary and revoked/suspended checks; real HTTP tests for unauthorized peers/actors.                                                                                                                   |
| ENTRY-05 | Billing lacks contracts/client/security/messaging dependencies. Existing Gateway summary/refund routes do not implement creation/status/compensation. Financial stores/event bindings and gates are absent. | E: reviewed manifests/lockfile/exports/routes/broker permissions and executable provider/consumer gate manifest, including all mandatory CI and explicit affected app commands. Resolve provisioning replay versus ledger restrictions.                                                                     |
| ENTRY-06 | Canonical cw_billing runtime/migration identities and allocator exist, but no provisioned B/W03 run is evidenced; local Docker is absent.                                                                   | E: actual isolated Compose/port/DB-role/queue/object/browser/output allocation, usable merged providers, separate runtime/migration access and cleanup evidence. Resource names alone do not provision it.                                                                                                  |
| ENTRY-07 | Real quote → Booking → obligation with unavailable capacity and duplicate delivery is not implemented/tested.                                                                                               | A/C/E/B: downstream serialized latest-target integration candidate with real providers, exact schema inventory, unchanged refs, independent review, all task-listed cases and resulting-target checks. This is a parent acceptance gate, not a circular prerequisite for the narrow provider's first write. |

## Exact entry-source anchors

- `architecture/parallel-contract-release.json:20–23,87–94`: BASE_W02 null,
  accepted next-wave list empty, publication SHA/review/versions absent.
- `docs/parallel/E/W02/ENTRY_AUDIT.json:127`: BASE_W03 null.
- `docs/parallel/E/W02/README.md:17–21,37–39`: prompt expires bootstrap permission,
  registry reconciliation remains necessary; no W03 implementation/base publication.
- `services/billing/prisma/schema.prisma:22–28`: only ServiceMarker.
- `services/pricing/prisma/schema.prisma:22–28`: only ServiceMarker.
- `services/billing/src/app.module.ts:15,27–38`: BUSINESS_READY=false;
  HealthModule/Prisma only.
- `packages/contracts/src/registry.ts:15–31`: Identity/Gateway surfaces only;
  `packages/api-clients/src/index.ts:1–2`: empty client exports.
- `packages/contracts/src/identity.ts:21–22`: current Billing permission vocabulary;
  `services/billing/package.json:14–24`: current dependencies.
- `infra/postgres/provision.sh:98–106`: blanket runtime DML grants, including replay.
  `tests/integration/postgres-privileges.test.mjs:181–202` tests marker DML/isolation,
  not immutable financial rows.

Line anchors describe the observed immutable source. Fingerprints in
[ENTRY_EVIDENCE.json](ENTRY_EVIDENCE.json) bind actual source bytes and model/migration
inventory. They do not upgrade any inherited foundation result to business acceptance.

## Required policy decisions

1. Approve a chart/account-category policy, permitted principal/account use and
   the facts that recognize a receivable/revenue/clearing/custody/settlement entry.
   Intent request alone never proves collected money. Whether a due obligation
   creates any journal is an accounting input, not a developer's default.
2. Resolve currency/exponent/canonical amount/aggregate bounds and conversion
   exclusion with the accepted quote schema. The old ledger helper's format and
   line/amount bounds are not an approved monetary policy.
3. Freeze quote expiry/validation/use semantics: when verification is authoritative,
   whether quote use is exclusive/reserved, commit deadline and durable recovery.
   A successful read cannot eliminate a validation-to-commit race.
4. Freeze cancellation/compensation eligibility and account reversal rules,
   financial critical-operation grants and guest/service ownership. Booking owns
   saga deadlines; Billing records only its financial result and compensation.
5. Specify command key/fingerprint/status/conflict/terminal replay retention,
   rejected-outcome behavior, inbox collision quarantine and event gap recovery.
   Do not drop a receipt/tombstone in a way that permits recreation of old effects.

## Permanent ownership and scope

The current user prompt and merged E W02 interpretation end W01 bootstrap
permission. B remains the permanent source writer; E owns shared manifests,
packages, Gateway, registries and infra. No conditional old lease is exercised.
Missing accepted base/contracts/accounting inputs independently block the
dependent implementation. This packet adds no extra approval flow.

All seven customer steps, optional plate, guest journey and cash/ShamCash/Syriatel
remain required. W03 intent creation does not call a provider, collect cash,
fund a Wallet or alter UI. Paymera scope, custody-holder/purpose and production
copy decisions remain separately open for the affected future gates.

## Exit proof and stop

Each ENTRY item needs actual producer, immutable release/ref, schema/package/policy
revision, actor/environment and test artifacts. Proposed commands are not executed
gates. Close pre-write items for the applicable provider child; then prove ENTRY-07
on combined real source. Parent remains pending until every task case passes.
No source write, accepted BASE_W03, policy approval or business DONE is asserted.
