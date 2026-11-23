# W08-A proposed security/race/accessibility/device acceptance

**52 DECLARATIVE FAMILIES — ALL UNEXECUTED / ENTRY_BLOCKED.** This file is a
specification, not an executable test report. BASE_W08, complete accepted
producers/clients, required English and performance/device inputs are absent.
Existing units/builds/source diagnostics and hosted foundation tests do not
mark any family below PASS. Pure D01..03 reproduction does not prove its fix.

Each executed case must bind task/child/case version, source/tree/config/lock/
contracts/build/served hashes, approved reference/profile, real identities and
isolated environment, exact command, observed assertions/effects, evidence
digests and cleanup. FAIL/BLOCKED/NOT_RUN remain explicit. No mock provider,
unapproved threshold, unchanged-source assumption or skipped-case PASS.

## Entry and authority

- **W08-A-001 — Accepted entry:** verify E's full BASE_W08/tree, frozen business
  packages/clients, all W07 scope evidence, approved EN states and budgets.
  A missing item blocks its dependent cases and the full parent.
- **W08-A-002 — Source and artifact:** build/typecheck the actual customer app;
  bind source/config/lock/build/served bytes and scan every runtime fallback.
  Current fixture startup cannot be passed as a real production customer.
- **W08-A-003 — Scope and contracts:** use protected-base path authorization,
  accepted owner DTO parsers/clients and strict legacy readers. Unknown fields,
  unsupported major or private implementation import must fail safely.
- **W08-A-004 — Current principal/object:** two actual users call list/detail/
  write for owned and foreign orders/vehicles/addresses. Guessed or forged IDs
  yield no foreign body, existence/count leakage or unauthorized effect.
- **W08-A-005 — Guest ownership:** two guests, guest versus account, expired/
  replayed capability and approved ownership linkage. Refresh/navigation must
  not broaden actor/object authority or silently create a new owner.
- **W08-A-006 — Session expiry/revocation:** revoke while read/save/confirm is
  in flight; verify current authorization at owner commit and subsequent read,
  truthful outcome and no authenticated success based on stale local state.
- **W08-A-007 — Identity/header spoof:** forge internal/role/customer/scope
  headers and browser identifiers through actual Gateway. E transport and
  owner authorization reject spoofed claims; disabled UI is insufficient.
- **W08-A-008 — Origin/CSRF:** perform actual approved authenticated mutations
  from foreign/invalid origin and missing/mismatched CSRF context; authorized
  requests still work. No local authentication clone or policy bypass.
- **W08-A-009 — Principal cache isolation:** log out/switch user/guest with
  each private route/sheet/cache/draft open; reject old replies and remove
  confidential state/URLs. Retain only the accepted minimum safe draft.
- **W08-A-010 — Shared device/reload:** close/reopen/back/forward/background
  tabs and reload between actor changes; inspect approved storage/caches and
  requests. No credentials in localStorage or private old-principal screen.
- **W08-A-011 — Malicious text/URL/schema:** inject HTML/script/bidi/URL schemes,
  oversized/malformed/unknown fields into real allowed inputs; preserve safe
  text/approved escaping, strict schemas and useful associated errors.
- **W08-A-012 — Sensitive output:** inspect logs/errors/URLs/diagnostic traces,
  served assets/storage/screenshots for contact/plate/precise location/proof/
  tokens. Required current-purpose support lookup is minimized and audited.

## Reproduced local findings and real command races

- **W08-A-013 — D01 manual intent wins:** defer location response, choose newer
  pointer/keyboard pin/sample/saved address, resolve old response; preserve
  newer location/text and suppress stale notice. Actual browser ordering plus
  focused state regression; keep manual recovery enabled.
- **W08-A-014 — Location generation/lifetime:** overlap requests/retry, replace
  editor, unmount/reopen and principal switch before response; only the current
  approved intent may apply. Keep existing late-unmount protections.
- **W08-A-015 — D03 malformed position:** NaN/Infinity/invalid latitude/
  longitude/swapped/malformed adapter result is unavailable/error, never
  in-range; no raw coordinate retention/logging or fixture Aleppo claim.
- **W08-A-016 — D02 stale Vehicle target:** delete/archive editing target then
  submit; no create fallback or different matching-record update. Real owner
  revision/permission and truthful conflict/missing recovery are required.
- **W08-A-017 — Save concurrent revisions:** two actors edit same Vehicle/
  address revision, same/different key and response loss. One permitted owner
  result/replay; no lost update or foreign object disclosure.
- **W08-A-018 — Save versus archive/delete:** race with current Booking/Work
  relationships; apply accepted fence/policy and preserve historical snapshots.
  Missing source cannot be resurrected by stale UI or retry.
- **W08-A-019 — Quote changes/tampering:** change quote/package/add-on/price
  version after review and forge totals. Real Pricing rejects/requotes and
  requires explicit approved reconfirmation before Booking commit.
- **W08-A-020 — Promotion/quote binding:** race reservation expiry/rebind/
  supersede and duplicate redemption; accepted B association and current C
  action authority yield one effect, truthful denied/pending or compensation.
- **W08-A-021 — Last slot:** two real actors compete at the exact owning
  Scheduling barrier. At most one permitted reservation; loser gets actual
  unavailable choices without guessed fixture capacity.
- **W08-A-022 — Hold expiry/clock:** commit at exact accepted expiry boundary,
  skew/background/reload and lost reply; owner UTC/timezone/fences decide.
  Client navigation cannot release a committed/claimed reservation by inference.
- **W08-A-023 — Confirm duplicate/conflict:** same generation/key/fingerprint
  double tap/replay yields original durable result; changed meaning conflicts.
  Observe real Booking/capacity/B effects, never just one UI click.
- **W08-A-024 — Confirm lost response/reload:** cut reply after commit, reload
  during transaction and recover original authorized operation. UNKNOWN cannot
  become failure/success by guess or a second key/new Booking.
- **W08-A-025 — Abort/navigation/stale completion:** back/forward/review edit/
  locale/principal changes and unmount around real writes. Cancel observations
  safely; committed owner operation remains independently recoverable.
- **W08-A-026 — Optional saves partial:** Booking succeeds while Vehicle or
  address save fails/times out/full/conflicts; independent real results and
  same-key recovery, no claimed save or duplicate booking/profile leakage.
- **W08-A-027 — Proof replacement:** overlap private upload/process/finalize
  generations; late older result cannot replace newest accepted proof or retain
  unauthorized preview bytes. B verification remains independent.
- **W08-A-028 — Cancel/payment race:** late verified transfer versus cancel/
  expiry/release uses accepted B/C authority and financial audit/compensation;
  no automatic Booking/capacity resurrection or guessed refund.
- **W08-A-029 — Entitlement/quota race:** last unit/reserve/consume/release/
  cancel and worker restart with real B/C fences; one allowed effect and
  durable reconciliation, strict old contract compatibility.
- **W08-A-030 — Repeat and historical immutability:** archived Vehicle/address,
  retired package/zone, expired quote/slot and missing permitted fields require
  current revalidation; original Booking/receipt/snapshot remains unchanged.
- **W08-A-031 — Owner crash/replay:** cut owner worker/DB/broker before/after
  commit/publish/ACK in E-isolated resources; duplicates/out-of-order events and
  restart preserve accepted effects, current authorization and exact lookup.

## Accessibility and locale

- **W08-A-032 — Arabic full journey:** every implemented approved route/action,
  seven decisions, optional plate/guest/manual fallback, errors/loading/empty/
  recovery; preserve RTL copy/icons/art/price footer and explicit confirm.
- **W08-A-033 — Required English:** approved complete en/ltr copy/layout/error/
  recovery references, locale switch and no untranslated required state.
  Missing approval is BLOCKED; Arabic fragments/numeric formatting are no pass.
- **W08-A-034 — Numbers/dates/Money:** accepted currency exponent/rounding,
  mixed-direction plates/phone and UTC/server display timezone at day/DST/
  expiry boundaries; no client-time or float authority.
- **W08-A-035 — Keyboard/navigation:** skip link, initial keyboard stop, route
  heading, all actions and back/forward/review focus; no trap/lost focus or
  animation-dependent action in supported actual browsers.
- **W08-A-036 — Sheets/focus:** Escape/trap/restore/reopen/content replacement/
  nested sheet/route unmount/missing opener and stale close; screen-reader
  name/order and scroll ownership remain correct.
- **W08-A-037 — Errors/status/AT:** every validation/error association,
  first-invalid focus, repeated announcement, loading/UNKNOWN/change-price and
  recovery is understandable in approved real screen readers and languages.
- **W08-A-038 — Motion preferences:** normal/OS-reduced/live OS change plus
  accepted user preference precedence/reload; tap/scroll/compare/upload states
  keep content/focus available with animation disabled.
- **W08-A-039 — Touch/zoom/short screen:** actual supported devices, touchcancel,
  multi-pointer/pinch, orientation/on-screen keyboard and text zoom; measure
  every target/overlap and retain explicit reference exceptions/decisions.
- **W08-A-040 — Canonical pixels:** actual served candidate/reference/diff at
  320/390/430/768/1024/1440 using unchanged F010 environment/tolerances. Never
  regenerate goldens or force-click around required errors.
- **W08-A-041 — Contrast and reference debt:** reproduce retained serious
  findings and approve concrete accessible implementation where reference
  conflicts; no hidden baseline waiver or blanket WCAG claim.
- **W08-A-042 — Separate Windows/device evidence:** actual approved OS/browser/
  AT/input versions and full journeys independently of Linux snapshot parity;
  document unsupported/blocked modalities instead of calling all devices passed.

## Pressure, private media and W09 evidence

- **W08-A-043 — Approved budgets/profile:** E/product approves metric/window/
  percentile/units/workload/device/network/dataset/concurrency/duration/targets.
  Any missing numeric definition blocks performance acceptance; no guessed SLA.
- **W08-A-044 — Latency, bundle and request pressure:** retain actual per-journey
  raw latency samples, accepted percentile/window and throughput/error/outcome
  denominators under approved throttled network/device profiles. Measure actual
  JS/CSS/fonts/chunks/request count/body/compressed bytes/cache on complete served
  source; compare accepted budgets and inspect fixtures/maps/config exposure.
- **W08-A-045 — Low memory/CPU/media:** measure peak/retained heap, decoding and
  long tasks under accepted pressure; bounded pages/lazy media and cleanup with
  no confidential cache, OOM success or skipped necessary content.
- **W08-A-046 — Slow/offline resynchronization:** interrupt each real mutation,
  freeze/background/reload and reconnect; minimal safe input, bounded retry
  and original-operation lookup, truthful pending/conflict with no financial retry.
- **W08-A-047 — Denied location/camera:** denied/insecure/unsupported and delayed
  permission plus approved manual alternatives; no guessed coverage/access,
  credentials or retained private coordinates.
- **W08-A-048 — Private upload access:** two principals/guests/current purpose,
  revocation/quarantine/type/size/checksum/finalization and interrupted upload.
  Real object/HTTP/DB assertions; local selected file is not uploaded evidence.
- **W08-A-049 — Safe support diagnostics:** D support receives only accepted
  public code/correlation/authorized receipt instructions; verify field/purpose
  redaction, current grants, audit and no foreign-object existence leak.
- **W08-A-050 — Customer/Vehicle/Geo restore:** populated accepted product
  dataset in owned disposable restore, upgrades/constraints/roles/revisions/
  consent/history/idempotency and approved RPO/RTO; marker restore alone cannot pass.
- **W08-A-051 — Candidate/target/review:** E latest target+head plus all mandatory
  and affected real gates, eligible independent review and unchanged-ref check;
  re-run on changed bytes and verify actual resulting target before next base.
- **W08-A-052 — Complete handoff:** link all required results/failures/blockers,
  measured profile and source/artifact bindings, producer/consumer owners,
  resources/cleanup and W09 safe staging/guest recovery. No full DONE/staging/
  production claim while any required locale/scope/device/effect is unproved.

See [README](../../../../docs/parallel/A/W08/README.md) for proposed child order,
[source audit](../../../../docs/parallel/A/W08/SOURCE_AUDIT.md) for actual state,
and [W09 handoff](../../../../docs/parallel/A/W08/W09_STAGING_HANDOFF.md) for
unaccepted metadata and operational inputs. No test entrypoint/resource/name
is presumed installed; E publishes the runnable manifest after acceptance.
