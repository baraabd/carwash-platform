# W05-A — electronic payment and recovery entry proposal

Task **W05-A**, permanent Lane A. Implementation: **BLOCKED**. Parent acceptance:
**NOT ACCEPTED**. This lane-local proposal child is not the implemented payment journey.

Observed target/proposal parent: `3ce756cd39a9b0c1013043cee0ca1bb183466da7`,
tree `cc3517ec85525c7310fe340397506ef6be3fe0a9`. No accepted `BASE_W05` exists.
Branch: `proposal/w05-A-payment-entry`; observed target is not a wave promotion.

## Entry truth

- W04 PRs #56–60 are merged. Since `1ec9d8aebf4470a2815471116643fa6ebe0d5a95`,
  they add exactly 31 lane-local documents/declarative specifications and 5,168
  lines, with zero runtime/shared/schema/migration/registry/workflow changes.
  A's #59 merge is `fd6aaf9e5f9bb2deba35ae176ffb830cca4e7ee0`.
- Release registry remains W01 `INTEGRATION_PENDING`: `BASE_W02:null`, no
  `BASE_W03`/`BASE_W04`/`BASE_W05`, accepted next-wave contracts empty.
  A packets are present; the old `requested-not-received` A record is stale.
- Contracts/event-contracts/api-clients remain `0.0.2`/`0.0.2`/`0.0.1`.
  Identity member security exists; guest capability is unaccepted. HTTP contracts
  contain Identity/Gateway foundation/routing only; business clients export nothing.
- PaymentRoute remains the C014 session handoff. Billing, Booking, Scheduling,
  Media and A data services have marker-only product schemas. No actual payment,
  cancellation/refund/rescheduling provider or three-app consumer journey exists.
- Current instruction expires E bootstrap product writes now. A owns its permanent
  product sources; stale conditional leases do not restore E permission. Missing
  accepted base/contracts independently blocks these dependent implementation writes.

## Provider and product input boundary

W01 B-02 and current registry still leave Paymera necessity/role **OPEN**. A provider
under an existing method and a fourth visible checkout method are separate scope
questions. Cash/ShamCash/Syriatel remain the three approved methods. Do not treat
Paymera as either approved or excluded; unresolved required support blocks launch.

Public pages were refreshed read-only on 2026-10-05:

| Primary source                                                  | Limited evidence and remaining boundary                                                                                                                                            |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Paymera](https://paymera.net/)                                 | Partner API access is advertised. A marketing page is not a versioned protocol, accepted adapter, test facility or owner scope decision.                                           |
| [ShamCash](https://shamcash.sy/)                                | Retrieval timed out; no new protocol assertion. Failure to retrieve is not proof no API exists.                                                                                    |
| [Syriatel Cash](https://www.syriatel.sy/services/syriatel-cash) | Public description includes QR and merchant payment-history functions. No merchant integration/refund/status protocol or authorized test facility was accepted by this inspection. |

B/product/E need genuine approved scope, merchant recipient/publication, independent
verification/refund evidence, versioned protocol and explicitly designated facilities.
No merchant login/contact/account/credential/payment/refund operation occurred.
No fee, limit, denomination, deadline, provider QR syntax or account is adopted here.
W04 B/E provider dossiers remain pending; public advertising cannot close them.

## Proposed acyclic children — agree exact scope/gates with E before coding

| Requested child / owner                      | Predecessor and bounded acceptance                                                                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W05-PREDECESSOR-BARRIER / E + A–D            | Complete real W01–W04 providers/consumers and reviewed resulting-target gates; publish actual BASE_W05, shared clients, guest/CSRF/grants and isolated run allocation.                                      |
| W05-C-BOOKING-CHANGE-BINDING / C             | Narrow durable order/change-purpose authority before dependent finance or Media consumers; no completed coordinator required as a fixture.                                                                  |
| W05-B-INSTRUCTIONS-INTENT / B                | Real obligation/beneficiary binding, approved merchant instructions, protocol/test-facility inputs, immutable money/recipient refs and durable unknown-outcome lookup.                                      |
| W05-C-PRIVATE-PROOF / C Media                | Merged real Billing purpose authority → object reservation/upload/scan/finalize/current private grants; no proof implies received money.                                                                    |
| W05-B-VERIFICATION-REFUND / B                | Merged binding/proof providers; independent receipt/status evidence, unique external allocation, partial/full allowance and unknown-outcome recovery; no browser settlement authority.                      |
| W05-C-CANCEL-RESCHEDULE / C with B providers | Accepted narrow cancellation/change authority, replacement Scheduling/quote/financial-plan providers, durable coordinator/fences/compensation. Preserve old-slot policy and explicit current-price consent. |
| W05-D-REVIEW-SUPPORT / D                     | Merged verification/private Media providers; actual authorized review/correction/support/admin app-to-owner journeys and durable scoped communications/read projections.                                    |
| W05-C-OPERATOR-FINANCE / C                   | Merged Work/payment policy and finance providers; actual operator permissions, late payment/unpaid closure and compensation remain independently observable.                                                |
| W05-A-PAYMENT-PROOF / A                      | Merged providers/public clients and approved production states; method-specific QR/proof/reload/review and no-success-on-upload/redirect/timer paths.                                                       |
| W05-A-CANCEL-REFUND / A                      | Merged coordinator/refund providers and required peer consumers; current eligibility/reasons, races, partial/full/failed/pending refund and real recovery.                                                  |
| W05-A-RESCHEDULE / A                         | Merged quote/replacement/delta/coordinator providers; last-slot race, changed-price consent, lost response, hold expiry and adjustment compensation.                                                        |
| W05-E-BARRIER / E + independent reviewer     | Complete affected three-app/provider-facility cases before consumer/integration merges; latest target/head candidate, mandatory gates, unchanged refs and actual resulting-target verification.             |

Provider children prove real owned DB/HTTP/Identity/constraints and public conformance
before consumers. Split a further eligibility/financial-plan provider when a final
coordinator and money operation would otherwise require each other. No unmerged peer
branch is an implementation base. Keep the parent `INTEGRATION_PENDING` once runtime
starts until every task-listed case passes; fixtures and green foundation CI do not
accept a business wave. Each A slice is a future requested implementation child,
not another PR started by this bounded proposal.

## Packet index and stop point

- [Payment actions and recovery](PAYMENT_RECOVERY_AND_ACTIONS.md).
- [W05 acceptance specifications](../../../../tests/parallel/A/W05/ACCEPTANCE_SPECIFICATIONS.md): all new cases unexecuted.
- [W06 contract requests](W06_CONTRACT_REQUESTS.md): wallet/profile/consent/review/media, exact privacy-operation scope and participant/attachment/chat recovery; proposed, not frozen.
- [Source observation](source-observation.json) and [checkpoint](CHECKPOINT.md): actual commands, results, environment limits and resume steps.

Status for Baraa: التنفيذ الحقيقي للدفع والإثبات والإلغاء والاسترداد وإعادة الجدولة
محجوب لغياب BASE_W05 والعقود والمزوّدين والمدخلات المقبولة. التسليم الحالي مقترحات
ومواصفات قبول؛ لا يبدأ W06 ولا يثبت حركة مال أو جاهزية إطلاق.
