# Provider acceptance dossiers

Read-only public-documentation research: 2026-10-05. No merchant login, contact,
account creation, transaction, refund or credential handling occurred. These
sources establish limited advertised capabilities, not approved adapters.

## Evidence inventory

| Provider      | Actual primary source and observation                                                                                                                                                   | Not established                                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paymera       | [paymera.net](https://paymera.net/) describes merchant QR/POS/cards and advertises API access for partners                                                                              | Versioned API/status verification, signatures, sandbox, refund/settlement protocols and merchant access are unverified                                |
| ShamCash      | [official site](https://shamcash.sy/) and [institutional onboarding](https://shamcash.sy/ar/createAccount) were search-indexed; onboarding snippet mentions documents/review/activation | Full pages timed out; snippets are limited evidence, not merchant payment API, sandbox, callback, refund or statement specifications                  |
| Syriatel Cash | [official service](https://www.syriatel.sy/services/syriatel-cash) describes merchant onboarding, QR payments and merchant payment history in provider applications/MySyriatel          | No machine-verification, sandbox, transaction-refund API or export format retrieved; wallet closure/balance return is not merchant transaction refund |

Paymera is not substituted with Paysera/Paymer or a same-name loyalty app. A
public API advertisement must not be restated as either implementation proof or
absence of an API. The required Paymera relationship to the frozen three methods
is B-02, still OPEN.

ShamCash [account FAQ](https://shamcash.sy/en/faq/2) and
[transfer FAQ](https://shamcash.sy/en/faq/3) were indexed but full retrieval failed.
Account verification is distinct from verifying a specific received payment.
The independent `shamcash-api.com` platform is not official provider evidence.
Unofficial SDKs or screenshot-reading/wallet automation cannot authorize a connector.

The Syriatel [user-guide URL](https://www.syriatel.sy/files/uploads/0E1C9A0B-97B5-4CC2-80B7-AE03A832D7D6.pdf)
was linked by its service page but not retrieved; contents are unverified.
Its [campaign page](https://www.syriatel.sy/campaigns/syriatel-cash-service) and
service page contain differing numeric limits. No amounts/fees/denominations
were adopted. Obtain current effective merchant terms from the provider.

## Dossier fields for each provider

All three dossiers are `DOCUMENTATION_AND_ACCESS_PENDING`, not accepted.

| Field                                  | Paymera                                                             | ShamCash                             | Syriatel Cash                                                                |
| -------------------------------------- | ------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------- |
| Business owner/contact                 | Not supplied                                                        | Not supplied                         | Not supplied                                                                 |
| Provider integration contact           | Official contact channel available; responsible person not supplied | Not supplied                         | Service-centre/support channel; responsible person not supplied              |
| Merchant agreement/account/access      | Not supplied                                                        | Not supplied                         | Not supplied                                                                 |
| Official API/version/auth/signature    | API advertised; specifications not supplied                         | Unverified                           | Unverified                                                                   |
| Sandbox/test merchant/environment      | Unverified                                                          | Unverified                           | Unverified                                                                   |
| Authoritative receipt/status mechanism | Required documented protocol                                        | Required documented protocol         | Merchant history exists; exact approved verification/import protocol pending |
| Settlement/statement format            | Not supplied                                                        | Not supplied                         | History exists; export schema unverified                                     |
| Partial/full refund and recovery       | Not supplied                                                        | Not supplied                         | Not supplied; account closure is not refund evidence                         |
| Accepted scope/approval                | B-02 OPEN                                                           | UI method only; adapter not accepted | UI method only; adapter not accepted                                         |
| Real-money authority                   | Not granted by W01-B                                                | Not granted by W01-B                 | Not granted by W01-B                                                         |

## Required technical acceptance evidence

Obtain the genuine merchant agreement and versioned provider document through
an authorized owner, including authentication/rotation, eligible currencies and
denominations, amount encoding, payment reference/recipient binding, server status
lookup, signed callbacks/replay handling, finality/reversal semantics, fees,
settlement cutoff/timezone, statement export and full/partial refund status.
Confirm sandbox availability; do not fabricate one when undocumented.

Tests must prove wrong signature/account/amount/currency/reference rejection,
duplicate/reordered notifications, conflicting external transaction IDs,
response loss after successful payment/refund, pending status and reconciliation.
External transaction uniqueness is scoped by provider and recipient merchant;
one credit cannot pay two obligations unless an explicit split-allocation policy
is approved. Persist original provider reference and immutable allocation/audit.

A QR, customer screenshot, return URL, uploaded proof, internal row or operator
button is never authoritative received-money evidence. Proof moves to review,
not settlement. Cash receipts use the separate approved cash authority policy.

## Proposed independent manual verification route

This route needs explicit business approval and does not claim any undocumented
provider automation. A finance operator obtains the recipient merchant's actual
provider-operated history/statement or independently issued bank record through
authorized access. Record source provenance, import/checksum/parser version,
merchant, unique transaction reference, direction/status, amount/currency,
timestamp/zone, decision operator/reviewer and linked Billing obligation.

Reject or quarantine unknown/missing reference, duplicate, wrong recipient,
reversed credit, partial/overpayment and ambiguous matches. The approved procedure
must specify approval separation, reconciliation, error handling and private
evidence retention. Customer proof may support a search but cannot satisfy this
independent evidence requirement. Unknown outcomes remain verification-pending.

A refund completion likewise needs independent provider/bank confirmation tied
to the original payment. Unknown status keeps the refund reservation pending;
neither sending a transfer nor a screenshot completes it. Retention/legal periods
and real-money operations require their applicable explicit decisions/authority.
