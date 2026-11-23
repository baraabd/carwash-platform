# W02-E — Entry and prerequisite proposal

Task: **W02-E**, Lane E. Implementation phase: **ENTRY_BLOCKED**. W02 parent implementation: **NOT_STARTED**; W01 parent remains **INTEGRATION_PENDING**. This bounded child is **W02-E-ENTRY-PROPOSAL**; it records analysis and proposed sequencing, not an accepted contract or runtime implementation.

The audited target is `3db1afdd04c6ec65a38ca83f3993c964a1bf7587`, tree `5b51ed5f1779a2cbefc359fdbdc4720779989b4b`. PR #45 was externally merged. The target is an observed source, **not BASE_W02**. Frozen BASE_W01 remains `69d81a83a3409d0693272efeb19ebeb9805750f5`.

## Entry disposition

| Requirement                                              | Source-grounded result                                                                                                             | Needed producer                                                                                                          |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Published immutable BASE_W02                             | Missing; both base and contract registries retain null                                                                             | W01-E-CONTRACTS and W01-E-BARRIER after independent review and actual resulting-target checks                            |
| Accepted Identity/guest and domain wire/client contracts | Accepted next-wave list is empty; api-clients exports nothing                                                                      | E and affected A–D owners, with provider/consumer review                                                                 |
| W01 bootstrap writes                                     | The W02 instruction expires E's bootstrap permission now; the registry still carries 11 leases / 165 paths with conditional expiry | Reconcile the published ownership registry through reviewed policy/common-base work; use permanent ownership immediately |
| Guest recovery and production copy                       | No approved decision established in inspected source                                                                               | Product owner and affected owners                                                                                        |
| OTP method/provider and first privileged actor           | Existing adapter sends email; operational delivery and audited privileged bootstrap remain unproven                                | Product owner, Identity operator and approved provider access                                                            |
| Independent policy and repository enforcement            | No independent human approval observed; main unprotected, rulesets empty                                                           | Eligible independent reviewer and repository administrator                                                               |
| Usable allocated stack and staging access                | Allocation implementation exists; this proposal starts no runtime and proves no staging access                                     | E allocation plus approved environment/access                                                                            |

These dependencies block the affected runtime, package, schema, migration, CI and consumer writes. The current W02 instruction takes precedence over the old lease record: E must not exercise bootstrap writes in A–D source. The registry's conditional expiry remains an unreconciled publication fact; it does not restore permission or establish an accepted base. A bootstrap merge alone does not publish contracts. Existing technical capabilities remain useful and are traced below.

## Proposal contents

- [ENTRY_AUDIT.json](ENTRY_AUDIT.json): dated exact-source, GitHub and contract/ownership observations.
- [IDENTITY_GUEST_PROPOSAL.md](IDENTITY_GUEST_PROPOSAL.md): implemented security primitives, decisions, gaps and required real-resource cases.
- [GATEWAY_CLIENTS_APP_ACCEPTANCE.md](GATEWAY_CLIENTS_APP_ACCEPTANCE.md): current transport/client/app gates and proposed acceptance boundaries.
- [CHILD_SPRINTS_AND_GATES.md](CHILD_SPRINTS_AND_GATES.md): reviewable dependency sequence and W03 packet requests.
- [CHECKPOINT.md](CHECKPOINT.md): resumable English handoff, actual proposal checks and next action.

## Write boundary

Only `docs/parallel/E/W02/` changes in this child. Runtime sources, contracts, versions, shared configuration, registries, ownership status, leases, approved references and service migrations remain at the audited target. No service owner code is generated or overwritten. No guest credential, route, delivery method, privileged account, production copy or business policy is invented.

Retain the seven approved customer booking steps, optional plate and guest journey. Current checkout methods remain Cash, ShamCash and Syriatel Cash; Paymera remains the documented owner/provider decision. The Customer UI is a session demo, and Operator/Admin technical boots return business readiness 503. No product or release readiness follows from this proposal.

## Resume condition

Review the concrete prerequisite packet and obtain the missing owner decisions. Complete W01 contract/policy acceptance and the serialized resulting-main barrier, then publish an actual full BASE_W02 SHA, accepted versions and a reconciled permanent-writer registry. Recheck the registry and target before creating any runtime child from that base. If an export is still missing, accept a narrowly reviewed E contract child and publish a new common base before its consumers begin.

Do not start W03 implementation or publish BASE_W03 from this proposal. W02 parent enters INTEGRATION_PENDING when implementation children begin and remains there until the combined real-owner/app tests and review barriers pass.
