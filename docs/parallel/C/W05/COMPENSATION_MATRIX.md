# W05-C — Proposed durable compensation and precedence

Status **PROPOSED / NOT ACCEPTED**, every matrix row **BLOCKED_NOT_RUN**. [Checkpoint](CHECKPOINT.md) records source/entry; schemas remain the unaccepted [W04 C request](../W04/W05_CONTRACT_REQUESTS.md) and B/D W04 packets. No private DTO, peer DB or accepted policy is invented.

## Authority and terminal precedence

Booking serializes intent/operation/expected revision and preserves immutable original snapshots. Scheduling alone arbitrates hold expiry/commit/swap/release; Dispatch owns assignment fences, Booking Work owns execution; Billing owns verified credit/allocation/refund and Wallet owns B-backed custody. Operational cancellation and completed financial effects are independent facts.

| Race | Proposed authority boundary to freeze | Required visible outcome |
| --- | --- | --- |
| Cancel versus accept/start/deliver | Booking/Work version CAS plus current Dispatch execution-authority/quiescence protocol and approved cutoff/started-work policy; no stale projection alone can stop physical Work | Accepted pending/rejected intent distinct from cancelled operation; preserve actual Work/assignment history |
| Cancel versus reschedule | One durable Booking operation/version winner; losers query original receipt/current owner revisions, never overwrite snapshots | Definitive refusal or recovery, not simultaneous successful terminal updates |
| Payment versus hold expiry | Scheduling transaction proves capacity; only Billing-authenticated verified outcome proves money | Late credit remains a real financial fact; expired/cancelled Booking does not resurrect |
| Refund versus repeat/late verification | B payment/refund aggregate and permanent provider/business uniqueness; C records refs/outcome | Request/pending/unknown/confirmed refund separately; never erase original credit or claim refund from C intent |
| Reschedule versus competing capacity | Scheduling-owned atomic replace with old/new exact refs, approved pricing and revision fences | Old retained on definitive replacement refusal; uncertain swap means RECOVERY_REQUIRED until actual receipt resolves |

Current authorization is checked for command/replay/status reads. Authenticated admin initiator remains distinct from customer/guest beneficiary and service delegate; scoped permission, reason and policy audit persist. Guest expiry/recovery cannot transfer resource ownership. Cutoff/started-work/charge/refund eligibility/repricing rules are actual missing inputs, not defaults selected here.

## Preserve original capacity until safe replacement

Persist Booking reschedule intent and approved new snapshot/policy/quote refs before external effects; original historical snapshot is immutable. Validate current ownership, new quote and resource/coverage facts through actual owners. If quote consumption is required, use B's accepted durable operation and compensation, not a validation read mislabeled reservation.

Preferred frozen protocol request: Scheduling `replace-reservation` receives old reservation/expected revision, accepted replacement hold/quote/beneficiary refs, durable Booking operation and current delegation. In one owned DB transaction, lock old/new resource units in stable order, validate unexpired replacement/current capacity, commit new occupancy and release old occupancy, persist both refs/audit/receipt/outbox. Definitive validation/conflict refusal leaves old reservation unchanged. No external HTTP call holds that transaction open; Pricing validity/finality prerequisites must be explicitly agreed with B.

After atomic swap, old capacity is genuinely released; Booking may still be reconciling a lost response. Do not display the old slot as guaranteed then. Query/replay the same swap operation and persist actual replacement receipt/new snapshot revision; never issue a new-key swap or free new capacity blindly. Retrying a rejected reprice must not silently mutate old price/date. A swap-back is a new conditional owner command: cannot resurrect the old slot if another Booking owns it; keep new valid reservation/recovery or approved manual resolution. If frozen Scheduling lacks atomic swap, publish an explicit safe protocol/new common base before this workflow; sequential release-first is not a fallback.

## Proposed compensation matrix — execution still blocked

Each effect has a stable business/command identity, canonical fingerprint, expected owner revision, deadline, attempt/lease fence, persisted desired action/receipt and assigned recovery owner. Local state+audit+receipt+outbox commits atomically; Inbox+effect before ACK. Unknown outcome always queries/replays original operation before retry/compensation. No distributed exactly-once or peer rollback claim.

| Effect / failure boundary | Durable recovery and compensation | Owner proof needed |
| --- | --- | --- |
| Intent before commit / after commit before call | Before commit no external effect; after commit resume recorded plan under fenced attempt | Booking real DB/HTTP restart and receipt uniqueness |
| Dispatch withdrawal/release before/after acknowledgment | Resolve same assignment operation/current fence; reject unsafe start/cancel or complete approved quiescence. Never infer release from local cancelled flag | Actual Dispatch/Work provider and execution authority |
| Scheduling release before/after response | Same command yields recorded release or committed/expired/conflict outcome; no duplicate free capacity | Real Scheduling constraints/expiry/read receipts |
| Reservation swap effect before reply/local persistence | Reconcile immutable old/new swap receipt; persist approved new Booking revision; original historical Booking never deleted | Real atomic Scheduling swap and Booking crash/restart |
| B refund/void/adjustment request before/after acknowledgment | Persist B operation refs and query outcome. Stable C compensation identity prevents duplicate logical request; B independently validates allowance/approval/execution | Actual B current payment/grants/refund reservations and sandbox results |
| Provider outcome unknown / unavailable | Park dueAt/attempt/reason and assigned recovery owner under approved retry budget; unavailable does not mean failed/no effect/refunded | B query/idempotency/finality semantics and redacted actual provider evidence |
| Late verified money after cancelled/expired capacity | Preserve independent B fact. Approved policy either obtains fresh eligible capacity/current quote via new durable operation or requests B compensation; failed reacquisition stays explicit | Real B event and Scheduling latest occupancy; no silent state revival |
| Custody/financial correction after Work terminal | B linked corrections and Wallet reconciliation preserve original postings/Work; no receipt deletion or second ledger | Actual B/Wallet immutable refs and source state |
| Duplicate/out-of-order/gapped events and stale workers | Authenticate B producer, inbox/hash/event identity, compare owner revision; reconcile gaps using authorized current owner reads; stale attempt fences reject writes | Actual owner DB/broker; no fixture or payload producer-string trust |
| Consumer reconnect/withdrawn task | Current owner view/scope controls display and permitted evidence retention; queued stale commands refuse/reconcile, private evidence not copied to unapproved local storage | Real A/D/operator HTTP/browser/accessibility and approved retention/states |

Separate operation states (accepted/pending/recovery/manual-review) from Booking cancelled/expired, compensation complete and **Billing-confirmed refunded**. Persist manual reason, next retry/deadline and responsible owner. An HTTP timeout or proof image never creates a definitive financial badge. B event name/payload/aggregate revision/finality and `sham` method mapping need publication; preserve strict existing event compatibility.

Queue E release/policy/resources → real B verified-payment/refund and C Scheduling swap/release plus Dispatch/Work quiescence providers → Booking durable coordinator → A/D/operator recovery consumers with actual B sandbox outcomes. Provider fixtures prove shape only. Operator withdrawn/cancel/reassignment/follow-up views preserve allowed entered evidence and current private scope, announce stale/unavailable/recovery accurately, and require approved Arabic/English copy/focus/reconnect behavior. Only combined current-source crash/race and UI acceptance closes the parent.
