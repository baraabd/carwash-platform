# W06-A — customer account and private experience entry

Task **W06-A**, Lane **A**, phase **ENTRY_PROPOSAL**. Product implementation
**BLOCKED / NOT_STARTED**; parent **NOT_ACCEPTED**. The missing-base fallback
authorizes this bounded source analysis and lane-local proposal, not dependent
business implementation.

Observed proposal parent/main: `78adaa2d0436f9e0fc6697a36f3f0bd7a521ad8b`;
tree `c5bd3137ef9d4e0ab7b70b9646e126f10e011883`. **This is not BASE_W06.**
Own branch/worktree: `proposal/w06-A-account-entry`,
`/workspace/scratch/6a9547568741/carwash-w06a-source`. Final full head/tree,
dated remote metadata and current-head CI/reviews are bound in the draft PR.

## Current truth

- The E release registry remains W01 INTEGRATION_PENDING, BASE_W02:null,
  no BASE_W03/W04/W05/W06 and no accepted next-wave business contracts.
  Merged W05 proposals do not publish an executable W06 base.
- Shared contracts/event-contracts/api-clients remain 0.0.2/0.0.2/0.0.1.
  Identity/Gateway foundation and foundation probe/strict contract-only
  booking.confirmed.v1 exist; business API-client exports are empty.
- Customer/Vehicle/Geo have only ServiceMarker and technical health/Prisma
  shells, with business readiness false. Wallet/Subscription/Media/Support/
  Reviews are also marker-only; Communications has technical probe/inbox data.
- AccountRoute activates only addresses and garage, backed by React memory.
  Other account actions are deferred. No server wallet, support conversation,
  eligible-service review or private before/after journey is implemented.
- C014 #41 is merged. Its explicit unpaid session demo is not a durable booking
  or Identity/Customer provider; no duplicate C014 branch/PR is created.

## Scope and authority

A owns customer-web and Customer/Vehicle/Geo plus its lane-local packet. All
package.json/locks/tsconfigs/Dockerfiles, shared packages, architecture, global
CI/infra/configuration remain E-owned. Current task expiry overrides historical
bootstrap leases; missing accepted contracts separately blocks product writes.
Only new A-owned documents/specifications are changed. No service/app source,
schema, migration, approved reference, snapshot or peer work is modified.

Preserve the seven separate booking steps, Arabic/RTL, optional plate, guest
access, exact approved SVG/layout/copy, focus, motion and reduced motion. Demo
merchant QR configuration/payment tours do not become customer production
payment powers. No stored-value funding/withdrawal, fourth checkout method,
marketplace, payroll, recurring debit or invented subscription policy is added.

## Proposed child sequence — scope/gates require E agreement

| Child / owner                                     | Prerequisite and required real acceptance                                                                                                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W06-ENTRY-BARRIER / E with all owners             | Real predecessor acceptance; immutable BASE_W06, approved scope/retention/copy, shared contracts/grants/clients and isolated executable gate manifest.                                    |
| W06-A-ACCOUNT-PROVIDERS / A with E                | Accepted Identity ownership and profile/contact/preferences/consent/Vehicle/Geo contracts; real owned DB/HTTP/auth/constraints and revision/reload behavior.                              |
| W06-PRIVACY-OWNER-ACTIONS / each data owner       | Approved coordinator and frozen required-owner/action manifest; exact per-owner export/reset/deletion/retention/evidence, Media delivery and recovery. A supplies only its owned actions. |
| W06-B-FINANCE-PROVIDERS / B                       | Approved holder/purpose and real Billing-backed Wallet/Subscription snapshots/events/actions; no client-created money.                                                                    |
| W06-C-D-EXPERIENCE-PROVIDERS / C/D with E         | Narrow Booking eligibility/participant purpose, private Media, Support/Communications/Reviews, retention approvals and current authorization.                                             |
| W06-A-ACCOUNT-CONSUMER / A                        | Merged real account/finance/privacy providers; truthful per-owner status, balance/history, preferences and guest isolation through reload.                                                |
| W06-A-PRIVATE-EXPERIENCE-CONSUMER / A             | Merged real participant/case/review/Media providers; full authorized chat, case recovery, moderation and private comparison journeys before consumer merge.                               |
| W06-E-BARRIER / E + eligible independent reviewer | Latest-target/exact-head candidate, all mandatory/task gates, unchanged refs and resulting-target checks before promotion.                                                                |

If privacy intake requires owner effects and those effects require an intake,
first accept the narrow request identity/authorized purpose binding and owner
action contracts, then the coordinator and consumer. If Media requires a case or
conversation, accept its narrow purpose/participant authority before attachments.
No final UI/fixture/moving peer branch becomes an implementation base. Provider
success alone cannot accept the full parent; started integration stays pending
until every required affected journey passes.

## Deliverables and stop point

- [Approved account/action inventory](APPROVED_ACCOUNT_INVENTORY.md).
- [Account and per-owner request/retention semantics](ACCOUNT_REQUESTS_AND_RETENTION.md).
- [Wallet/support/review/private Media authority and recovery](SUPPORT_REVIEW_PRIVATE_MEDIA.md).
- [Acceptance specifications](../../../../tests/parallel/A/W06/ACCEPTANCE_SPECIFICATIONS.md): all new families UNEXECUTED.
- [Early W07 contract requests](W07_CONTRACT_REQUESTS.md): proposed/unaccepted.
- [Resumable English checkpoint](CHECKPOINT.md) and [source observation](source-observation.json).

Stop at the W06-A draft handoff. No merge, deployment, live money/provider action,
W07 implementation or DONE claim. Resume dependent coding only after accepted
inputs/common base and the next authorized task prompt.
