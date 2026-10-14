# P06-CLOSE-07 — Technician application, service execution and media

Status: **NOT ACCEPTED**. Every in-scope journey passes on the real Workforce, Dispatch, Booking
and Media services. Acceptance is withheld because:

- one open **security** finding fails the sprint criterion "only authorized users can read photo
  evidence" (B-07-01);
- the requested operator Gateway routes are still served by the test harness (B-07-03).

Base: `origin/main@a84b5ee`. Continues P03-C1..C6, P05-C1/C2 and the uncommitted P06-C1 work,
which was carried from `../carwash-07` / `../carwash-p06c` by reading it, not by editing it.
Reference (immutable, unchanged): `design/reference/approved/washgo-technician-interactive.html`.
No dependency was added and no service code was changed.

## 1. Reuse map

| Requirement | Existing implementation reused (unchanged unless named in §2) |
| --- | --- |
| Eligibility, profile, availability | Workforce (P03-C1, P05-C1); operator-web `views/profile`, `profile-cache.ts` (P05-C2) |
| Offers, accept/decline, assignment races | Dispatch offers + `acceptOffer` natural replay (P03-C4); `app.ts` `taskGone` |
| Travel, arrival, start, checklist, documentation, completion, handoff | Dispatch task aggregate (P03-C-D1); `app.ts` `primary`, `views/task.ts`, `views/sheets.ts` |
| Exceptions | Dispatch notes / release / condition note; reference issue sheet (4 modes, crosswalk) |
| Cash collection declaration | Dispatch `close` / `cash-collection`; `model.ts` (declaration, not a Billing receipt) |
| Revision conflicts, lost responses, connection loss | `app.ts` `send` / `pending` / `resolvePending` (UNKNOWN keeps the same Idempotency-Key) |
| Media reserve → PUT → finalize → claim → read URL | Media (P03-C2); `media.ts` `processPhoto`, `runUpload`, `putWithFallback`, `ensureReadUrls` |
| Type / size / ownership / retention / orphan policy | Media `domain/content.ts` (sniffing, 20 B..10 MiB), `ownRecord`, purge worker |
| Money | `money.ts` (Booking total; exact-amount cash dialog) |
| Visual parity | `operator-web-visual.test.mjs` + declared differences (P03-C5, P05-C-D1) |

## 2. Implemented differences (all in `apps/operator-web/src/app.ts` + tests)

| Id | Change | Why |
| --- | --- | --- |
| PB-01..04 | Carried from P06-C1 (`P06-C1-operator-web-closure.md` §2): background re-read, read sequencing, `OFFER_NOT_LIVE`/`OFFER_EXPIRED` as a lost task, the eligibility attention bar | Reassignment, withdrawal and eligibility changes must reach an open app |
| PB-05 | An upload whose outcome is UNKNOWN is now **resumed automatically** (`stalled` → `resolvePending`: backoff, `online`, `visibilitychange`) with the same reservation and keys | Defect found by the real-services run. The UNKNOWN status promises «ستُعاد المحاولة بالطلب نفسه», but before this change an UNKNOWN upload was retried only if the technician re-picked the photo. A POST on a keep-alive socket the server had just closed left the photo missing, with no further retry. |
| PB-06 | The background re-read is no longer blocked by focus on a file, checkbox or radio input | After a photo was chosen, focus stayed on the file input and blocked PB-01 indefinitely (read URLs were not renewed) |

There is no visual change: no CSS, markup or copy was added. The only new copy, PB-04, is carried
and still PENDING OWNER COPY (TI-D03).

Test-side corrections to the carried P06-C suites (the expectations were wrong, not the services):

- A double accept by the addressee is Dispatch's natural replay: both get the same task.
- A late cash declaration is reported in `collection.lateAmount`.
- The reference enables «استلام المهمة» only for a ready technician.
- The bottom navigation is not shown on the task view.
- The storage-key rule allows P05-C2's profile cache.
- The gateway harness needs a `billing` upstream. Here it is a declared stub that answers 503.

## 3. Evidence

Real services: compiled Workforce, Dispatch, Booking and Media processes, each on its own
PostgreSQL 16 database with its own runtime role, plus SeaweedFS S3 and RabbitMQ 4.2
(`scripts/production/C/stack.mjs`). The technician app is the built `dist` in Chromium.

Doubles, declared:

- Identity sessions.
- Booking's owner services (customer, vehicle, pricing, scheduling).
- Billing: a 503 stub; custody is out of scope.
- The operator Gateway: the harness of the requested CR-P03-C5 routes.

| Requirement | Test (real services unless marked) |
| --- | --- |
| Complete journey, eligibility, acceptance, six phases, real photos, cash handoff | `p06c-real-services`: «a real technician job…», «the technician app completes a real job…» |
| Retries do not duplicate transitions | «retries and fences…» (accept + depart replay → one revision); «…lost response after real Dispatch applied a step…» (app: same key, revision +1) |
| Revision conflicts | «retries and fences…» (`412 REVISION_CONFLICT`); fixture: journey «revision conflict…» |
| Another technician's task / photo | «retries and fences…» (task GET/POST 404; Media GET/upload-url/finalize 404, claim 403); «a real technician job…» (foreign evidence 422, read-url 404) |
| Withdrawn / reassigned assignments | «assignment race…», «reassignment mid-job…», «revoked eligibility…», app «…race leaves the offer as a lost job», app «…unassignment reaches it…» |
| Connection loss | app «…lost response…»; app «…lost reservation response is resumed…» (PB-05); fixture journey «network failure before the server…» |
| Interrupted upload | app «…interrupted photo upload resumes on the same reservation…» (S3 PUT cut); `media-s3` «finalize before upload → 409 UPLOAD_MISSING…» |
| Read-URL renewal | app «…read URLs are renewed before expiry» (TTL 60 s, new signed URL reads the real object) |
| Type / size / signature | `media-s3` «the store enforces the signed contract…», «…UPLOAD_MISMATCH…», «…UNSUPPORTED_MEDIA…» |
| Retention / orphans | `media-s3` «purge worker deletes the bytes of unclaimed old evidence; claimed evidence stays»; `media-restart` (expiry and purge under SIGKILL) |
| Declaration ≠ proof of payment | app journey: collections show «الكاش المسجّل», no receipt claim; Dispatch stores a declaration only |
| No demo photos, distance, ETA or tracking | crosswalk «no trial tooling…»; PR-13 removed ETA/distance (P03-C5) |
| Reference interactions and visual parity | `operator-web-crosswalk` (5 views, 6 phases, 21 sheets, 46 actions); `operator-web-visual` (6 widths) |

Results are bound to a commit in §5.

## 4. Blockers and findings (not hidden)

- **B-07-01 SECURITY (open, finding OPS-F01, request CR-P08-C1):** a technician who has been
  reassigned off a job keeps `read-url` access to that job's evidence. Media authorizes a user
  read by uploader only (`media.service.ts` `readable()` → `ownRecord()`).
  - Verified here on the real services: the superseded technician gets 200; the new holder gets 404.
  - The fix is a `media.v1` fence that Dispatch calls (Lane E publishes it; Lane C implements both
    sides). CR-P08-C1 exists only uncommitted in `../carwash-p08c1`.
  - Kept as a `todo` test that asserts the correct 404, so every run reports it.
  - An owner decision is required: fix in this sprint, or carry as a release blocker.
- **B-07-02 policy/design (TI-D08):** after a reassignment, the new technician cannot read the
  earlier technician's BEFORE photo (404). The slot renders the reference frame with its check
  badge and no image. This is an undesigned state, so it is DESIGN_BLOCKED and needs a policy
  decision.
- **B-07-03 Lane E:** the CR-P03-C5 operator Gateway routes are unpublished (the harness stands in),
  and real Identity sessions are a double. The suites therefore do not prove the production Gateway.
- **B-P06-C-01 / sprint 08:** Billing cash receipt and custody from the technician app
  (`CR-P06-C-technician-cash-receipt.md`).
- **F-07-01 (to sprint 08):** Dispatch records the declared cash amount verbatim. It holds no
  price, so the exact-amount rule is enforced only by the app (the reference dialog). A
  non-matching declaration must be caught by Billing reconciliation, not by Dispatch.
- **Media:** there is no multipart or resumable PUT. An interrupted upload re-sends the whole image
  (≤ 850 000-character data URL) on the same reservation.
- **Owner design and decisions** (carried, unchanged):
  - English/LTR (TI-D01), login (TI-D02);
  - pending-state copy, including PB-04 (TI-D03);
  - TI-D05, TI-D06, TI-D08;
  - PC-01..50, DEV-01..03;
  - contrast debt beyond TI-D13.
- No production readiness is claimed. `/health/ready` stays 503.

## 5. Results (2026-10-14, Windows 11, Chromium from the repo's Playwright, stack run e07e3d67)

These runs used the working tree that became `d178ff4`. The app and service code was identical;
the tests then got formatting, the todo test and docs. The rerun on the clean commit is **NOT DONE**
(see the last rows).

| Suite | Result |
| --- | --- |
| `p06c-real-services` (real Workforce/Dispatch/Booking/Media, PG, RabbitMQ, S3) | 12/12 pass in two consecutive runs; the B-07-01 todo is reported (superseded read = 200) |
| `media-s3` (real SeaweedFS) | 10/10 |
| `media-restart` (SIGKILL) | 4/4 |
| operator-web typecheck / build / runtime | pass / pass / 3/3 |
| `operator-web-journey` / `-profile` / `-a11y` (fixture doubles) | 10/10 / 7/7 / 3 + 1 todo (contrast) |
| `operator-web-crosswalk` / `-field-changes` | 5/5 / 3/3 |
| `check-design-reference`, `check-boundaries`, eslint, prettier | pass |
| `operator-web-visual` (6 widths) | **NOT RUN to completion.** Stopped by the host for low memory; no result is claimed |
| Rerun on clean `d178ff4` | **NOT DONE** (same host memory limit) |
