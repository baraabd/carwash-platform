# W07-A — bounded W08 validation and source-bundle requests

Status: **PROPOSED / UNACCEPTED / NOT IMPLEMENTED / CASES UNEXECUTED**. Packet `w07-a-w08-customer-validation/0.1.0`; proposed metadata wire major V1 is a review request, not an exported package, accepted gate or release approval. This handoff adds no W07 business capability or implementation permission.
Observed source: `main@f01e87f4619414960e9e39c65e523a3250fbcbaf`, tree `2266f157ad2480855011d5da59e00e5b0cf1f68f`. Repository/source analysis only; no service, browser, database, broker, load or provider operation was run.

## 1. Current entry and design truth

- `architecture/parallel-contract-release.json` retains `BASE_W02:null`, `acceptedNextWaveContracts:[]`, empty published next-wave package versions; no accepted BASE_W07/BASE_W08 exists. Merged A/B/C/D/E W06 requests are proposals, not producers or acceptance records.
- Product Customer/Vehicle/Geo/Wallet/Subscription/Media/Support/Reviews remain marker foundations; Communications/Reporting inbox/probe does not implement chat/business projections. Public API clients still export nothing. Existing contracts/event-contracts0.0.2 and clients0.0.1 do not contain W07 commerce/admin families.
- `apps/customer-web/src/app/routes.ts` preserves seven booking decisions and home/orders/garage/account/payment/tracking routes. C001/C014 and current fixtures/session state describe prototype behavior, not real Booking, price, slots, payment or entitlement. No production bundle was built or accepted in this audit.
- `docs/design/f010-reference-manifest.json` registers customer/technician/admin references in **ar/rtl** only. The approved admin prototype at lines141–151 contains an illustrative ar/en dictionary and language/direction toggle; existing English strings are source evidence, not an independently approved complete English/LTR production reference for customer/operator/admin. Runtime app remains `operator-web`, though the locked reference is named technician. `docs/design/ACCEPTANCE_MATRIX.md` explicitly requires separate reviewed English/LTR translation/layout acceptance; **complete approved English/LTR production references are absent and remain a named full-scope blocker**.
- Product subscription/promotion/history/recovery/empty/help screens and additional production states require actual approved reference/copy decisions where missing. Existing Arabic prototype visuals do not approve invented English or new product screens. Preserve required scope as blocked, not silently omitted.
- Existing F010 canonical widths320/390/430/768/1024/1440, height900, DPR1, pinned locale/timezone/clock and zero allowed diff ratio are recorded reference-harness settings, not new performance or accessibility SLAs. Keep them unchanged; separate device/Windows interaction evidence from controlled Linux pixels.
- Current Gateway rejects query strings and lacks published query/precondition/conditional/304/stream/private-byte adapters and several business owner routes. Required owner/client transport must precede lists, recovery and private downloads, not be bypassed with direct private service imports.

## 2. W06 request reconciliation before a W08 common base

References below are under `docs/parallel/`. From the intended `docs/parallel/A/W07/` artifact, use [A W06](../W06/W07_CONTRACT_REQUESTS.md), [B entry](../../B/W06/ENTRY_CONTRACT_REQUESTS.md), [B lifecycle](../../B/W06/SUBSCRIPTION_LIFECYCLE.md), [B W07 requests](../../B/W06/W07_CONTRACT_REQUESTS.md), [C W07 requests](../../C/W06/W07_CONTRACT_REQUESTS.md), [C child sequence](../../C/W06/CHILD_SEQUENCE_AND_RECOVERY.md), [D W07 requests](../../D/W06/W07_CONTRACT_REQUESTS.md), [E integration](../../E/W06/INTEGRATION_AND_CONTRACT_REQUESTS.md), [E gaps](../../E/W06/W07_SCOPE_GAPS.md) and [E blockers](../../E/W06/BLOCKERS_AND_DECISIONS.md). Resolve applicable action/field/major and policy choices with owners; do not expand W07 implementation to satisfy a broader peer request without approval.

| Proposed issue ID              | Exact source comparison                                                                                                                                                                                                                                                                                                                                                                         | Required acceptance decision and conformance evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| W08-A-C01 MANAGE               | `A/W06/W07_CONTRACT_REQUESTS.md:134–140,182–184` has FREEZE/RESUME/CANCEL plus policy/reason and prose effective/fence rules; `B/W06/ENTRY_CONTRACT_REQUESTS.md:130–135` requests renewal/cancel/pause/resume/change, requested effective date and action-applicable original/new plan/term/financial refs; `B/W06/SUBSCRIPTION_LIFECYCLE.md:81–86` distinguishes requested/scheduled/effective | B/E publish exact FREEZE/PAUSE mapping, allowed immediate/scheduled actions and action-specific fields. Do not require a new term for every freeze, invent renewal/change UI, or equate requested cancel to effective cancel. A parser and actual B/C fence/status must agree.                                                                                                                                                                                                                               |
| W08-A-C02 PROMO-QUOTE          | A W06:210–238 reserve/view bind one quoteRef; :294 initial quote→reserve→revalidated quote; B W06 W07:89–94 requests quote/policy refs but no closed rebind/supersede                                                                                                                                                                                                                           | Publish whether revalidation retains quote identity/revision or produces a new immutable quote, and actual authorized reservation association/consent transition. Ref/hash/revision equality and changed-price tests must close the loop; no local alias, fabricated reservation or silent quota transfer.                                                                                                                                                                                                   |
| W08-A-C03 C-AUTHORITY          | A W06:244–246 requires real narrow intent and action-specific current C commit/release authority; C W06 W07:7–9 only semantic families; `C/W06/CHILD_SEQUENCE_AND_RECOVERY.md:7,10` and B ENTRY:155–164 require split binding/consumer sequence                                                                                                                                                 | Accept concrete C binding/status/action-authority/closure/fence schemas and real providers before B reserve/redeem/manage and A consumer. Cached Booking status/expected revision alone cannot authorize commit/release or close a late worker. RELEASE before confirmation binds real intent without invented confirmed Booking; REDEEM needs actual Booking/effect.                                                                                                                                        |
| W08-A-C04 REPEAT-v-AMEND       | A W06 §§5,8 defines fresh repeat and never cancels historical source as compensation; B W06 W07:107–127 discusses financial amendment/replacement; C W06 W07:8–9 requests fresh quote and cancellation fences                                                                                                                                                                                   | Keep independent fresh repeat versus modifying a current Booking as distinct accepted operations. Reuse only permitted current choices, reacquire price/coverage/capacity/benefits and explicit consent; preserve source history. Amendment financial delta/old-slot preservation is not implied by repeat.                                                                                                                                                                                                  |
| W08-A-C05 HOLD/ENTITLEMENT     | A W06:185; B ENTRY §§W06-B-05/07; E W06 `INTEGRATION_AND_CONTRACT_REQUESTS.md:87–94` flag old Wallet RELEASE nonempty postings and strict Booking event                                                                                                                                                                                                                                         | Accept action-discriminated new major/separate no-financial-effect release where approved; old V1 stays strict. Subscription owns units; C saga requests approved transitions. Fenced terminal noncommit precedes restoration; consumed value needs linked correction. No fictional posting, refund-implies-units or widening strict booking.confirmed.v1.                                                                                                                                                   |
| W08-A-C06 ADMIN/POLICY         | A W06 §§6–7 excludes admin consent/credential/owner/balance edits, requires role+object/purpose and Geo publication readiness; D W06 W07 rowsD07-05/10/12/14; E W06 G01/G03/G04/G25/G26                                                                                                                                                                                                         | Publish owner-specific allowed action/fieldset/grant map and actual scope-ticket authority. D consent row cannot authorize acting as another customer's consent. Geo coverage/provenance, Pricing monetary fees, Scheduling hours/capacity and Configuration approved policy remain distinct; D consumer/admin or generic role grants no business DB/policy authority.                                                                                                                                       |
| W08-A-C07 SHARED PROFILE       | A W06 common numeric entity revisions/opaque publications/UUID/minor strings; B W06 ENTRY common and D W06 W07 common have unresolved owner IDs/revision/money alternatives; E W06 integration profile says conflicts unaccepted                                                                                                                                                                | E publishes exact scalar parsers, opaque-token adapters/new majors, canonical Money/exponents/policy, UTC boundaries, key/replay/lookup and safe errors. No local coercion or invented currency/precision/TTL. Provider and all current/retained consumers agree before base publication.                                                                                                                                                                                                                    |
| W08-A-C08 CURRENT DEPENDENCIES | E W06 `BLOCKERS_AND_DECISIONS.md` E06-B04–09 plus recovery matrix; D W06 W07 D07-11/E G23 retain earlier privacy vocabulary/timing reconciliation; current B W06 W07:7–8,156–158 expressly preserves W06 fulfillment                                                                                                                                                                            | Required source-owner closures and actual per-owner privacy execution/retention map precede affected acceptance. Source findings are not reproduced exploits or tests. Current B preservation resolves no accepted coordinator/policy by itself but does not ask to defer W06 execution; do not reopen or reschedule that required scope. Keep owner action/status/copies and financial retained evidence truthful; W08 does not grant global deletion, relabel W06 fulfillment or create a Privacy service. |

Compatible proposals agree on independent money/entitlement/capacity/work facts, immutable snapshots, current actor/guest/object purpose, durable original-operation UNKNOWN recovery and producer-first consumers. The rows above are remaining publication/authority gaps, not a new accepted policy or claim of direct business contradiction.

## 3. Proposed closed validation metadata V1 (E shared ownership)

Only evidence/profile/bundle metadata needs new candidate shapes here; business request/response/events remain owner-reviewed W07 contracts. All fields below required unless nullable or optional; reject unknown fields/majors/enums. Approval references resolve to protected accountable decisions, not a candidate's self-authored approval.

```ts
type UUID = string; // canonical candidate UUID; exact accepted parser remains E input
type GitSHA = string; // full40 lowercase hex for observed Git object format
type SHA256 = string; // full64 lowercase hex digest of the identified bytes
type UTC = string; // strict valid YYYY-MM-DDTHH:mm:ss.sssZ, server-recorded
type Lane = 'A' | 'B' | 'C' | 'D' | 'E';
type Verdict = 'UNEXECUTED' | 'BLOCKED' | 'PASS' | 'FAIL';
type SourceAnchor = {
  phase: 'OBSERVATION' | 'CANDIDATE' | 'RESULTING_TARGET';
  sourceSha: GitSHA;
  treeSha: GitSHA;
  acceptedBaseSha: GitSHA | null;
  targetSha: GitSHA;
  headSha: GitSHA | null;
  recordedAt: UTC;
};
type ArtifactRef = {
  artifactId: UUID;
  locator: string;
  sha256: SHA256;
  bytes: number;
  producedAt: UTC;
  classification: 'SYNTHETIC' | 'REDACTED';
};
type ContractRef = {
  owner: Lane;
  contractId: string;
  requestVersion: string | null;
  responseVersion: string | null;
  eventVersion: string | null;
  clientPackage: string | null;
  clientVersion: string | null;
  schemaArtifact: ArtifactRef;
};
interface ValidationCaseV1 {
  schemaVersion: 1;
  caseId: string;
  owner: Lane;
  consumers: Lane[];
  requirementRef: ArtifactRef | null;
  source: SourceAnchor;
  contracts: ContractRef[];
  environmentRef: ArtifactRef | null;
  mode: 'SOURCE_ANALYSIS' | 'CONTRACT_FIXTURE' | 'REAL_PROVIDER';
  verdict: Verdict;
  runId: UUID | null;
  command: { cwd: string; argv: string[]; exitCode: number | null } | null;
  startedAt: UTC | null;
  finishedAt: UTC | null;
  outcomeRefs: ArtifactRef[];
  blockerIds: string[];
}
interface BundleComponentV1 {
  componentId: string;
  owner: Lane;
  kind: 'APP' | 'SERVICE' | 'SHARED_PACKAGE';
  sourcePaths: string[];
  entrypoints: string[];
  declaredVersion: string;
  buildCommand: { cwd: string; argv: string[] };
  artifacts: ArtifactRef[];
  contracts: ContractRef[];
  dependencies: {
    name: string;
    resolvedVersion: string;
    integrity: string | null;
    source: 'WORKSPACE' | 'LOCKFILE';
  }[];
  migrations: { id: string; path: string; sha256: SHA256 }[];
  configRefs: ArtifactRef[];
}
interface SourceBundleV1 {
  schemaVersion: 1;
  bundleId: UUID;
  source: SourceAnchor;
  lockfileRef: ArtifactRef;
  toolchainRef: ArtifactRef;
  components: BundleComponentV1[];
  requirementInventoryRef: ArtifactRef;
  approvedDesignRefs: ArtifactRef[];
  caseIds: string[];
  missingInputs: string[];
  verdict: Verdict;
}
interface LoadProfileV1 {
  schemaVersion: 1;
  profileId: UUID;
  approvalRef: ArtifactRef | null;
  environmentRef: ArtifactRef | null;
  datasetRef: ArtifactRef | null;
  journeyMix: { caseId: string; weight: string }[];
  concurrentActors: number | null;
  arrivalsPerSecond: string | null;
  warmupMs: number | null;
  durationMs: number | null;
  networkDeviceRef: ArtifactRef | null;
  targetSetRef: ArtifactRef | null;
}
interface LoadResultV1 {
  schemaVersion: 1;
  profileId: UUID;
  profileRef: ArtifactRef | null;
  targetSetRef: ArtifactRef | null;
  source: SourceAnchor;
  runId: UUID | null;
  verdict: Verdict;
  startedAt: UTC | null;
  finishedAt: UTC | null;
  measurements: {
    metric: string;
    unit: string;
    aggregation: string;
    value: string;
    sampleCount: number;
    intervalStart: UTC;
    intervalEnd: UTC;
  }[];
  diagnostics: ArtifactRef[];
  blockerIds: string[];
}
interface ScreenAcceptanceV1 {
  schemaVersion: 1;
  caseId: string;
  app: 'customer-web' | 'operator-web' | 'admin-web';
  route: string;
  stateCode: string;
  language: 'ar' | 'en';
  direction: 'rtl' | 'ltr';
  approvalRef: ArtifactRef | null;
  referenceRef: ArtifactRef | null;
  source: SourceAnchor;
  browserDeviceRef: ArtifactRef | null;
  viewport: { widthCssPx: number; heightCssPx: number; deviceScaleFactor: string } | null;
  motion: 'NORMAL' | 'REDUCED';
  evidence: ArtifactRef[];
  verdict: Verdict;
  blockerIds: string[];
}
```

- SourceAnchor OBSERVATION may have acceptedBaseSha=null and cannot establish acceptance. Candidate/result gates require the real accepted base; sourceSha/treeSha must resolve to executed candidate/result bytes. Candidate additionally binds exact target/head; resulting target records actual merged target and retained proposal head provenance. A changed source/config/contract/reference invalidates applicable old evidence.
- ValidationCaseV1 PASS requires non-null accepted requirementRef and means the named case passed its accepted assertions, not production readiness, independent approval or all scopes passed. UNEXECUTED has no command/run/times/outcome; BLOCKED names exact unresolved requirements. REAL_PROVIDER PASS requires actual isolated owning DB/HTTP/current auth/consumer effects where applicable; a fixture/source analysis cannot close integrated gates.
- Artifact refs point to retained access-controlled synthetic/redacted evidence; hashes/bytes are actual, not fabricated placeholders. Approved design/reference artifacts additionally retain canonical source identity/approval provenance. Locator access rechecks current purpose; no secrets, signed private URLs, actual contact/plate/merchant credentials/raw proof or transcript in general CI/logs.
- SourceBundle PASS requires every required component/entrypoint/contract/client/config/migration and requirement row to be covered by current real artifacts/cases, no missingInputs. Hashing approved HTML alone proves preservation only. Build artifact hash is distinct from Git tree, lockfile, package tarball integrity and deployed bytes; no unsigned source-map/privacy leak or stale served bundle.
- Load quantities/counts are nonnegative safe integers where applicable, rates/weights/measurements exact canonical decimal strings with accepted metric/unit/aggregation and bounds. Approval specifies workload mix, dataset, duration/warmup/concurrency/rate/network/device and target rules; fields remain null/empty pending approval. **No peak load, latency/throughput/error budget, SLA or retention target is invented.** An unapproved profile/target set cannot yield performance PASS.
- LoadResultV1 PASS requires real non-null profileRef and approved targetSetRef, including immutable content hashes, bytes and approval provenance. The profile bytes must contain that profileId and exactly the same targetSetRef; changing workload, dataset, environment or targets creates a new protected profile identity and result. A mutable lookup by profileId alone cannot bind a PASS. Reject mismatched profile/target hashes and retain prior evidence without overwriting its source binding.
- Screen PASS requires actual approved reference/copy for that language/state plus recorded environment/evidence; en/ltr with absent approval/reference is BLOCKED. Actual Arabic canonical pixels and keyboard/screen-reader/device behavior are separate evidence. Automated axe results do not establish full accessibility, English approval or every-device parity.

## 4. Proposed W08 threat and race cases (all UNEXECUTED)

Each ID maps to exact accepted source requirements and W07-A-G01–08 without replacing earlier mandatory tests. E allocates real isolated resources and fault boundaries; B/C/D execute owner effects, A executes customer/own-admin consumers, D executes admin and C operator positive/negative controls. Never inject faults into production/live money.

| Proposed case IDs   | Concrete provider + consumer assertions                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W08-A-T01 AUTH      | Two members/two guests/guest versus member and delegated admin/service: foreign purchase/benefit/quote/reservation/Booking/Customer/Vehicle/zone/operation/artifact denied; phone/plate/body actor/known ID cannot grant authority. Revoke/reassign between read and command/replay/page/download; current object/purpose still enforced at direct owner and Gateway.         |
| W08-A-T02 COMMAND   | Origin/CSRF, forged audience/delegation/scope ticket, unknown properties/actions/majors, expired policy/grant, malformed IDs/revisions/Money/time, tampered price consent/discount/units/method and direct owner bypass; approved positive controls under current permission. Masked/null reads cannot approve dependent writes.                                              |
| W08-A-T03 PRIVATE   | Customer/contact/plate search/unmask/archived detail and export/media attachment purpose boundaries; staff-only note and another participant subject/scope excluded. Cursor/signed-object capability replay after revoke/expiry denied; artifact/audit/log/event/build output redaction checked. Scan clean is not financial receipt/access/marketing approval.               |
| W08-A-T04 BUNDLE    | Production entrypoints use real frozen clients and fail unavailable safely, with no fixture price/capacity/paid/benefit success, prototype designer controls, merchant secrets or fake persistence. Locked demo reference remains a reference; required UI feature rows remain traceable rather than disappear. Retain build/serve identity and dependency/config provenance. |
| W08-A-R01 BENEFIT   | Simultaneous last-unit reserve, consume versus freeze/cancel/expiry/correction and delayed worker after closure; one actual allowed effect, loser current recovery, independent refund/Booking/unit outcomes. No optimistic restore from timeout, acceptance or expired lease. Real owner DB fence/constraint plus affected customer/operator/admin reads.                    |
| W08-A-R02 PROMOTION | Final quota/budget/per-beneficiary competing uses; stack/eligibility/current publication/expiry changes during quote; reserve→revalidate quote association and new price consent; redeem versus release/cancel/expiry; no cross-key duplication or reuse of UNKNOWN quota. Preconfirm release uses actual intent authority, not invented Booking.                             |
| W08-A-R03 REPEAT    | Completed/cancelled source, removed saved record, retired package/zone, unavailable address/full dates and changed price; fresh quote/current coverage/capacity and explicit confirm. No old hold/price/grant reuse, auto Booking or source-order compensation cancellation. Lost confirm result resolves original operation before another Booking/payment.                  |
| W08-A-R04 ADMIN/GEO | Concurrent customer/vehicle update/archive and current C Booking binding; revoked scope midpage; masked pagination cursor isolation. Geo edit/validation/publication competing versions, stale receipt/readiness, activation/retire during quote/hold and partial adoption; immutable historical snapshots and forward-only audited corrections preserved.                    |
| W08-A-R05 DELIVERY  | Crash after owner commit before response/outbox mark, after broker confirm before mark, after Inbox/effect before ACK; same-ID same/different bytes simultaneous race, unrelated unique constraint failure, old/gap/reordered delivery; original receipt and business identity retained, no duplicated activation/redemption/refund/notification.                             |
| W08-A-R06 RECOVERY  | Exhausted final outbox lease crash, reused-worker stale lease epoch, publisher listener lifecycle and queued/unacked broker restart: actual owner closure plus real receipts/convergence. E06-B04–09 are carried source inferences, not reproduced failures here. Rebuild new fenced generation/current privacy mask cannot send/debit/refund/restore/reopen work.            |

Money and revisions in test assertions use E/B accepted exact representation/source, not recomputed browser values. Compare independently verified received credit, allocation, posting, custody, refund, entitlement and Booking facts separately. Real zero differs from null/partial/unavailable. Approved UTC boundary equality/skew rules, original expiry and each owner revision/fence are asserted; no new test time policy inferred from fixture clock.
Idempotency provider tests freeze owner+major+current actor/delegation+operation+target scope and canonical fingerprint: expected refs, beneficiary/purpose, policy, exact price consent/units/method/actions and meaningful effective time; omitted/null/set/order semantics explicit. Same meaning replays original receipt/expiry after current authorization; changed meaning conflicts; lasting effect uniqueness survives cache cleanup. Lost response keeps original UNKNOWN operation and compensation identity, never a new payment/key or released funds/units/quota.
Safe closed invalid/auth/object/revision/key/policy/limit/source/deadline errors require exact accepted route/status/recovery mappings. Unknown lookup/unavailable owner does not prove noncommit; terminal no-effect needs real fence before restoration. Commands/recovery deadlines, replay/tombstone/event/grant lifetimes and error budgets remain owner/E inputs, not numerical defaults.

## 5. Performance, accessibility and complete inventory acceptance

| Proposed case IDs       | Required actual profile/evidence; no invented targets                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W08-A-P01 JOURNEYS      | Approved mix/data/peak/concurrency/network/device profile for fresh quote, current availability, confirm, benefit/promotion recovery, admin scoped lists and source status. Record accepted latency/throughput/error measurement definitions, raw samples and owner/source dependencies; missing target approval blocks threshold verdict.                                                                      |
| W08-A-P02 PRESSURE      | Bounded query/page/body/event/image limits and actual DB query/constraint behavior under accepted profile; measure CPU/memory/connection/queue/backlog/consumer lag and client bundle/network costs. Long names/Unicode/large allowed datasets and low bandwidth cannot silently change price or lose typed input. No arbitrary bulk PII load dataset.                                                          |
| W08-A-P03 RECOVERY      | Approved workload while actual source outage/restart/gap catch-up/competing commands occurs; current pending/UNKNOWN/partial facts and safe backpressure remain available within accepted criteria. Queues do not count as fulfilled; duration/exhaustion policy approved, no hidden automatic financial retry.                                                                                                 |
| W08-A-X01 ARABIC        | Complete C001 feature/action inventory + seven distinct booking decisions + required account/benefit/promotion/repeat/admin states: RTL/Arabic numerals/mixed-direction IDs, keyboard order/focus/errors/dialog trapping/restoration, screen-reader names/status announcements, optional plate/guest/manual location/offline/reconnect and no auto-confirm. Preserve approved icons/copy/bottom price/footer.   |
| W08-A-X02 MOTION/DEVICE | Natural/reduced motion; no motion-dependent action; before/after drag has approved accessible keyboard/touch alternative, zoom/pause/control behavior and focus. Reference touch target44×44 CSS px remains documented target, not claimed certification. Capture real Linux reference/candidate/diff and separate Windows/device/assistive-technology behavior without force-click/baseline/tolerance changes. |
| W08-A-X03 ENGLISH       | Approved owner English translation/layout/error/recovery/subscription/promotion references and actual LTR/RTL switch/cache/error mapping required. Until approval, record BLOCKED rather than invent English acceptance or remove required bilingual scope. No copied Arabic screenshot declared English proof.                                                                                                 |
| W08-A-S01 COVERAGE      | Map every approved C001/C014/W06 account/W07 feature and actual route/action to owner, reference/policy, accepted contracts/client, source entrypoint, migration/event, exact case and current artifact. Missing production/help/history/recovery/control states stay named gaps. No historic check count or unit-only evidence substitutes for full three-app journey.                                         |
| W08-A-S02 SOURCE        | Build all affected app/service/shared components from accepted common candidate and lockfile; verify dependencies/toolchain/migrations/runtime privilege checks and served artifact equals built artifact. Trace full current three-app affected journey to merged real producers and exact candidate/result tree. Any later source/config/evidence change gets applicable gates again.                         |

Accessibility target/version/tool/browser/assistive technology and risk acceptance must be owner-approved; existing pinned axe-core/Playwright and reference guards are tools, not a certificate. Preserve legitimate failure evidence and meaningful positive controls. Mandatory security/reference/contract/DB/broker/browser tests cannot be removed or relabeled skipped PASS to reach a date.

## 6. Declared bundle inputs and E publication/handoff

The following are actual source declarations only; no installed/build/served production artifact was produced here. Resolve workspace dependencies from the final lock/source and record every actual artifact in SourceBundleV1.

| Current source component                                                                                                                                                                     | Declared version/pins; required final inventory                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [customer-web](../../../../apps/customer-web/package.json)                                                                                                                                   | 0.0.2; React/react-dom19.3.0, router7.18.4, Vite8.3.1, TypeScript5.9.3, Vite React plugin6.1.1; actual route/action chunks, CSS/fonts/assets, source/config/build/served hashes and frozen client exports |
| [Customer](../../../../services/customer/package.json), [Vehicle](../../../../services/vehicle/package.json), [Geo](../../../../services/geo/package.json)                                   | Each0.0.2; Nest11.2.5, Prisma/client/adapter7.10.0, pg8.23.0, reflect-metadata0.2.2, rxjs7.8.2 and workspace service-kit/event-contracts; owned build/migration/schema/role/contract/config artifacts     |
| [operator-web](../../../../apps/operator-web/package.json), [admin-web](../../../../apps/admin-web/package.json)                                                                             | Each0.0.2; Vite8.3.1/TypeScript5.9.3 foundation shell; actual C/D entrypoint and approved journey artifacts required, never shell boot as full product proof                                              |
| [contracts](../../../../packages/contracts/package.json), [event-contracts](../../../../packages/event-contracts/package.json), [api-clients](../../../../packages/api-clients/package.json) | 0.0.2/0.0.2/0.0.1 respectively; final exact owner-reviewed business exports/parsers and retained-reader compatibility still unpublished                                                                   |
| [root toolchain/tools](../../../../package.json), [W01 gate pins](../../E/W01/GATE_MANIFEST.json)                                                                                            | pnpm10.32.1, Node24 range/gate24.21.0; Playwright1.63.0/axe-core4.13.0; resolved lock integrity/tool binaries/browser/fonts/environment hashes and actual command results                                 |

Reference links: [F010 manifest](../../../design/f010-reference-manifest.json), [acceptance matrix](../../../design/ACCEPTANCE_MATRIX.md), [C001 inventory](../../../customer/C001_BEHAVIOR_INVENTORY.md), [customer parity manifest](../../../customer/customer-parity-manifest.json), [A W06 account inventory](../W06/APPROVED_ACCOUNT_INVENTORY.md), [accepted-release registry](../../../../architecture/parallel-contract-release.json).

- E accepts any metadata schema IDs/package/version for validation-case/source-bundle/load-profile/load-result/screen-acceptance only after owner/consumer review. Propose strict metadata parsers/rejection tests to shared packages if justified; A does not publish shared packages or create a new business service/event topic for records.
- E/owners first close W08-A-C01–08 and freeze final W07 fixes before BASE_W08: exact request/response/event/client versions, legacy parser/replay compatibility and old closed schema guards. A/B/C/D provider conformance precedes real consumer and combined-source acceptance; no moving-branch dependency or peer private DTO copy.
- Request accepted grant/audience/scope-ticket provider, guest/recovery/delegation/object permissions, Money/revision/time adapters, query/cursor/precondition/conditional/error/status/private-byte routes, owner origins and broker/outbox/inbox/hash/fence topology. Shared packages/config/locks/tsconfigs/CI/infra are E-owned; domain defect closure goes back to source owner.
- E publishes actual run/gate/resource manifests: isolated lane/wave/run ports, DB/runtime/migrator roles, broker/vhost/queues/DLQ/object prefixes/scanner/browser profiles/artifact paths and one measured heavy slot initially. Allocation labels do not prove real broker/object/browser isolation; record/prove actual resources/owned handles before faults/load and await recovery before cleanup/slot release.
- Current source declares pnpm10.32.1, Node24 range and W01 gate pins Node24.21.0; actual runtime verification remains a required executed gate. Root build/typecheck excludes full frontend coverage; record explicit current app commands for customer/operator/admin plus mandatory owner/integration gates from E's accepted manifest. New load/accessibility/security helpers or dependencies are requests, not commands presumed installed.
- Dependency inventory must record exact resolved lock/workspace versions/integrities, React19.3.0/router7.18.4/Vite8.3.1/TypeScript5.9.3 and current Playwright1.63.0/axe-core4.13.0 as **source declarations**, with actual frozen install/build/security/runtime proof before acceptance. Do not substitute newest upstream dependencies or claim these declarations were tested here.
- E serializes latest target+PR-head candidate; record source/tree/contracts/config/environment and every required/affected case, eligible independent review, unchanged refs, authorized merge and actual resulting target checks. Same GitHub identity/read-only lane review is not independent approval. Evidence report idempotency fingerprints source/config/contract/profile/case/environment identities; changed inputs produce a new run, never overwrite old failure or reuse a PASS for other bytes.
- A handoff lists task/phase/base/target/head/tree, changed paths, migration IDs, exact commands/results/artifacts, actual real versus mocked resources, skipped/blocked cases, external inputs and owned handles (none for this audit). W07-A remains entry/full-scope blocked; W08 proposal grants no implementation, full launch, live-money, destructive production exercise or deployment authorization.
