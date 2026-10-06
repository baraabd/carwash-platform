# W06-A — account authority and per-owner fulfillment proposal

**Proposed/unaccepted. No runtime behavior or retention approval is added.**
Accepted BASE_W06, current Identity/guest grants, production account-action scope,
coordinator ownership and per-owner retention/action/evidence decisions are missing.
The source/account rows are reconciled in [inventory](APPROVED_ACCOUNT_INVENTORY.md).

## Account data and current authorization

Customer owns profile/display contact, saved addresses, preferences and consent.
Vehicle owns vehicles, optional plate metadata and ownership. Geo owns zone
versions/serviceability, not the customer's saved address. Identity alone owns
credentials, verified login identifiers, sessions and recovery challenges.
Booking retains immutable reviewed contact/address/vehicle snapshots through its
public contract. Updating or archiving current records must not rewrite those facts.

The current C014 demo copies normalized booking contact into its local profile.
That legacy memory behavior is not an accepted authenticated Customer update or
credential-change policy. Production changes require explicit intent, current
ownership, expected revision and accepted contracts; a booking edit must not
silently alter Identity credentials. Whether approved profile changes prefill a
new draft is a separate policy, never an update to existing bookings.

No client-supplied subject/role/phone grants ownership. Resolve the verified actor
and permitted guest capability server-side; bound object/purpose grants must be
checked at every sensitive command/read. Matching a phone number never links a
guest history to an account. Linking/import/recovery needs its separately accepted
Identity and domain ownership proof. Logout/switch-account invalidates scoped
queries, open private views and draft mutation authority; old responses cannot
reseed the next user's data. Reauthentication/CSRF/session expiry are E inputs.

Mutations bind actor, operation, stable business identity, expected revision and
canonical request fingerprint. A changed-payload replay conflicts. Duplicate
submission/lost response/reload reconciles the original operation before a new
write. Failed or unknown server outcomes are not shown as saved. Browser optimism
cannot overwrite newer server revisions or resolve unknown commits.

Preference persistence and marketing/service/privacy consent are distinct.
The operating system's reduced-motion choice is always respected even when a
stored account preference enables motion. Account enable/disable persistence,
guest/device scope and cross-device precedence need exact approved semantics;
an unaccepted default must not enable animation or consent. Withdrawal of
marketing permission does not manufacture deletion of independently retained
service, accounting or security evidence.

## Required decisions, owners and evidence before implementation

| Input                                                                                           | Responsible owner(s)               | Release artifact required                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Exact profile/address/garage/preferences/help/privacy screen/actions and production Arabic copy | Product/A with E                   | Mapping from each frozen demo action to approved production action or explicit demo-only disposition; no new flow inferred.                                                                      |
| Intake-only versus automated export/reset/deletion scope                                        | Product/A/E + relevant owners      | Named actions and completion wording; intake alone cannot satisfy approved automated fulfillment.                                                                                                |
| Coordinator authority and required-owner manifest                                               | E + all affected data owners       | Coordinator owner, request identity/purpose contract, required/optional participants and exact coverage/cutoff rules. No coordinator is assumed here.                                            |
| Per-owner actions, retention and evidence                                                       | Each data owner; policy approver   | Approved record classes, operation, legal/operational holds/reasons, retention version, derivatives/provider copies/backups and machine-verifiable effect evidence. No period/basis is invented. |
| Account/guest linkage, credential changes, revocation                                           | E Identity with A/C                | Current actor/object/grant/session rules, guest permitted scope and recovery/consent requirements.                                                                                               |
| Export packaging/private delivery/expiry                                                        | C Media + each owner + coordinator | Approved private artifact/manifest, access policy, snapshot and refresh/expiry/revocation rules. No public URL or browser collection of peer databases.                                          |
| Conversation/service-media retention and consent                                                | D/C + product/policy approver      | Explicit purpose, participants, attachment lifecycle and retention approval separate from marketing permission.                                                                                  |

## Request identity, owner outcomes and truthful display

Candidate concepts below request exact E-reviewed schemas; they are not shared
DTOs, accepted enum values or runnable endpoints. The approved coordinator must
persist a request ID, subject binding, requester/current authority, action kind,
approved scope version, manifest of required owner actions, cutoff/snapshot
semantics, policy/approval references, creation instant and operation identity.
Required owners are determined from scope, not whichever services reply first.

Each owner result needs its owner/action/request ID, owner operation ID, revision,
action/record-class scope, durable outcome, policy/approval version, cutoff,
retained reason and restricted effect/audit evidence reference. Sensitive record
IDs, reasons and artifact details require approved minimization for the viewer.
Per-owner facts must distinguish pending, applied/exported, retained, failed and
unknown outcomes; an ACK or accepted queue message is not an effect record.

| Proposed display concept             | Evidence required / what remains unresolved                                                                                                                                                                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request received                     | Authorized durable intake exists; no completed owner action is implied.                                                                                                                                                                                                             |
| In progress / owner pending          | Named required owners/actions remain unresolved or scheduled.                                                                                                                                                                                                                       |
| Partial fulfillment                  | Some exact effects are evidenced; other owners/actions remain pending, failed or retained.                                                                                                                                                                                          |
| Failed / retry pending               | An owner has a definite failure for a bounded action; recovery is visible without discarding completed effects.                                                                                                                                                                     |
| Outcome unknown                      | Timeout/crash lost the reply; reconcile that owner's original operation identity. No inference of failure or new destructive operation.                                                                                                                                             |
| Owner retained                       | Exact retained classes/reasons and approved authority are recorded. Retained is neither deleted nor silently hidden from the fulfillment report.                                                                                                                                    |
| Complete according to approved scope | Every required owner/action has a terminal approved effect or explicit approved retained disposition; required delivery/projection/Media/provider-copy/backup actions are resolved. No required unfinished action is hidden. It never means all records were deleted if any remain. |

Exact labels, permitted state transitions and whether a retained disposition can
close a particular request require policy/product approval. Do not collapse a
completed request-with-retention into a blanket deletion-success banner.
Export availability/download and retention cleanup are independent facts;
delivery can succeed while approved cleanup/backups/provider copies remain pending.

The earlier B privacy fulfillment family was reserved for W07; D/A request W06
intake and actual owner fulfillment with different action/outcome shapes. E/B/D/A
must explicitly settle scheduling, action mapping, closed terminal outcomes and
the required-owner manifest before claiming W06 fulfillment. Do not silently
defer a required owner or rename an incompatible W07 proposal as an accepted W06
provider. Release the reviewed schemas and common base before dependent writes.

## Export, reset and deletion are different operations

Export requires a frozen data cutoff or approved consistent-snapshot strategy,
versioned per-owner manifests, format/coverage/omissions, exact authorized records,
checksums and restricted private delivery. Requesting or downloading an export
does not itself delete anything. Expired artifacts must be renewed only under
current authority; an old grant/URL cannot bypass account revocation. A partial
export must name missing owners and must not masquerade as a complete file.

Demo export in the frozen HTML serializes local state without image blobs.
Production export coverage, media inclusion/redaction and file-delivery status
need explicit approval. No client aggregate of fixtures proves a server export.

Demo reset clears this prototype's local experience; it is not a peer-database
delete. Approved device-only reset must enumerate A-owned keys/caches/objects,
protect credential/session boundaries and other accounts, stop/revoke local
private views and describe only the effects performed. Do not use an unrestricted
global browser-storage clear or claim browser cleanup deleted owner records.
Server reset, account closure and record deletion are separate approved commands.
Reset must preserve safe references/status recovery for already submitted or
unknown Booking/message/upload/financial/privacy operations; clearing a view or
unsent draft cannot undo or justify duplicating their remote effects.

Deletion/closure cannot erase immutable Billing postings, past Booking snapshots,
audit or legally/operationally retained evidence merely to display success.
Each owner must supply its exact approved delete/redact/archive/retain action and
constraints, including ongoing booking/case/refund/custody/subscription operations.
Stopping new activity, revoking access and completing record fulfillment are
separate outcomes; sequence them without orphaning unresolved recovery operations.
Backup expiry/restoration suppression, projections/search/provider copies and
Media originals/derivatives each need an explicit accountable action/evidence.
Do not invent a blanket legal retention period or promise instantaneous erasure.

## Durable recovery, effect evidence and acceptance

Persist request/owner operation identity and outcome. Owner effect and owner audit/
outbox commit together; coordinator receipt/progress and inbox commit together.
Crash before/after commit or ACK, duplicate/out-of-order messages and different
retry keys must not repeat a destructive effect. Conflicting evidence under the
same immutable identity is quarantined; a legitimate higher owner revision may
advance the fact. Gaps trigger authorized reconciliation, not client arithmetic.

Retry only the unresolved/definitely failed approved action; retain completed
effects and the required-owner manifest. An unavailable owner remains named and
pending. Changing the request scope, policy or owner list needs an approved version/
new request decision, not retrospective relabeling of missing work as completed.
Recheck authority for retrieval/retry/private download; preserve narrowly approved
internal completion/recovery authority after account access changes. Any such
grant must be explicitly released by E/owners, never retained by assumption.

Real acceptance must inspect each owner's exact record classes before/after,
immutable retained records, local audit/effect evidence, export contents and
Media/backups/projection/provider-copy obligations. Exercise partial failure,
replay/restart, conflicting/gapped owner events, current-grant/session revocation,
guest and cross-user denial and truthful UI reload. Local fixtures and intake
screens cannot prove per-owner fulfillment. All specified W06 cases remain
UNEXECUTED in this proposal.
