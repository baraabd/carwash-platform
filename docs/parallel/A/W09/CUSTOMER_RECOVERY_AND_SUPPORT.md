# W09-A — customer recovery and safe support procedures

**RUNBOOK_PROPOSAL / NOT_EXECUTED / COPY_NOT_APPROVED.** These English technical
instructions define recovery meaning; they are not new approved UI wording or
a deployable support procedure. Real owner status APIs, current grants,
approved customer help states and D operational lookup remain prerequisites.

## Original-operation rule

Before a mutation, obtain the accepted actor/action/resource/purpose-scoped
operation identity and canonical fingerprint. Retain the minimum safe submitted
operation reference under the approved storage policy. A timeout, browser abort,
navigation or missing reply does not prove noncommit and does not authorize a
new Booking, debit, proof effect, case or entitlement use.

Reauthenticate/revalidate current scope first, then query the original owner
receipt/status. Accepted identical retries return that original outcome;
changed meaning conflicts. Receipt expiry, revoked access, partial effects or
unavailable status use the accepted escalation/reconciliation policy, never a
new key invented by the customer. Client cancellation cancels an observation;
owner cancellation/compensation is a separate durable authorized command.

## Concise customer and support recovery

| Condition | Customer recovery meaning | Operational owner and proof |
| --- | --- | --- |
| Session expired or guest grant lost | Stop private reads/commands, invalidate actor-scoped caches/drafts/object URLs and fence late responses. Restore only approved safe unsent data. Use accepted sign-in/guest recovery; contact/phone match cannot restore authority. | E Identity/Gateway and each object owner verify current scope. D can locate only permitted original operations; no sensitive result is exposed on denial. |
| Save/confirmation reply lost | Display unknown/pending meaning, retain original operation reference, recover through its real owner. Reload/Back/Forward/reconnect does not resubmit a new command or turn local state into success. | A handles Customer/Vehicle/Geo save receipts; C handles Booking/capacity; independent optional-save failure remains visible. |
| Appointment changed or unavailable | Obtain current Booking/Scheduling/Geo/price facts and approved customer consent. Present conflict/current choice; stale slot, price or historical address cannot silently become an accepted new appointment. | C Booking/Scheduling/Dispatch with A Geo and B Pricing. Support explains current outcome without directly changing records. |
| Payment pending, uncertain or under review | Keep Booking/capacity, received-money verification, proof status and refund/benefit facts separate. Recover original B operation; image/QR/upload/navigation never means money received. | B Billing/Wallet/Subscription/Pricing plus C Booking; D Support has authorized read/escalation only. Late payment cannot revive expired capacity. |
| Return from wallet app | Recheck current actor and original operation after browser suspension/reload. Do not trust return URL or client parameters as payment verification. Same-phone QR/copy/save behavior follows actual approved provider test rules. | B supplies merchant/provider verification/status; E supplies safe return transport. Both approved electronic methods require real evidence. |
| Upload finished but media missing | Resolve original C reservation/upload/finalize/link status; handle missing/quarantine/replaced/revoked bytes truthfully. Avoid a second proof effect after a lost finalize reply. | C Media and B proof review / C Work purpose. DB link presence does not prove bytes, scanner outcome or authorized access. |
| Support submission reply lost | Look up original D operation before a permitted identical retry. Keep submitted/pending/unknown distinct from sent/received/closed; no local note implies a real case or refund. | D Support/Communications, actual permitted case receipt and current object/purpose grant. |
| Reconnect after incident/restore | Revalidate current authority, refresh actual owner versions and reconcile pending original operations. Apply current privacy restrictions before showing historical/private content. | E orchestrates recovery; each owner reconciles; A refreshes authorized views. No hidden empty/fallback result. |

Historical snapshots remain immutable; current operation decisions use current
authority. Optional plate remains optional, manual location remains reachable
after denied permission, and guest booking remains required. Original-operation
references must survive approved local reset/reload where needed for recovery;
they are not credentials and still need appropriate protection/retention.

## Explicit diagnostic allowlist

Proposed minimal public report fields: static condition code, service/operation
family, source/environment/profile binding, observed UTC time, bounded outcome
and approved correlation/original-operation reference. A protected lookup can
link owner receipts only with current actor/object/purpose grant and audit.
Possession of a correlation ID or support case ID grants no object authority.

Exclude access/refresh tokens, OTP, cookies, guest secrets, raw request bodies,
names/contact/plate/precise location, private messages, proof/media bytes and
private/signed URLs. Even opaque references may be personal data and require
approved access/retention. No customer/Booking IDs or coordinates in metric
labels; label only bounded service/operation/outcome/policy families.

Existing observability context validates correlation/request/trace fields and
secret redaction exists, but generic redaction does not cover every customer
PII field. Use an explicit field allowlist before emission. Source anchors:
`packages/observability/src/context.ts`, `logging.ts`, `metrics.ts`. No leak,
collector/dashboard or operational support lookup is reproduced by this audit.

## Serialized incident procedure

1. E confirms authorized environment, exact candidate, allowed fault boundary,
   current owner participants and abort/cleanup handles. Record pre-fault owner
   receipts and current permission/privacy state.
2. Observe customer condition and collect allowlisted evidence. D performs
   read-only current-purpose lookup; source unavailability remains unknown.
3. E/actual owner repairs its allocated runtime or reviews a source fix. Any
   mutation/replay/compensation uses the original accepted operation semantics
   and approved scoped commands, never a direct record edit.
4. Verify independent owner outcomes, customer resynchronization, support lookup
   and current privacy/access; compare timings with approved objectives.
5. Record residual backlog, failure/partial result and cleanup. A source fix
   follows reviewed PR, new deployment binding and affected real retests. Stop
   when approved abort criteria fail; no unapproved production exercise.
