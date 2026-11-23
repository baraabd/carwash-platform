# W03 entry and integrated defect ledger — proposal only

Source: `82e7402ed9ab6cc4f565f423441cd0655f2d627a`.
These are source-linked missing prerequisites or static adoption risks, not
executed W03 failure reports. Owner assignment is a review request; E does not
edit A–D product sources or send separate reviewer messages.

| ID / owner                                         | Finding and source                                                                                                   | Required closure / blocked dependent gate                                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| W03-E-01 / E + affected owners                     | parallel-contract-release.json has BASE_W02=null, BASE_W03 absent and accepted list empty                            | Complete predecessor policy/contracts/providers/barriers; publish real immutable bases and accepted versions before runtime consumers             |
| W03-E-02 / E + product/security/A                  | Guest scope/recovery/delegation absent; IdentitySession requires account                                             | Reviewed security/production copy/lifetime/linkage and real authorization; blocks guest journey                                                   |
| W03-A-01 / A                                       | Customer session/confirmation fixtures; C014 reload expects not-found; Customer/Vehicle/Geo product APIs absent      | Real ownership/serviceability providers then durable authorized app recovery                                                                      |
| W03-B-01 / B                                       | Pricing/Billing schemas marker-only; quote/ledger prototypes unconnected                                             | Actual quote validity/binding and independent cash-due provider with constraints/receipts; no fixture currency/price policy                       |
| W03-C-01 / C                                       | Scheduling/Booking schemas marker-only, no holds/intent/coordinator                                                  | Real capacity constraints, narrow intent authority and durable saga/recovery/compensation                                                         |
| W03-C-02 / C with D/E consumers                    | Workforce/Media marker-only; no private document review                                                              | Binding → Media processing/private grants → review/eligibility, real admin-to-owner mutations/audit                                               |
| W03-D-01 / D                                       | Admin technical boot and prototype review buttons lack handlers; Configuration policy provider absent                | Approve missing production review/recovery states and implement scoped consumer against accepted real providers                                   |
| W03-E-03 / B/C/D/E                                 | W02 money/revision/quote-use and execution/payment prerequisites differ                                              | Owner/consumer semantic review, compatible parsers/adapters and approved policy; no unilateral shared wire selection                              |
| W03-D-02 / D                                       | Communications/Reporting prisma-inbox.store.ts catches every P2002/23505 as DUPLICATE                                | Real concurrent different-byte same-ID and unrelated effect-unique failure tests; only proven winning Inbox/hash may authorize duplicate ACK      |
| W03-B-02 / B, E technical review                   | Catalog prisma-outbox.store.ts increments lease attempts; final crashed lease is excluded while dead_at remains null | Deterministic final-attempt crash with durable observable parking/reconciliation; no silently stranded work                                       |
| W03-E-04 / E topology + producer/subscriber owners | Rabbit bootstrap covers probe identities only; mandatory publish can succeed with one required subscriber missing    | Accept complete topology/ACLs before business producer activation; stopped-consumer catch-up and partial-binding failure gate                     |
| W03-E-05 / E topology + D consumers                | DLQ durability lacks explicit transfer strategy/policy                                                               | Real DLQ outage/recovery, integrity-preserving authorized replay/audit; do not infer loss-free transfer                                           |
| W03-E-06 / E technical + B runner                  | Catalog creates ConfirmingPublisher each relay pass; return/close listeners have no disposal                         | Long-running channel/listener lifecycle acceptance or reviewed ownership fix before durable adoption                                              |
| W03-E-07 / E + B/C/D                               | Confirm/finalization replay test resets flag; current hard crash seam is lease acquisition                           | Real deterministic confirm→mark crash; preserve immutable event identity and one local consumer effect                                            |
| W03-E-08 / E + schema owners                       | Acceptance compose starts PG/RabbitMQ only; BASE_W02 product baseline missing                                        | Actual accepted-source combined stack, separate roles/migration jobs and populated-baseline upgrade                                               |
| W03-E-09 / E + A/C/D                               | HTTP artifact tests and F010 harness do not execute all product journeys                                             | All explicit builds plus actual app browser execution, recovery/parity and separate Windows/device evidence                                       |
| W03-E-10 / E + reviewer/admin                      | main unprotected, rulesets empty, no PR50 review submission; old lease publication unreconciled                      | Eligible independent approval, reviewed permanent path allocation and administrator enforcement; same-login sessions are not independent approval |

The previous W02 E packet documents 26 paths undeclared under a hypothetical
post-lease fallback. That diagnostic was not BASE_W02 publication or permission
restoration. Reconcile exact permanent ownership through reviewed policy work.
The current instruction already prohibits bootstrap edits in peer product sources.

Every listed race/auth/financial mismatch blocks its dependent integration gate.
Provider-owned fixes return to that owner; accepted combined-source reruns and
actual resulting-target verification are required. No issue is marked resolved by
this documentation child or a green foundation build.
