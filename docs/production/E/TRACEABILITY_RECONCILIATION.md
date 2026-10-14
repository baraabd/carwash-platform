# Approved-UI traceability reconciliation

Base: `origin/main` **a84b5eea960e0c8dc72995cc1a049372e7289802** (tree `a7faa6715fa771539ccdb8123b376d617db606a2`, observed 2026-10-13, after PR #143).
Current-candidate acceptance: **NONE**. This document and `traceability-matrix.json` record traceability, not acceptance, and nothing here is production-ready.

Machine-readable source of truth: `docs/production/E/traceability-matrix.json`.
Checker: `node scripts/production/E/traceability-matrix.mjs` (tests: `tests/production/E/traceability-matrix.test.mjs`).
The checker extracts the approved inventory from the three immutable HTML references on the tree it runs on, and fails if any item is uncovered, unknown, or loses its W07 row.

## What this extends and preserves

- Extends `docs/parallel/E/W07/FULL_SCOPE_MATRIX.md` (source `f01e87f`, 2026-10-06). That file is left unchanged as historical evidence; all 124 of its row IDs are carried forward in `requirements[].w07`.
- Reuses the C001 customer extractor (`scripts/c001/customer-behavior-manifest.mjs`) and the P06-B route parser (`scripts/production/B/check-finance-matrix.mjs`). Only the technician/admin extraction and the coverage rules are new.
- `docs/production/B/finance-matrix.json`, the lane A–E records and `architecture/release-barrier.json` are cited, not replaced.
- Historical evidence keeps its original date and commit (`historicalEvidence[]`, `appliesToBase: false`). None of it is presented as acceptance of the base.

## Coverage of the three approved references

| Reference | Inventory extracted by the checker | Rows |
|---|---|---|
| Customer `washgo-payments-interactive.html` | 87 actions, 6 forms, 7 screens, 7 booking steps, 8 payment states, 6 tracking stages | 39 |
| Technician `washgo-technician-interactive.html` | 46 actions, 8 stages, 5 views, 6 phases, 21 sheets | 36 |
| Admin `washgo-admin-prototype.html` | 17 screens, 5 dashboard jumps, 5 modal types, 10 shell controls | 31 |
| Cross-cutting (services, gateway, apps, release gates, production-only admin) | W07 SR/RT/AP/G rows | 37 |

Status counts across all rows:

| Status | Rows | Meaning |
|---|---:|---|
| PARTIAL | 41 | Some of the requirement reaches real owner code on the base; the rest is fixture, local, unrouted or missing. |
| IMPLEMENTED_UNACCEPTED | 23 | Merged source with owner tests on the base; no exact-RC acceptance. |
| FIXTURE_ONLY | 19 | UI ported, but data comes from fixtures or browser memory. |
| BLOCKED_DECISION | 15 | Cannot proceed until a named owner decision is recorded. |
| BACKEND_ONLY | 14 | Owner service code exists; no production UI uses it. |
| UI_NOT_PORTED | 10 | The production app has no screen or interaction for the approved requirement. |
| PROTOTYPE_ONLY_EXCLUDED | 10 | Designer/simulation control. It stays in the reference only and must not be exposed in production (ADR 0004). |
| DESIGN_PENDING | 8 | No approved design exists for the production state. It must not be inferred. |
| ACCEPTED_HISTORICAL | 2 | Accepted on an earlier commit with dated evidence and not rebuilt here. That acceptance is not re-asserted for the base. |
| NOT_STARTED | 1 | Neither UI nor owner implementation exists on the base. |

## Already complete (recorded, not rebuilt)

- F001–F010 foundation: accepted 2026-10-01 on `f364792` (`architecture/implementation-status.json`). Historical; not re-asserted for the base.
- Identity `identity-security-v1` (F006): historical capability acceptance (`X-SVC-01`).
- 143 merged pull requests (#1–#144) are on the base, and no PR is open. Their merged code is mapped row by row; none was re-implemented.
- No approved UI requirement is accepted on any commit: every C002–C014, P03-C5, P05-C2 and P02/P03-D browser run used fixtures or a dirty candidate (see row evidence).

## Headline gaps on the base

- **TRC-CUS-02** (INTEGRATION_GAP, Lane A): customer-web runs only on fixtures/browser memory; it has no API client and no contracts dependency.
- **TRC-CUS-03** (CODE_GAP, Lane A): the `?scenario=` fixture selector is evaluated in the production bundle.
- **TRC-CUS-01** (CONTRACT_GAP, Lane E + Lane C): customer booking read/create Gateway upstreams are not served by Booking.
- **TRC-CUS-04** (CODE_GAP, Lane A): production React exposes designer controls (demo contact fill, sample addresses, inert pay-settings/export/reset rows); removal is a visible change needing owner confirmation (DESIGN_LOCK §9).
- **TRC-TEC-01** (INTEGRATION_GAP, Lane E): operator-web calls `/api/operator/*`; the shipped Gateway serves only `/api/v1/*`. Only the test harness routes it.
- **TRC-TEC-02** (CONTRACT_GAP, Lane E): `technician.work.read/execute` Gateway upstreams point to Booking paths that no controller serves.
- **TRC-TEC-03** (INTEGRATION_GAP, Lane B): technician cash outcomes stay Dispatch declarations; Billing never records a receipt from them.
- **TRC-TEC-07** (CONTRACT_GAP, Lane E): technician role lacks `billing.cash.collect`, so the custody read is refused for a real technician.
- **CR-D-P03-02** (INTEGRATION_GAP, Lane E): admin-web reads `/admin/operations*`, `/admin/finance/cash`, `/admin/assignments*` (and `/admin/notifications`, CR-D-P03-06) that exist only in candidate Gateway patches; the query-string allowlist (CR-D-P02-01) is also missing, so the Gateway 404s any `?`.
- **TRC-ADM-03** (INTEGRATION_GAP, Lane D): the Payments cards read unrouted Reporting cash KPIs while the routed Billing admin summary goes unused.
- **TRC-ADM-06** (CONTRACT_GAP, Lane E): `subscription.manage` is enforced by Subscription but defined in no Identity role.
- **TRC-X-01** (DOC_DRIFT, Lane E): service catalog / implementation-status still say “planned-not-implemented” for 18 services that serve owner routes.
- **TRC-X-02** (TEST_EVIDENCE_GAP, Lane E): no evidence is bound to the base; all 19 barrier families are NOT_RUN; last verdict NO_GO on `3e1ab23`.
- **TRC-X-03** (CONTRACT_GAP, Lane E): hand-copied contracts diverge (payment-method ids, refund/financial/subscription statuses, event names).

## Requirement index

Each row in the JSON carries: role, UI states, covered reference items, reference anchor, existing function, API, owner service, data/migration, event, permission, integration test, browser test, evidence, status, blockers, accountable owner and carried W07 IDs.

| ID | Requirement | Status | Accountable | Blockers | W07 |
|---|---|---|---|---|---|
| CUS-001 | App shell, hash routing, header and bottom navigation / الهيكل والتنقل | IMPLEMENTED_UNACCEPTED | Lane A | TRC-CUS-13, TRC-CUS-14 | CF01 |
| CUS-002 | Home screen / الرئيسية | FIXTURE_ONLY | Lane A | B-P06-05, B-P06-01, TRC-CUS-02, TRC-CUS-03 | CW01 |
| CUS-003 | Draft save, exit and resume / حفظ المسودة والمتابعة | FIXTURE_ONLY | Lane A | TRC-CUS-06 | CF02 |
| CUS-004 | Repeat booking / إعادة الحجز | FIXTURE_ONLY | Lane A | TRC-CUS-01, TRC-CUS-02 | CF17 |
| CUS-005 | Seven-step booking frame, progress, footer and price breakdown / رحلة… | FIXTURE_ONLY | Lane A | TRC-CUS-05, B-P02-03, B-P06-01 | CW02 |
| CUS-006 | Step 1 Vehicle / السيارة | FIXTURE_ONLY | Lane A | A-P01-07, A-P01-10, A-P01-11, TRC-CUS-02, TRC-CUS-15 | CB01 |
| CUS-007 | Vehicle editor sheet and plate preview / تفاصيل السيارة | FIXTURE_ONLY | Lane A | A-P01-07, A-P01-11, TRC-CUS-02 | CF03 CF04 |
| CUS-008 | Step 2 Care packages / العناية | FIXTURE_ONLY | Lane A | B-P06-05, B-P06-01, B-P02-03, TRC-CUS-05 | CB02 |
| CUS-009 | Add-ons sheet / الإضافات | FIXTURE_ONLY | Lane A | B-P06-05, TRC-CUS-05 | CF05 |
| CUS-010 | Step 3 Location / المكان | FIXTURE_ONLY | Lane A | A-P01-02, A-P01-12, A-P01-14, TRC-CUS-02 | CB03 |
| CUS-011 | Address sheet, illustrative map and device location / ورقة العنوان وا… | FIXTURE_ONLY | Lane A | A-P01-02, A-P01-12, A-P01-14 | CF06 CF07 |
| CUS-012 | Step 4 Time / الموعد | FIXTURE_ONLY | Lane A | TRC-CUS-05, TRC-CUS-02 | CB04 CF08 |
| CUS-013 | Step 5 Contact details / بياناتك | FIXTURE_ONLY | Lane A | A-P01-04, TRC-CUS-02 | CB05 CF09 |
| CUS-014 | Step 6 Payment method choice / الدفع | FIXTURE_ONLY | Lane A | TRC-CUS-02, TRC-CUS-11 | CB06 CF10 |
| CUS-015 | Step 7 Review and edit / التأكيد | FIXTURE_ONLY | Lane A | TRC-CUS-02 | CB07 |
| CUS-016 | Booking confirmation and order handoff / تأكيد الحجز | FIXTURE_ONLY | Lane A | TRC-CUS-01, TRC-CUS-16, B-P06-06, B-P02-05 | CB07 CW03 |
| CUS-017 | Checkout screen and payment-method change / شاشة الدفع | BACKEND_ONLY | Lane A | B-P02-07, TRC-CUS-11, TRC-CUS-02, TRC-CUS-15 | CW03 |
| CUS-018 | Per-wallet QR: expand, save, copy / رمز QR | BLOCKED_DECISION | Product owner | B-P02-07 | CF11 |
| CUS-019 | Payment proof (transaction number or image) / إثبات الدفع | BACKEND_ONLY | Lane A | TRC-CUS-10, B-P02-07 | CF12 |
| CUS-020 | Payment state display / حالات الدفع | BACKEND_ONLY | Lane B | TRC-CUS-11, B-P06-02, B-P03-01 | CF13 |
| CUS-021 | Order tracking screen and stages / متابعة الطلب | UI_NOT_PORTED | Lane C | TRC-CUS-07 | CF15 CW04 |
| CUS-022 | Customer cancellation / إلغاء الحجز | BACKEND_ONLY | Lane C | TRC-CUS-08 |  |
| CUS-023 | Technician photo sheet (before/after capture) / صور الفني | BLOCKED_DECISION | Product owner | TRC-CUS-12, TRC-CUS-10 | CF16 |
| CUS-024 | Completion and before/after comparison / المقارنة قبل وبعد | UI_NOT_PORTED | Lane A | TRC-CUS-10 | CF16 |
| CUS-025 | Rating after completion / التقييم | UI_NOT_PORTED | Lane D | TRC-CUS-09 |  |
| CUS-026 | Orders list / حجوزاتي | UI_NOT_PORTED | Lane A | TRC-CUS-01 | CF14 CW05 |
| CUS-027 | Order summary / payment receipt download / تنزيل الملخص | BLOCKED_DECISION | Product owner | TRC-CUS-17 | CF20 |
| CUS-028 | Garage / سياراتي | FIXTURE_ONLY | Lane A | A-P01-07, A-P01-10, A-P01-11, A-P02-01, TRC-CUS-02 | CF03 CW06 |
| CUS-029 | Account screen / حسابي | FIXTURE_ONLY | Lane A | TRC-CUS-02, TRC-CUS-04 | CW07 |
| CUS-030 | Profile sheet / بياناتي | BACKEND_ONLY | Lane A | A-P01-03, A-P01-04, A-P01-05 |  |
| CUS-031 | Saved addresses book / عناويني | FIXTURE_ONLY | Lane A | A-P01-02, TRC-CUS-02 | CF19 |
| CUS-032 | Motion setting and reduced motion / المؤثرات الحركية | PARTIAL | Lane A | TRC-CUS-14 | CF18 |
| CUS-033 | Designer payment lab and merchant config (prototype only) / مختبر الد… | PROTOTYPE_ONLY_EXCLUDED | Lane A | TRC-CUS-04 |  |
| CUS-034 | Tracking simulation controls (prototype only) / محاكاة التقدم | PROTOTYPE_ONLY_EXCLUDED | Lane A |  |  |
| CUS-035 | Demo data fill and sample addresses (prototype only) / بيانات تجريبية | PROTOTYPE_ONLY_EXCLUDED | Lane A | TRC-CUS-04 |  |
| CUS-036 | Local export and reset (prototype only) / تنزيل وإعادة ضبط التجربة | PROTOTYPE_ONLY_EXCLUDED | Lane A | TRC-CUS-04 |  |
| CUS-037 | Fixture scenario selector (?scenario=) in production build | PROTOTYPE_ONLY_EXCLUDED | Lane A | TRC-CUS-03 |  |
| CUS-038 | Production loading/empty/offline/conflict/UNKNOWN states | DESIGN_PENDING | Design owner | TRC-CUS-13, A-P01-04 |  |
| CUS-039 | English / LTR customer UI | DESIGN_PENDING | Design owner | TRC-CUS-13 |  |
| TEC-001 | App shell, header, bottom navigation, sheet close / الهيكل والتنقل | IMPLEMENTED_UNACCEPTED | Lane C | TRC-TEC-01, TI-D13, TRC-TEC-05 |  |
| TEC-002 | Home and daily readiness / الرئيسية والجاهزية | PARTIAL | Lane C | TRC-TEC-01, TRC-TEC-05 | TV01 |
| TEC-003 | Task list and filters / قائمة المهام | PARTIAL | Lane C | TRC-TEC-01, TRC-TEC-05 | TV02 |
| TEC-004 | Collections ledger / التحصيل | PARTIAL | Lane C | TRC-TEC-01, TRC-TEC-03, TI-D09, D9 | TV03 |
| TEC-005 | Profile (reference parts: motion) / حسابي | IMPLEMENTED_UNACCEPTED | Lane C | D8, TI-D02, TI-D10 | TV04 |
| TEC-006 | Profile additions PN-01..03: readiness reasons, schedule, exceptions,… | PARTIAL | Lane C | TRC-TEC-01, P05-C-D1, CR-P05-C1, TRC-TEC-05 |  |
| TEC-007 | Collections custody PN-04 (Billing custody position) / العهدة | PARTIAL | Lane B | TRC-TEC-01, TRC-TEC-07, TI-D09 |  |
| TEC-008 | Task screen, stepper and primary dock / شاشة المهمة | PARTIAL | Lane C | TRC-TEC-01, TRC-TEC-05 | TV05 |
| TEC-009 | Phase 1 task: assigned offer and accepted / المهمة | PARTIAL | Lane C | TRC-TEC-01, D10, TI-D05, TRC-TEC-05 | TP01 |
| TEC-010 | Phase 2 route and illustrative map / الطريق | IMPLEMENTED_UNACCEPTED | Lane C | TI-D11, TI-D04, D7 | TP02 |
| TEC-011 | Arrival confirmation sheet / تأكيد الوصول | PARTIAL | Lane C | TRC-TEC-01, TI-D11 | TS08 |
| TEC-012 | Phase 3 before photos and photo options / قبل الغسيل | PARTIAL | Lane C | TRC-TEC-01, TI-D08, TRC-TEC-05 | TP03 TS09 |
| TEC-013 | Phase 4 care checklist and before-view / العناية | PARTIAL | Lane C | TRC-TEC-01, TI-D08 | TP04 TS10 |
| TEC-014 | Phase 5 after photos and finish-wash confirmation / بعد الغسيل | PARTIAL | Lane C | TRC-TEC-01, TI-D08, TRC-TEC-05 | TP05 TS11 |
| TEC-015 | Before/after result sheet and reveal / النتيجة | PARTIAL | Lane C | TRC-TEC-01, TI-D07 | TS12 |
| TEC-016 | Phase 6 handoff and handoff confirmation / التسليم | PARTIAL | Lane C | TRC-TEC-01, TI-D05, DEV-02 | TP06 TS18 |
| TEC-017 | Cash receipt sheet / تسجيل التحصيل | PARTIAL | Lane B | TRC-TEC-01, TRC-TEC-03, TRC-TEC-07, DEV-02, TI-D09 | TS13 |
| TEC-018 | Closed / completed and released summary / مكتمل | PARTIAL | Lane C | TRC-TEC-01 |  |
| TEC-019 | Reassignment / decline request sheet / طلب إعادة الإسناد | BLOCKED_DECISION | Product owner | DEV-01, TI-D06, TRC-TEC-01 | TS14 |
| TEC-020 | Uncollected cash sheet / لم أستلم المبلغ | PARTIAL | Lane C | DEV-02, TRC-TEC-01, TRC-TEC-03 | TS15 |
| TEC-021 | Electronic payment follow-up note / متابعة الدفع الإلكتروني | BLOCKED_DECISION | Product owner | TI-D05, CR-P05-C2-field-obstacle-and-receipts, TRC-TEC-01 | TS16 |
| TEC-022 | Help / obstacle note / مساعدة | PARTIAL | Lane D | CR-P05-C2-field-obstacle-and-receipts, TRC-TEC-01 | TS17 |
| TEC-023 | Notifications sheet / الإشعارات | PARTIAL | Lane D | DEV-03, TRC-TEC-01, TRC-TEC-08 | TS02 |
| TEC-024 | Task menu / قائمة المهمة | IMPLEMENTED_UNACCEPTED | Lane C | TRC-TEC-05 | TS03 |
| TEC-025 | Contact and arrival message preview / التواصل | PARTIAL | Lane D | TRC-TEC-01, TRC-TEC-08 | TS04 TS05 |
| TEC-026 | Amount breakdown / تفاصيل المبلغ | PARTIAL | Lane C | D2, TRC-TEC-01 | TS06 |
| TEC-027 | Task history / السجل | PARTIAL | Lane C | TRC-TEC-01 | TS07 |
| TEC-028 | Prototype walkthrough guide / دليل التجربة | PROTOTYPE_ONLY_EXCLUDED | Design owner |  | TS01 |
| TEC-029 | Demo contact and demo photos / عناصر العرض التجريبي | PROTOTYPE_ONLY_EXCLUDED | Design owner |  |  |
| TEC-030 | Privacy explanation (local prototype) / الخصوصية | PROTOTYPE_ONLY_EXCLUDED | Product owner | TI-D10 | TS19 |
| TEC-031 | Design feedback notes / ملاحظات التصميم | PROTOTYPE_ONLY_EXCLUDED | Design owner |  | TS20 |
| TEC-032 | Trial reset / إعادة ضبط التجربة | PROTOTYPE_ONLY_EXCLUDED | Design owner | TI-D10 | TS21 |
| TEC-033 | Production states: loading/offline/UNKNOWN/auth/conflict / حالات الإن… | DESIGN_PENDING | Design owner | TI-D03, TI-D02 |  |
| TEC-034 | Visual parity, accessibility and motion / المطابقة البصرية والوصول | BLOCKED_DECISION | Design owner | TI-D13, TI-D01 |  |
| TEC-035 | Deployment, gateway exposure and readiness / النشر والبوابة | BLOCKED_DECISION | Lane E | TRC-TEC-01, TRC-TEC-02, TRC-TEC-06 |  |
| TEC-036 | English/LTR, login/onboarding, team-lead surfaces / الإنجليزية والدخول | DESIGN_PENDING | Design owner | TI-D01, TI-D02, TI-D12 |  |
| ADM-001 | Shell navigation and mobile sidebar / التنقل والقائمة الجانبية | PARTIAL | Lane D | DEC-D-18, CR-D-P03-09, TRC-ADM-01 | AS01 |
| ADM-002 | Global search / البحث العام | PARTIAL | Lane D | CR-D-P02-01, DEC-D-18, TRC-ADM-05 | AS02 |
| ADM-003 | Language control EN/AR / تبديل اللغة | PARTIAL | Design owner | DEC-D-18 | AS05 |
| ADM-004 | Notification icon / أيقونة الإشعارات | DESIGN_PENDING | Design owner | DEC-D-12, DEC-D-18 | AS03 |
| ADM-005 | Profile / account control / الحساب | PARTIAL | Lane D | DEC-D-09, DEC-D-10, DEC-D-18 | AS04 |
| ADM-006 | Shared modal shell (close/cancel/save) / النافذة المشتركة | PARTIAL | Lane D | DEC-D-18 | AS06 |
| ADM-007 | Toast / رسالة التنبيه | PARTIAL | Lane D | TRC-ADM-05 |  |
| ADM-008 | Staff sign-in and session states / تسجيل دخول الموظفين | DESIGN_PENDING | Design owner | DEC-D-09, DEC-D-10, DEC-D-18 |  |
| ADM-009 | Dashboard / لوحة التحكم | PARTIAL | Lane D | CR-D-P03-02, CR-D-P03-01, CR-D-P03-03, DEC-D-14, DEC-D-16 +2 | AN01 |
| ADM-010 | Dashboard jumps (view all, create report, pending items) / روابط لوحة… | UI_NOT_PORTED | Lane D | CR-D-P02-04, B-P06-07, CR-D-P04-04, DEC-D-14 |  |
| ADM-011 | Bookings / الحجوزات | PARTIAL | Lane D | CR-D-P02-01, CR-D-P03-02, CR-D-P03-06, CR-D-P02-05, CR-D-P03-09 +3 | AN02 |
| ADM-012 | Manual booking modal / إنشاء حجز يدوي | UI_NOT_PORTED | Lane C | DEC-D-01, DEC-D-04, DEC-D-15, DEC-D-18 |  |
| ADM-013 | Customers / الزبائن | UI_NOT_PORTED | Lane A | DEC-D-06, DEC-D-07, DEC-D-14, DEC-D-18, TRC-ADM-07 | AN03 |
| ADM-014 | Technicians / الفنيون | PARTIAL | Lane D | CR-D-P02-01, CR-D-P02-02, CR-D-P02-04, DEC-D-01, DEC-D-13 +2 | AN04 |
| ADM-015 | Add technician modal / إضافة فني جديد | BACKEND_ONLY | Lane C | DEC-D-01, DEC-D-09, DEC-D-18 |  |
| ADM-016 | Services and packages / الخدمات والباقات | BACKEND_ONLY | Lane B | B-P06-05, B-P06-08, B-04, DEC-D-04, DEC-D-11 +1 | AN05 |
| ADM-017 | Add package modal / إضافة باقة | BACKEND_ONLY | Lane B | B-P06-08, DEC-D-04, DEC-D-11, DEC-D-15 |  |
| ADM-018 | Fleet and service vehicles / الأسطول والمركبات | BLOCKED_DECISION | Product owner | DEC-D-02, DEC-D-16, DEC-D-18 | AN06 |
| ADM-019 | Payments / المدفوعات | PARTIAL | Lane D | CR-D-P03-02, CR-D-P03-04, CR-D-P04-06, B-P06-02, B-P06-07 +6 | AN07 |
| ADM-020 | Wallets (field custody) / المحافظ | BACKEND_ONLY | Lane B | CR-D-P03-04, B-P06-07, B-P06-08, B-07, B-08 +1 | AN08 |
| ADM-021 | Subscriptions / الاشتراكات | BACKEND_ONLY | Lane B | B-09, DEC-D-04, DEC-D-05, TRC-ADM-06 | AN09 |
| ADM-022 | Promotions and coupons / العروض والكوبونات | BACKEND_ONLY | Lane B | B-10, DEC-D-04, DEC-D-07, DEC-D-11 | AN10 |
| ADM-023 | New promotion modal / إنشاء عرض جديد | BACKEND_ONLY | Lane B | B-10, DEC-D-04, DEC-D-15 |  |
| ADM-024 | Areas and coverage / المناطق والتغطية | UI_NOT_PORTED | Lane A | DEC-D-02, DEC-D-11, DEC-D-18 | AN11 |
| ADM-025 | Live map / الخريطة الحية | BLOCKED_DECISION | Product owner | DEC-D-02, DEC-D-06, CR-D-P03-03, TRC-ADM-08 | AN12 |
| ADM-026 | Reviews and ratings / التقييمات | UI_NOT_PORTED | Lane D | DEC-D-13, DEC-D-18, TRC-ADM-09 | AN13 |
| ADM-027 | Disputes / النزاعات | BACKEND_ONLY | Lane D | CR-D-P04-01, CR-D-P04-03, CR-D-P04-04, DEC-D-05, DEC-D-18 | AN14 |
| ADM-028 | Notifications / الإشعارات | BLOCKED_DECISION | Product owner | DEC-D-07, DEC-D-12, CR-D-P03-06, CR-D-P03-07 | AN15 |
| ADM-029 | Send notification modal / إرسال إشعار | BLOCKED_DECISION | Product owner | DEC-D-07, DEC-D-12, DEC-D-15 |  |
| ADM-030 | Reports and analytics / التقارير والتحليلات | UI_NOT_PORTED | Lane D | DEC-D-14, DEC-D-06, B-12 | AN16 |
| ADM-031 | Settings / الإعدادات (incl. save) | BACKEND_ONLY | Lane D | CR-D-P05-D5-01, CR-D-P05-D5-04, CR-D-P05-D5-07, CR-D-P05-D5-08, CR-D-P05-D5-09 +3 | AN17 |
| ADM-032 | English/LTR, accessibility and visual parity gate / الإنجليزية والوصو… | DESIGN_PENDING | Design owner | DEC-D-18, CR-D-P03-09, TRC-ADM-04 |  |
| ADM-033 | Admin role and permission model / نموذج الأدوار والصلاحيات | PARTIAL | Lane E | DEC-D-09, DEC-D-10, CR-D-P02-02, CR-D-P05-D5-04, B-P06-08 +1 |  |
| X-SVC-01 | identity owner service runtime | ACCEPTED_HISTORICAL | Lane E | TRC-X-01, TRC-X-02, A-P01-08, A-P01-13, A-P02-G2 +3 | SR01 |
| X-SVC-02 | customer owner service runtime | IMPLEMENTED_UNACCEPTED | Lane A | TRC-X-01, TRC-X-02, A-P01-04, TRC-CUS-02, TRC-ADM-07 | SR02 |
| X-SVC-03 | vehicle owner service runtime | IMPLEMENTED_UNACCEPTED | Lane A | TRC-X-01, TRC-X-02, A-P01-04, A-P02-01, TRC-ADM-07 | SR03 |
| X-SVC-04 | catalog owner service runtime | IMPLEMENTED_UNACCEPTED | Lane B | TRC-X-01, TRC-X-02, B-P06-05 | SR04 |
| X-SVC-05 | pricing owner service runtime | IMPLEMENTED_UNACCEPTED | Lane B | TRC-X-01, TRC-X-02, B-P06-08 | SR05 |
| X-SVC-06 | booking owner service runtime | IMPLEMENTED_UNACCEPTED | Lane C | TRC-X-01, TRC-X-02, B-P03-01, B-P05-13, B-P05-23 +3 | SR06 |
| X-SVC-07 | scheduling owner service runtime | IMPLEMENTED_UNACCEPTED | Lane C | TRC-X-01, TRC-X-02 | SR07 |
| X-SVC-08 | dispatch owner service runtime | IMPLEMENTED_UNACCEPTED | Lane C | TRC-X-01, TRC-X-02, B-P03-01, CR-D-P03-03 | SR08 |
| X-SVC-09 | workforce owner service runtime | IMPLEMENTED_UNACCEPTED | Lane C | TRC-X-01, TRC-X-02, CR-D-P02-04, D8 | SR09 |
| X-SVC-10 | billing owner service runtime | IMPLEMENTED_UNACCEPTED | Lane B | TRC-X-01, TRC-X-02, B-P05-14, B-P06-02, B-P06-03 +3 | SR10 |
| X-SVC-11 | wallet owner service runtime | IMPLEMENTED_UNACCEPTED | Lane B | TRC-X-01, TRC-X-02, B-P06-04, B-P06-07, CR-D-P03-04 +1 | SR11 |
| X-SVC-12 | subscription owner service runtime | IMPLEMENTED_UNACCEPTED | Lane B | TRC-X-01, TRC-X-02 | SR12 |
| X-SVC-13 | media owner service runtime | IMPLEMENTED_UNACCEPTED | Lane C | TRC-X-01, TRC-X-02 | SR13 |
| X-SVC-14 | communications owner service runtime | IMPLEMENTED_UNACCEPTED | Lane D | TRC-X-01, TRC-X-02 | SR14 |
| X-SVC-15 | reviews owner service runtime | NOT_STARTED | Lane D | TRC-ADM-09, TRC-X-01, TRC-X-02, TRC-CUS-09 | SR15 |
| X-SVC-16 | support owner service runtime | IMPLEMENTED_UNACCEPTED | Lane D | TRC-X-01, TRC-X-02 | SR16 |
| X-SVC-17 | geo owner service runtime | IMPLEMENTED_UNACCEPTED | Lane A | TRC-X-01, TRC-X-02, D7 | SR17 |
| X-SVC-18 | reporting owner service runtime | IMPLEMENTED_UNACCEPTED | Lane D | TRC-X-01, TRC-X-02, TRC-ADM-02, TRC-ADM-03 | SR18 |
| X-SVC-19 | configuration owner service runtime | IMPLEMENTED_UNACCEPTED | Lane D | TRC-X-01, TRC-X-02 | SR19 |
| X-RT-01 | API gateway routing and composition | PARTIAL | Lane E | TRC-TEC-01, TRC-TEC-02, TRC-CUS-01, CR-D-P02-01, CR-D-P03-02 +1 | RT01 |
| X-AP-01 | customer-web deployable runtime | FIXTURE_ONLY | Lane A | TRC-CUS-02, TRC-CUS-03, TRC-X-02 | AP01 |
| X-AP-02 | operator-web deployable runtime | PARTIAL | Lane C | TRC-TEC-01, TRC-TEC-05 | AP02 |
| X-AP-03 | admin-web deployable runtime | PARTIAL | Lane D | TRC-ADM-01, TRC-ADM-04 | AP03 |
| X-G01 | Prior40/foundation provenance | ACCEPTED_HISTORICAL | Lane E | TRC-X-01 | G01 |
| X-G02 | Required production/English decisions and missing designs | DESIGN_PENDING | Design owner | TI-D01, TI-D02, TI-D03 | G02 |
| X-G03 | All finance/benefit methods | BLOCKED_DECISION | Lane B | B-02, B-03, B-08 | G03 |
| X-G04 | Authoritative full reporting | PARTIAL | Lane D | TRC-ADM-03, TRC-X-02 | G04 |
| X-G05 | Populated accepted-base migration upgrade | PARTIAL | Lane E | TRC-X-02 | G05 |
| X-G06 | Published immutable artifacts | IMPLEMENTED_UNACCEPTED | Lane E | TRC-X-02 | G06 |
| X-G07 | Three app builds and released route readiness | PARTIAL | Lane E | TRC-TEC-01, TRC-CUS-02, CR-D-P03-02 | G07 |
| X-G08 | Actual app vs reference on devices (visual parity) | PARTIAL | Lane E | TRC-ADM-04, TRC-TEC-05 | G08 |
| X-G09 | Durable faults and privacy | PARTIAL | Lane E | TRC-X-02 | G09 |
| X-G10 | Existing staging promotion | BLOCKED_DECISION | Operations | TRC-X-02 | G10 |
| X-G11 | Numeric hardening/operating-window profile | BLOCKED_DECISION | Product owner | TRC-X-02 | G11 |
| X-G12 | Exact complete candidate and release barrier | BLOCKED_DECISION | Lane E | TRC-X-02, TRC-X-03 | G12 |

## Blocker register

361 blockers, each with a classification, owner, state and an existing source file. They are deduplicated from every lane record (docs/production A–E, docs/parallel decisions, finance-matrix) plus the new `TRC-*` findings.

- By state: RESOLVED 46, OPEN 270, SUPERSEDED 21, UNKNOWN 24.
- By classification: CONTRACT_GAP 83, INTEGRATION_GAP 74, OWNER_DECISION 65, CODE_GAP 47, DESIGN_PENDING 39, TEST_EVIDENCE_GAP 26, DOC_DRIFT 11, EXTERNAL_DEPENDENCY 8, SECURITY_DEFECT 8.
- By owner: Lane E 185, Product owner 63, Design owner 38, Lane B 20, Lane C 18, Lane A 12, Lane D 9, Repository administrator 6, Operations 4, Lane C + Lane E 3, Lane E + Lane C 1, Lane B + Lane A 1, Lane A + Lane E 1.
- SUPERSEDED marks on wave-era items were inferred from later merged code and never formally closed. Treat them as review candidates, not closures.

Open blockers referenced by requirement rows:

| ID | Class | Owner | Summary | Source |
|---|---|---|---|---|
| A-P01-03 | INTEGRATION_GAP | Lane A | Events, topology and relay dependency — - Register these events in @carwash/event-contracts, using the shared envelope … | `docs/production/A/P01-A_CONTRACT_REQUESTS.md:42` |
| A-P01-04 | CODE_GAP | Lane A | Identity guest sessions and claim — - Identity V1 issues account sessions only. Customer and Vehicle already model | `docs/production/A/P01-A_CONTRACT_REQUESTS.md:55` |
| A-P01-05 | CONTRACT_GAP | Lane A | Service dependency for direct token verification (optional) — - Owner services currently ask Identity for current-sessi… | `docs/production/A/P01-A_CONTRACT_REQUESTS.md:65` |
| A-P01-07 | INTEGRATION_GAP | Lane E | Gateway: add vehicle to GatewayOwner, route /api/v1/customer/vehicles \| Lane E | `docs/production/A/P01-A2_VEHICLE_PROVIDER.md:152` |
| A-P01-08 | CONTRACT_GAP | Lane E | Optional narrower Identity permission for saved vehicles \| Identity/E | `docs/production/A/P01-A2_VEHICLE_PROVIDER.md:153` |
| A-P01-10 | OWNER_DECISION | Product owner | Accept or replace A2-D1 (principal-keyed ownership) \| Owner/E | `docs/production/A/P01-A2_VEHICLE_PROVIDER.md:155` |
| A-P01-11 | OWNER_DECISION | Product owner | Owner decision on garage deduplication (A2-D2) \| Owner | `docs/production/A/P01-A2_VEHICLE_PROVIDER.md:156` |
| A-P01-12 | EXTERNAL_DEPENDENCY | Product owner | Approved Aleppo zone dataset (source, licence, boundary/overlap/effective rules) \| Owner | `docs/production/A/P01-A3_GEO_PROVIDER.md:149` |
| A-P01-13 | INTEGRATION_GAP | Lane E | Identity permission for zone management (e.g. geo.zones.write:operations) and an audited admin route \| Identity/E | `docs/production/A/P01-A3_GEO_PROVIDER.md:150` |
| A-P01-14 | INTEGRATION_GAP | Lane E | Publish geo.v1 contract and client; gateway owner geo and the public serviceability route \| Lane E | `docs/production/A/P01-A3_GEO_PROVIDER.md:151` |
| A-P02-01 | CONTRACT_GAP | Lane A | - A-P02-01. Add @carwash/contracts to @carwash/vehicle (manifest + | `docs/production/A/P02-A2_VEHICLE_V1_PROVIDER.md:237` |
| A-P02-G2 | INTEGRATION_GAP | Lane E | Workload identity (service: scopes) is not on main. /serviceability/validate stays closed, and Booking cannot validate … | `docs/production/A/P02-A3_GEO_V1_PROVIDER.md:250` |
| B-02 | OWNER_DECISION | Product owner | Paymera: required for initial launch, deferred or excluded; a fourth payment method needs an owner-approved UI change. | `docs/parallel/B/W01/POLICY_DECISIONS.md:10` |
| B-03 | OWNER_DECISION | Product owner | Settlement/display currencies, minor-unit exponent, denomination conversions, max amount; Pricing fails closed POLICY_U… | `docs/parallel/B/W01/POLICY_DECISIONS.md:11` |
| B-04 | OWNER_DECISION | Product owner | Real package/add-on rates per vehicle category, included add-ons, zone/travel fees, tax/invoice treatment, rounding ord… | `docs/parallel/B/W01/POLICY_DECISIONS.md:12` |
| B-07 | OWNER_DECISION | Product owner | Cash custody holder (technician/team/both), treasury identity, handover frequency/thresholds, shortage/overage handling. | `docs/parallel/B/W01/POLICY_DECISIONS.md:15` |
| B-08 | OWNER_DECISION | Product owner | Wallet scope: technician custody only, or any customer stored value/funding/withdrawal/hold product (explicitly outside… | `docs/parallel/B/W01/POLICY_DECISIONS.md:16` |
| B-09 | OWNER_DECISION | Product owner | Customer wash plans: price, entitlement units/expiry, reserve/consume trigger, freeze/cancel/renewal/refund rules. | `docs/parallel/B/W01/POLICY_DECISIONS.md:17` |
| B-10 | OWNER_DECISION | Product owner | Promotion eligibility, dates/timezone, stacking, max uses/budget, per-owner limits, reservation/redemption timing. | `docs/parallel/B/W01/POLICY_DECISIONS.md:18` |
| B-11 | EXTERNAL_DEPENDENCY | Product owner | ShamCash/Syriatel Cash merchant agreements, account IDs, official verification/refund/notification docs, sandbox and co… | `docs/parallel/B/W01/POLICY_DECISIONS.md:19` |
| B-12 | OWNER_DECISION | Product owner | Financial export fields, deletion fulfilment ownership, retention categories/durations, anonymisation and legal hold. | `docs/parallel/B/W01/POLICY_DECISIONS.md:20` |
| B-P02-05 | INTEGRATION_GAP | Lane E | Workload identity for the booking saga to create and void obligations (CR-B-03.2) \| E, then B2 + Booking | `docs/production/B/P02-B1-BILLING.md:222` |
| B-P02-07 | EXTERNAL_DEPENDENCY | Product owner | Merchant accounts, per-wallet QR/payee data and provider statement access for real reconciliation \| Owner + providers … | `docs/production/B/P02-B1-BILLING.md:224` |
| B-P03-01 | CONTRACT_GAP | Lane C | No work-completion state exists (Dispatch stops at ASSIGNED), and no published contract tells Billing the booking's quo… | `docs/production/B/P03-B1-CASH-CUSTODY.md:399` |
| B-P03-02 | CONTRACT_GAP | Lane E | Identity permissions billing.cash.collect, billing.cash.correct, billing.treasury.receive (CR-B-08.1) and billing.recon… | `docs/production/B/P03-B1-CASH-CUSTODY.md:400` |
| B-P05-13 | INTEGRATION_GAP | Lane C | Booking saga integration: reserve, commit and release (CR-B-10.4) \| C (after E) | `docs/production/B/P05-B1-SUBSCRIPTION.md:156` |
| B-P05-14 | CODE_GAP | Lane B | Billing plan-purchase obligation, so activation is verified automatically (CR-B-10.6) \| B + E, owner B-09 | `docs/production/B/P05-B1-SUBSCRIPTION.md:157` |
| B-P05-23 | INTEGRATION_GAP | Lane C | Booking saga: reserve/commit/release redemption; Billing bills the discounted quote total \| C (after E) | `docs/production/B/P05-B2-PROMOTIONS.md:118` |
| B-P05-31 | INTEGRATION_GAP | Lane E | Runtime broker dependency, queue/bindings/DLQ, Wallet broker identity, Billing outbox relay (CR-B-12.3) \| E | `docs/production/B/P05-B3-WALLET-CUSTODY.md:108` |
| B-P06-02 | INTEGRATION_GAP | Lane B | Merged P04-B Billing serves refunds and provider notifications at paths that differ from billing.v1 and the Gateway ups… | `docs/production/B/finance-matrix.json:939` |
| B-P06-03 | INTEGRATION_GAP | Lane B | Provider-credit statement and credit-based refund owner routes (P04-B) have no billing.v1 contract entry or Gateway adm… | `docs/production/B/finance-matrix.json:946` |
| B-P06-04 | INTEGRATION_GAP | Lane B | Billing and Wallet do not depend on @carwash/platform-messaging; adding it changes the E-owned lockfile, so no relay/co… | `docs/production/B/finance-matrix.json:953` |
| B-P06-05 | INTEGRATION_GAP | Lane B | Gateway customer.catalog forwards to /internal/v1/catalog/packages while catalog.v1 publishes /definitions. | `docs/production/B/finance-matrix.json:960` |
| B-P06-06 | INTEGRATION_GAP | Lane B | Booking saga does not yet call Billing booking-obligations with a billing.obligation.write service credential. | `docs/production/B/finance-matrix.json:967` |
| B-P06-07 | INTEGRATION_GAP | Lane B | Finance summary, reconciliation queue and wallet.v1 custody read are owner-implemented but not published contracts or G… | `docs/production/B/finance-matrix.json:974` |
| B-P06-08 | CONTRACT_GAP | Lane B | Identity does not grant contract permissions pricing.prices.publish, billing.cash.collect, billing.cash.correct and bil… | `docs/production/B/finance-matrix.json:981` |
| CR-D-P02-01 | INTEGRATION_GAP | Lane E | (Lane E): Gateway support for operations reads — Findings on main: | `docs/production/D/P02_CONTRACT_REQUESTS.md:15` |
| CR-D-P02-02 | CONTRACT_GAP | Lane E | (Lane E / Identity): read permission decision D-P02-01 — Reporting authorizes operations reads with existing permission… | `docs/production/D/P02_CONTRACT_REQUESTS.md:58` |
| CR-D-P02-04 | CODE_GAP | Lane C | (Lane C, Workforce owner): verification-case reads — The approved "طلبات الانضمام" panel needs to list cases. Workforce… | `docs/production/D/P02_CONTRACT_REQUESTS.md:99` |
| CR-D-P02-05 | CODE_GAP | Lane C | (Booking owner): authoritative booking read for staff — The approved bookings table shows the customer, vehicle, packag… | `docs/production/D/P02_CONTRACT_REQUESTS.md:119` |
| CR-D-P03-01 | CONTRACT_GAP | Lane E | (Lane E): publish the Dispatch and Billing events Reporting folds — Requested: | `docs/production/D/P03_CONTRACT_REQUESTS.md:18` |
| CR-D-P03-02 | INTEGRATION_GAP | Lane E | (Lane E): Gateway routes for the admin live-operations console — All of these depend on CR-D-P02-01 (query allowlist an… | `docs/production/D/P03_CONTRACT_REQUESTS.md:45` |
| CR-D-P03-03 | CODE_GAP | Lane C | (Lane C, Dispatch owner): field progress — Admin live status and the job-stage KPIs need field progress after | `docs/production/D/P03_CONTRACT_REQUESTS.md:72` |
| CR-D-P03-04 | CONTRACT_GAP | Lane B | (Lane B, Billing and Wallet owner): cash custody and booking linkage — 1. Add bookingId to billing.obligation-created.v… | `docs/production/D/P03_CONTRACT_REQUESTS.md:86` |
| CR-D-P03-06 | INTEGRATION_GAP | Lane E | (Lane E): notification read routes — \| Route id \| Method and path \| Upstream (owner) \| Permission | `docs/production/D/P03_CONTRACT_REQUESTS.md:134` |
| CR-D-P03-07 | INTEGRATION_GAP | Lane E | (Lane E + owners): event-notification topology and recipients — 1. Declare booking.events in the shared bootstrap. | `docs/production/D/P03_CONTRACT_REQUESTS.md:143` |
| CR-D-P03-09 | OWNER_DECISION | Design owner | (owner decision): contrast of the approved admin subtitles — The approved admin reference styles .page-head p with --mu… | `docs/production/D/P03_CONTRACT_REQUESTS.md:185` |
| CR-D-P04-06 | CODE_GAP | Lane B | (Lane B): finance review queue and reconciliation reference — 1. GET /internal/v1/billing/payment-attempts?status=PENDI… | `docs/production/D/P04_CONTRACT_REQUESTS.md:256` |
| CR-D-P05-D5-01 | CONTRACT_GAP | Lane E | - CR-D-P05-D5-01: add @carwash/contracts and @carwash/platform-messaging | `docs/production/D/P05-D5_CONFIGURATION_SETTINGS.md:222` |
| CR-D-P05-D5-04 | CONTRACT_GAP | Lane E | - CR-D-P05-D5-04 (refreshes CR-D-P01-01): add the permissions configuration.read, | `docs/production/D/P05-D5_CONFIGURATION_SETTINGS.md:229` |
| CR-D-P05-D5-07 | INTEGRATION_GAP | Lane E | - CR-D-P05-D5-07: Gateway admin routes (owner configuration), each listed as | `docs/production/D/P05-D5_CONFIGURATION_SETTINGS.md:246` |
| CR-D-P05-D5-08 | OWNER_DECISION | Product owner | - CR-D-P05-D5-08 (owner decision): the reference timezone options (Asia/Riyadh, | `docs/production/D/P05-D5_CONFIGURATION_SETTINGS.md:258` |
| CR-D-P05-D5-09 | CONTRACT_GAP | Lane E | - CR-D-P05-D5-09: «الحد الأقصى للتأخير» needs a field. Proposal: booking.policy.v1 stays | `docs/production/D/P05-D5_CONFIGURATION_SETTINGS.md:261` |
| CR-D-P05-D5-10 | CODE_GAP | Lane E | - CR-D-P05-D5-10: an Identity read of role membership counts for the settings roles card | `docs/production/D/P05-D5_CONFIGURATION_SETTINGS.md:264` |
| CR-P05-C1 | CODE_GAP | Lane E | Workforce operational profile (request to Lane E) — Requester: Lane C (P05-C / C1). Implementation: services/workforce | `docs/production/C/contract-requests/CR-P05-C1-workforce-profile.md:1` |
| DEC-D-01 | OWNER_DECISION | Product owner | Technician operating model — product owner + Workforce + Finance \| Company employees, independent contractors, provide… | `docs/parallel/D/W01/DECISIONS.md:18` |
| DEC-D-02 | OWNER_DECISION | Product owner | Operational fleet ownership — product owner + Workforce + Scheduling/Dispatch \| Company-owned vans/equipment only, wor… | `docs/parallel/D/W01/DECISIONS.md:19` |
| DEC-D-03 | OWNER_DECISION | Product owner | Wallet holders and purpose — product owner + Billing/Wallet \| Confirm whether the initial wallet scope is technician/c… | `docs/parallel/D/W01/DECISIONS.md:20` |
| DEC-D-04 | OWNER_DECISION | Product owner | Market, currencies, taxes and rounding — product owner + qualified finance reviewer \| Confirm launch market(s), settle… | `docs/parallel/D/W01/DECISIONS.md:21` |
| DEC-D-05 | OWNER_DECISION | Product owner | Cancellation, refunds and approval separation — product owner + Booking + Billing + Support \| Who may approve full/par… | `docs/parallel/D/W01/DECISIONS.md:22` |
| DEC-D-06 | OWNER_DECISION | Product owner | Retention, privacy fulfillment and legal hold — privacy/operations owner + each data owner \| For identity challenges/s… | `docs/parallel/D/W01/DECISIONS.md:23` |
| DEC-D-07 | OWNER_DECISION | Product owner | Consent and purpose — privacy/product owner + Customer + Media + Communications \| Which processing is operationally ne… | `docs/parallel/D/W01/DECISIONS.md:24` |
| DEC-D-08 | OWNER_DECISION | Product owner | Payment providers including Paymera — product owner + Billing + security/finance reviewer \| Provide approved merchant/… | `docs/parallel/D/W01/DECISIONS.md:25` |
| DEC-D-09 | OWNER_DECISION | Product owner | Admin grant model, scopes, MFA and separation — Identity + every domain owner + security reviewer \| Approve operation-… | `docs/parallel/D/W01/DECISIONS.md:26` |
| DEC-D-10 | OWNER_DECISION | Operations | First-admin bootstrap and recovery — deployment owner + Identity/security reviewer \| Who holds the offline capability,… | `docs/parallel/D/W01/DECISIONS.md:27` |
| DEC-D-11 | OWNER_DECISION | Product owner | Configuration governance and activation — product owner + Configuration + policy-owning domains \| Who drafts/validates… | `docs/parallel/D/W01/DECISIONS.md:28` |
| DEC-D-12 | OWNER_DECISION | Product owner | Communications providers and delivery/privacy promises — Communications + privacy/product owner \| Initial channels (in… | `docs/parallel/D/W01/DECISIONS.md:29` |
| DEC-D-13 | OWNER_DECISION | Product owner | Verified reviews and moderation — Reviews + product/privacy owner \| Eligibility after completion, one review per compl… | `docs/parallel/D/W01/DECISIONS.md:30` |
| DEC-D-14 | OWNER_DECISION | Product owner | Reporting sensitive exports — Reporting + privacy/domain owners \| Allowed report types, fields, audience, purpose code… | `docs/parallel/D/W01/DECISIONS.md:31` |
| DEC-D-15 | OWNER_DECISION | Lane E | Idempotency lifetime and expired-key behavior — platform E + owners + privacy/security reviewer \| Approve replay windo… | `docs/parallel/D/W01/DECISIONS.md:32` |
| DEC-D-16 | OWNER_DECISION | Operations | Dependency deadlines, freshness and recovery — operations/platform E + owners \| Approve per-operation HTTP deadlines, … | `docs/parallel/D/W01/DECISIONS.md:33` |
| DEC-D-18 | DESIGN_PENDING | Design owner | Admin approval provenance, localization and missing production states — product/design owner \| Reconcile the historica… | `docs/parallel/D/W01/DECISIONS.md:35` |
| TI-D01 | DESIGN_PENDING | Design owner | TECH and CUSTOMER are Arabic RTL only; ADMIN English toggle translates data-i18n/global placeholder, not tables/details… | `docs/parallel/C/W01/TECHNICIAN_INVENTORY.md:131` |
| TI-D02 | DESIGN_PENDING | Design owner | No technician production login/invitation/onboarding/document reviewer/dossier/eligibility denial interface \| E Identi… | `docs/parallel/C/W01/TECHNICIAN_INVENTORY.md:132` |
| TI-D03 | DESIGN_PENDING | Design owner | No server loading/mutation timeout/offline retry/conflict/revocation/expired assignment or clean-scan pending/error UI … | `docs/parallel/C/W01/TECHNICIAN_INVENTORY.md:133` |
| TI-D04 | OWNER_DECISION | Product owner | TECH/ADMIN geo/time/currency demo values differ from intended Aleppo market \| Owner-approved Aleppo service zones, hou… | `docs/parallel/C/W01/TECHNICIAN_INVENTORY.md:134` |
| TI-D05 | OWNER_DECISION | Product owner | Pending electronic execution policy differs between TECH and CUSTOMER \| Owner/B execution prerequisite; Payment indepe… | `docs/parallel/C/W01/TECHNICIAN_INVENTORY.md:135` |
| TI-D06 | DESIGN_PENDING | Design owner | Local reassignment closes job; no request pending/rejected/reassigned/acknowledged UI \| Dispatch-owned request and aud… | `docs/parallel/C/W01/TECHNICIAN_INVENTORY.md:136` |
| TI-D07 | DESIGN_PENDING | Design owner | Customer exterior/interior, incomplete-pair and expand/reset differ from TECH first-slot pair \| Accepted photo-angle/m… | `docs/parallel/C/W01/TECHNICIAN_INVENTORY.md:137` |
| TI-D08 | DESIGN_PENDING | Design owner | Before/after only two slots; either slot passes local required-image gate; condition note optional \| Real evidence cou… | `docs/parallel/C/W01/TECHNICIAN_INVENTORY.md:138` |
| TI-D09 | DESIGN_PENDING | Design owner | Admin custody has totals only; no deposit/handover discrepancy/receiver/settled detail screens \| B authoritative actor… | `docs/parallel/C/W01/TECHNICIAN_INVENTORY.md:139` |
| TI-D10 | OWNER_DECISION | Product owner | Local privacy/reset/export behavior is not a server rights workflow \| W01 owner privacy choice: request-only vs full o… | `docs/parallel/C/W01/TECHNICIAN_INVENTORY.md:140` |
| TI-D11 | DESIGN_PENDING | Design owner | Only drawn maps, no real technician task-location collection/read/permission denied/stale update UI \| Propose existing… | `docs/parallel/C/W01/TECHNICIAN_INVENTORY.md:141` |
| TI-D12 | OWNER_DECISION | Product owner | Technician employment model remains assumption; approved income/payroll feature absent \| Owner confirms company-manage… | `docs/parallel/C/W01/TECHNICIAN_INVENTORY.md:142` |
| TI-D13 | DESIGN_PENDING | Design owner | Registered accessibility debt: technician .design-footer serious contrast across all six widths \| Frozen debt is not W… | `docs/parallel/C/W01/TECHNICIAN_INVENTORY.md:143` |
| TRC-CUS-01 | CONTRACT_GAP | Lane E + Lane C | Gateway customer.bookings.read/create upstreams (/internal/v1/booking/mine, POST /internal/v1/booking) are not served b… | `packages/contracts/src/gateway.ts:120` |
| TRC-CUS-02 | INTEGRATION_GAP | Lane A | customer-web has no API client: no dependency on @carwash/contracts or @carwash/api-clients, no fetch; all data from sr… | `apps/customer-web/package.json:12` |
| TRC-CUS-03 | CODE_GAP | Lane A | ?scenario= fixture selector is evaluated unconditionally in the production bundle. | `apps/customer-web/src/main.tsx:16` |
| TRC-CUS-04 | CODE_GAP | Lane A | Production React exposes designer/demo controls: demo-contact fill, sample-address shortcuts, sheet-sample chips (funct… | `apps/customer-web/src/features/account/accountViewModel.ts:56` |
| TRC-CUS-05 | CONTRACT_GAP | Lane E | No customer gateway route for Scheduling availability/earliest/holds or Pricing quotes. | `services/scheduling/src/transport/http/scheduling.controller.ts:78` |
| TRC-CUS-06 | OWNER_DECISION | Product owner | No owner for booking draft persistence: React draft is memory-only (lost on reload), reference kept localStorage; Booki… | `apps/customer-web/src/state/CustomerSessionProvider.tsx:38` |
| TRC-CUS-07 | CONTRACT_GAP | Lane C + Lane E | No customer-facing tracking read projection (booking stage + dispatch assignment) or gateway route for /order/:id. | `packages/contracts/src/gateway.ts:48` |
| TRC-CUS-08 | CONTRACT_GAP | Lane E | Booking cancellation endpoint exists but no customer gateway route. | `services/booking/src/transport/http/booking.controller.ts:53` |
| TRC-CUS-09 | CODE_GAP | Lane D | Reviews service is an F001 skeleton; no rating API. | `services/reviews/src/index.ts:1` |
| TRC-CUS-10 | CONTRACT_GAP | Lane C + Lane E | No customer route for private before/after media reads or payment-proof image upload (Media read-url requires media.obj… | `services/media/src/transport/http/media.controller.ts:156` |
| TRC-CUS-11 | CONTRACT_GAP | Lane B + Lane A | No contract mapping Billing financial status (UNPAID/UNDER_REVIEW/PAID/SETTLED/VOIDED/REFUND_*) to the 8 approved custo… | `apps/customer-web/src/state/customerSession.ts:24` |
| TRC-CUS-12 | OWNER_DECISION | Product owner | Prototype technician photo sheet lets the customer upload before/after photos; production surface/ownership undecided. | `design/reference/approved/washgo-payments-interactive.html (technicianSheet)` |
| TRC-CUS-13 | DESIGN_PENDING | Design owner | Production loading/offline/conflict/UNKNOWN states and English/LTR not designed. | `docs/design/DESIGN_LOCK.md:80` |
| TRC-CUS-14 | TEST_EVIDENCE_GAP | Lane A + Lane E | Customer browser evidence is fixture-only C002–C014 CI runs (artifacts not retained); no browser/flow test against gate… | `scripts/c014/browser-acceptance.mjs` |
| TRC-CUS-15 | DOC_DRIFT | Lane E | W07 FULL_SCOPE_MATRIX customer rows say owner contracts UNPUBLISHED; customer.v1/vehicle.v1/geo.v1/scheduling.v1/billin… | `docs/parallel/E/W07/FULL_SCOPE_MATRIX.md:107` |
| TRC-CUS-16 | CONTRACT_GAP | Lane C + Lane E | Booking emits booking.created.v1 (unregistered) while the event registry has booking.confirmed.v1 (not emitted); no boo… | `services/booking/src/domain/events.ts:16` |
| TRC-CUS-17 | OWNER_DECISION | Product owner | Decide whether export-order/pay-export become server-issued receipts or are dropped in production. | `design/reference/approved/washgo-payments-interactive.html (exportOrder/exportPay)` |
| TRC-TEC-01 | INTEGRATION_GAP | Lane E | Production api-gateway only matches /api/v1/* GATEWAY_ROUTES; operator-web calls /api/operator/* exclusively (client re… | `apps/api-gateway/src/domain/policy.ts:28` |
| TRC-TEC-02 | CONTRACT_GAP | Lane E | Published gateway technician routes point to Booking upstreams /internal/v1/booking/assigned and /internal/v1/booking/:… | `packages/contracts/src/gateway.ts:210` |
| TRC-TEC-03 | INTEGRATION_GAP | Lane B | Technician cash declaration (dispatch close CASH_COLLECTED / cash-collection, event dispatch.cash-declared.v1) has no B… | `services/dispatch/src/domain/events.ts:58` |
| TRC-TEC-05 | TEST_EVIDENCE_GAP | Lane C | All operator-web browser journeys/visual/a11y/profile tests run against fixture doubles via a harness gateway; no commi… | `docs/production/C/P03-C5-operator-web.md:150` |
| TRC-TEC-06 | DOC_DRIFT | Lane C | apps/operator-web/F001.md still says "Ownership skeleton only; not a working app"; W10-C dossier and W07-E TV/TP/TS row… | `apps/operator-web/F001.md:3` |
| TRC-TEC-07 | CONTRACT_GAP | Lane E | Billing getMyCustody (custody/holders/me) and cash collection require billing.cash.collect, which the Identity technici… | `services/billing/src/application/cash-custody.service.ts:818` |
| TRC-TEC-08 | DESIGN_PENDING | Lane D | No notification delivery or customer contact/message channel exists for the technician; notifications sheet is a jobs r… | `apps/operator-web/src/views/sheets.ts:34` |
| TRC-ADM-01 | DOC_DRIFT | Lane E | Readiness/status docs say admin-web is a foundation shell with no product screen, but src ports shell+4 screens (41ec68… | `apps/admin-web/README.md:3` |
| TRC-ADM-02 | CONTRACT_GAP | Lane D | admin-web restates Reporting wire vocab (freshness, HOLD_STATES, ASSIGNMENT_STATUSES, derived statuses) locally and has… | `apps/admin-web/src/api/operations.ts:20` |
| TRC-ADM-03 | INTEGRATION_GAP | Lane D | Payments UI reads cash KPIs from Reporting (/admin/finance/cash, not routed) while the routed Billing-owned admin.billi… | `apps/admin-web/src/api/kpis.ts:129` |
| TRC-ADM-04 | TEST_EVIDENCE_GAP | Lane D | Admin visual-parity evidence exists only on a dirty candidate tree (9d5307e) with diffRatio up to 0.70 and no acceptanc… | `docs/production/D/evidence/p03-d-candidate-browser.json:1` |
| TRC-ADM-05 | DESIGN_PENDING | Design owner | Undeclared behaviour changes vs reference: toast 4000 ms (reference 2000 ms) and global search repurposed to booking-re… | `apps/admin-web/src/ui/shell.ts:153` |
| TRC-ADM-06 | CONTRACT_GAP | Lane E | Subscription enforces subscription.manage, which is not in IDENTITY_PERMISSIONS, so no role (not even super-admin) can … | `services/subscription/src/application/request-support.ts:11` |
| TRC-ADM-07 | CODE_GAP | Lane A | Customer and Vehicle expose only self routes; there is no staff read of customer profiles/vehicles/history for the cust… | `services/customer/src/transport/http/customer.controller.ts:117` |
| TRC-ADM-08 | OWNER_DECISION | Product owner | Live-location authority and event contract for the live map are not assigned to any owner in the service catalog. | `docs/parallel/D/W01/ADMIN_SURFACE_MATRIX.md:51` |
| TRC-ADM-09 | CODE_GAP | Lane D | reviews.v1 (moderation routes) is published in packages/contracts but services/reviews is a foundation shell with no HT… | `services/reviews/src/transport/http/create-app.ts:6` |
| D2 | CONTRACT_GAP | Lane C | Booking technician-view lines carry no service/add-on display titles (catalog snapshot); operator-web shows generic lab… | `docs/production/C/contract-requests/CR-P03-C5-operator-gateway.md:83` |
| D7 | INTEGRATION_GAP | Lane A | No Geo distance/ETA source for the technician route phase (TI-D11); illustrative numbers were removed from operator-web. | `docs/production/C/contract-requests/CR-P03-C5-operator-gateway.md:84` |
| D8 | CONTRACT_GAP | Lane C | No displayName for the signed-in operator from Workforce/Identity; operator-web shows no technician name meanwhile. | `docs/production/C/contract-requests/CR-P03-C5-operator-gateway.md:85` |
| D9 | CONTRACT_GAP | Lane B | No purpose-limited Billing projection of payment status for technicians; wallet payments are never shown as verified me… | `docs/production/C/contract-requests/CR-P03-C5-operator-gateway.md:86` |
| D10 | CONTRACT_GAP | Lane C | Booking technician-view is not readable for a live OFFERED offer, so the approved assigned screen cannot show car/servi… | `docs/production/C/contract-requests/CR-P03-C5-operator-gateway.md:87` |
| DEV-01 | OWNER_DECISION | Product owner | Reference handles defer at accepted stage as a local close; production maps assigned→decline and accepted→release. Owne… | `docs/production/C/P03-C5-operator-web.md:145` |
| DEV-02 | OWNER_DECISION | Product owner | Dispatch records the cash outcome inside close, so the reference "cash recorded, not yet closed" state is no longer rea… | `docs/production/C/P03-C5-operator-web.md:147` |
| DEV-03 | OWNER_DECISION | Product owner | Notification dot shows only server-known unclosed tasks; reference notifications list semantics differ. Owner decision … | `docs/production/C/P03-C5-operator-web.md:149` |
| CR-P05-C2-field-obstacle-and-receipts | CONTRACT_GAP | Lane C | Technician field-obstacle (help) cases and cash-receipt history need Support/Billing/Gateway contracts that are not pub… | `docs/production/C/contract-requests/CR-P05-C2-field-obstacle-and-receipts.md:1` |
| TRC-X-01 | DOC_DRIFT | Lane E | service-catalog.json and implementation-status.json (asOf 69d81a8, 2026-10-05) still record all business services as pl… | `architecture/implementation-status.json:5` |
| TRC-X-02 | TEST_EVIDENCE_GAP | Lane E | No acceptance evidence is bound to a84b5ee (tree a7faa67): every release-barrier family is NOT_RUN on this base and the… | `architecture/release-barrier.json:1` |
| TRC-X-03 | CONTRACT_GAP | Lane E | Only Identity and the Gateway import @carwash/contracts; services and apps hand-copy enums/DTOs that diverge (payment m… | `packages/contracts/src/common/payment-method.ts:8` |

## Required owner decisions

No business-policy decision is recorded as DECIDED. Topics below are required before the dependent rows can leave BLOCKED_DECISION.

| Topic | Status | Owner | Question | Existing IDs |
|---|---|---|---|---|
| market | OPEN | Product owner | Which launch market(s)/city (Aleppo?), service zones, hours, timezone and localization (Arabic/English) are approved for launch? | B-13, DEC-D-04, DEC-D-18, TI-D04, A-P01-12, A-P02-G1, CR-D-P05-D5-08 |
| operatingModel | OPEN | Product owner | Are technicians company employees, contractors, provider businesses or a phased mix; who owns fleet/equipment; individual vs team; who contracts with… | DEC-D-01, DEC-D-02, B-13, TI-D02, P05-C-D1 |
| currencies | OPEN | Finance owner | Settlement/display currency per market, minor-unit exponent, max amount, tax inclusion, exchange policy; is a second currency accepted or reporting-o… | B-03, DEC-D-04, B-P02-08, CR-D-P05-D5-08, TI-D04 |
| pricing | OPEN | Finance owner | Real package/add-on rates per vehicle category, zone/travel fees, tax/invoice treatment, rounding order; quote TTL, price-change honouring and revoca… | B-04, B-05, B-10, B-P05-24, DEC-D-15, CR-B-P06-06 |
| cancellations | PARTIAL | Product owner | Cancellation windows/cutoffs and fees, no-show and completed-work rules, reschedule limits, late payment after cancellation, technician no-show handl… | P04-C-OD1, P04-C-D1, P04-C-D2, B-06, DEC-D-05 |
| refunds | OPEN | Finance owner | Who approves full/partial refunds, limits, cash vs wallet/provider destination, reason codes/fees, dual-approval separation, unknown-outcome handling… | B-06, DEC-D-05, B-P04-05, B-P04-06, B-P02-08 |
| subscriptions | OPEN | Product owner | Customer wash plans, prices, entitlement units/expiry/rollover, reserve/consume trigger, freeze/cancel/renewal/refund, restoration on partial cancell… | B-09, B-P05-14, B-P05-15, B-P05-16, E06-B03, CR-E-P05-05 |
| cashCustody | PARTIAL | Finance owner | Custody holder (individual technician, team or both), treasury recipient identity, handover frequency/thresholds, shortage/overage resolution, post-d… | B-07, B-08, DEC-D-03, B-P03-05, B-P05-35, TI-D09 |
| retention | OPEN | Product owner | Retention durations/start points/deletion method per data class (identity, audit, media, location, conversations, receipts, idempotency, backups), le… | B-12, B-05, DEC-D-06, DEC-D-07, DEC-D-14, DEC-D-15, E06-B10 |
| merchantOnboarding | OPEN | Finance owner | Merchant agreements/account IDs, official verification/notification/refund API docs and sandbox for Sham Cash and Syriatel Cash; is Paymera in launch… | B-02, B-11, DEC-D-08, B-P02-07, B-P04-01 |
| hosting | OPEN | Operations | Production target (cloud/account/cluster, region/data residency, DNS, TLS authority, DB/broker endpoints), secrets store, backup RPO/RTO, operating w… | DEC-D-16 |
| adminGrantsMfaBootstrap | OPEN | Product owner | Operation-level admin grants by market/team, invitation authority, MFA/step-up, dual approvals, offline first-super-admin bootstrap and last-admin re… | DEC-D-09, DEC-D-10, B-P06-08, CR-D-P05-D5-10 |
| configurationGovernance | PARTIAL | Product owner | Who drafts/approves/publishes each config namespace; scheduled vs immediate activation; rollback; who owns the lateness field. | DEC-D-11, CR-D-P05-D5-09 |
| communicationsChannels | OPEN | Product owner | Initial channels (in-app/email/SMS/push/WhatsApp), providers, sender, consent, delivery-status policy. | DEC-D-12, E06-B12, DEC-D-07 |
| reviewsModeration | OPEN | Product owner | Review eligibility, edit window, attribution, public fields, moderation/appeal, retention. | DEC-D-13, CR-E-P05-02 |
| vehicleOwnershipAndDedup | PARTIAL | Product owner | Accept principal-keyed vehicle ownership (A2-D1) and decide garage deduplication by plate (A2-D2). | A2-D1, A2-D2, A-P01-10, A-P01-11 |
| technicianExecutionPolicy | OPEN | Product owner | When may work start with a pending electronic payment; reassignment request UX; before/after photo count/angles/consent; checklist per service. | TI-D05, TI-D06, TI-D07, TI-D08 |
| missingDesignsAndEnglish | PARTIAL | Design owner | Approve English/LTR designs, missing production states (loading/offline/error/permission), admin full-screen provenance, technician login/onboarding,… | TI-D01, TI-D02, TI-D03, DEC-D-18, B-14, P05-C-D1, B-P04-06, B-P05-16, B-P05-25, B-P05-34 |
| guestIdentityAndAccountClaim | OPEN | Product owner | Guest capability expiry/revocation, account claim/transfer, guest Booking event contract. | B-15 |
| releaseGovernance | OPEN | Repository administrator | Accepted base/registry and independent review; branch protection/required checks; time-bounded production authorization with live-money scope. | DEC-D-17, B-01, E06-B13 |

Out of scope without approval: Paymera, customer stored value and an Advertiser role. The scope scan found no code introducing them; Wallet stays a custody-only projection (guard `services/wallet/src/domain/custody.ts`). The checker rejects these terms in requirement titles and roles.

## Remaining work, dependencies and merge sequence (base `a84b5ee`)

Rebase each item on the then-current main; a step may start only when every dependsOn step is merged. No item is accepted by merging; exact-RC acceptance happens in the last step.

### M1 — contracts

- P02-E1 booking.v1 publication (rebase; drop the superseded billing.v1 part)
- P05-E2 identity/privacy contracts (commit first)
- P02-E2 workload identity / P02-E3 gateway route contracts (commit, rebase from 566d2e7)
- Owner decisions needed: retention (privacy erasure semantics); guest identity / account claim

### M2 — owner services - finance (Lane B) (after M1)

- P04-B1 follow-up (as a new migration, not an edit of the applied one; then B-P04-07 CONTRACT phase)
- P06-B7 refund conformance (fold into or rebase on the P04-B1 follow-up)
- P07-B1 outbox fencing
- P08-B1 reconciliation / P08-B2 outbox relay (commit; reconcile with P07-B1)
- P06-B3: reconcile with merged #134 or drop
- Owner decisions needed: refunds policy; cashCustody B-08 (dated owner answer); currencies B-03; merchant onboarding

### M3 — owner services - customer (Lane A) (after M2)

- P05-A1 customer.v1 conformance + privacy (keep one copy of the conformance commit; drop P02-A1, dedupe P07-A3)
- P07-A2 vehicle/geo recovery tests
- P07-A3 recovery tests (rebased)
- Owner decisions needed: retention; vehicle ownership/dedup

### M4 — owner services - operations (Lanes C/D) (after M3)

- P07-C1 restore fencing, P07-C2 media durability (commit first)
- P05-D1 support, P05-D2 reviews, P05-D3 communications, P05-D4 reporting
- P07-D1 configuration, P07-D2 security faults (commit first)
- Owner decisions needed: reviews moderation; communication channels/consent; configuration governance; retention (reports/CSV, media)

### M5 — gateway (after M4)

- Gateway admin routes (/admin/operations/*, /admin/finance/cash, /admin/assignments*, /admin/notifications, /admin/bookings/:id) from P03/P04_CANDIDATE_GATEWAY.patch, implemented by Lane E (CR-D-P02-01, CR-D-P03-02/06/08, CR-D-P04-04)
- Customer gateway vehicle/address/geo/booking/payment routes (P02-E3, P07-A requests)
- Owner decisions needed: admin grants / MFA bootstrap

### M6 — apps (after M5)

- P04-D2 admin exception-case console, then P05-D6 admin-web
- P06-C1 operator-web
- P07-A1 customer-web local state
- P03-A2 Orders screen, P04-A1 payment screen, P06-A1 production boundary (each needs reference/candidate/diff screenshots per DESIGN_LOCK section 8)
- P04-A2 / P05-A2 docs
- Owner decisions needed: cancellation fee/cutoff (P04-C-OD1) for the customer change UI; missing admin/operator/English designs (DESIGN_PENDING); payment methods / merchant onboarding for the electronic payment UI

### M7 — acceptance / release (after M6)

- Integration candidate tests (P04-C, P05-C real-services, P03-C journeys, P03-E2 slice harness) re-pointed at the new candidate
- P06-E1 scope registry
- P08-C1 / P08-D1 exact-RC harnesses
- P08-E barrier rerun on a new RC (every family is NOT_RUN on a84b5ee)
- Owner decisions needed: hosting / infrastructure target; secrets custody; incident contacts / operating window; production authorization; Repository administrator: branch protection + required checks (main unprotected)

Unmerged branches with unique patches (heads observed at the base):

| Branch | Head | Lane | State | Note |
|---|---|---|---|---|
| `prod/p02-e-integrate-p02-contracts--gateway-routes-and-cross-servi-e1-contracts` | 1ea9289 | E | UNMERGED_PARTLY_SUPERSEDED | Rebase it and drop the billing.v1 part in favour of #120. |
| `prod/p04-b-implement-production-grade-payment-provider-adapters--r-b1` | f99c25d | B | POST_MERGE_FOLLOWUP_UNMERGED | Edits the already-merged migration 20261010100000_p04b_provider_credits_refunds; must become a new migration.… |
| `prod/p07-b-finance-concurrency--provider-recovery-and-ledger-harde-b1` | 7a0874a | B | UNMERGED | Billing outbox fencing: lease_token, publish_seq, dead_reason, replay receipts (migration 20261011100000_p07b… |
| `prod/p06-b-close-commerce-finance-functional-matrix-and-admin-fina-b3-wallet-custody` | 8bb3034 | B | COMPETING_WITH_MERGED | Technician custody read projection from billing.v1 events (P06-B3). Main already has a different Wallet custo… |
| `prod/p05-a-complete-customer-account--garage--addresses--rebook--s-a1-customer-account` | 7207291 | A | UNMERGED | Customer provider conforms to the published customer.v1 (cherry-pick of the P02-A1 commit, never merged befor… |
| `prod/p02-a-connect-customer-booking-steps-to-real-customer-catalog-a1-customer-v1` | 8125698 | A | SUBSUMED | The customer.v1 conformance commit; also carried by P05-A1 and P07-A3. |
| `prod/p05-a-complete-customer-account--garage--addresses--rebook--s-a2-contract-requests` | dcb8352 | A | UNMERGED_DOCS | P05-A contract requests, owner decisions and parent status (docs). |
| `prod/p04-a-implement-electronic-payment-ux--cancellation-and-resch-a2-contract-requests` | a0fafc5 | A | UNMERGED_DOCS | P04-A contract requests, owner decisions and status (docs). |
| `prod/p03-a-implement-durable-orders--tracking-and-cash-booking-con-a2-orders-screen` | d84418c | A | UNMERGED_STALE | Needs reference/candidate/diff screenshots before merge. |
| `prod/p07-a-customer-device--network-and-recovery-hardening-a1-local-state` | 1035384 | A | UNMERGED | customer-web fixes for late location, stale vehicle edit and nonfinite position, plus browser test stabilisat… |
| `prod/p07-a-customer-device--network-and-recovery-hardening-a2-server-recovery` | f937e6b | A | UNMERGED | Vehicle/geo real-network recovery and coordinate hardening tests. |
| `prod/p07-a-customer-device--network-and-recovery-hardening-a3-customer-v1` | 325fa28 | A | UNMERGED | customer.v1 conformance (duplicate of the P02-A1 commit) plus customer.v1 real-network recovery tests. |
| `prod/p05-d-implement-support--reviews--notifications--reports-and-d1-support` | 6d148a4 | D | UNMERGED | Support customer cases, conversation, evidence, remedies and outbox relay store (P05-D1). |
| `prod/p05-d-implement-support--reviews--notifications--reports-and-d2-reviews` | 4385938 | D | UNMERGED | Reviews: eligibility, submission, moderation, read models and outbox (P05-D2). |
| `prod/p05-d-implement-support--reviews--notifications--reports-and-d3-communications` | 3d0b593 | D | UNMERGED | Communications: template registry, customer notification centre and delivery summary (P05-D3). |
| `prod/p05-d-implement-support--reviews--notifications--reports-and-d4-reporting` | eab62cf | D | UNMERGED | Revenue and operations reports with audited CSV exports (P05-D4). |
| `prod/p04-d-implement-admin-payment-verification--mismatch--refunds-d2-admin-web` | c7d4942 | D | UNMERGED | admin-web exception-case console for payments and bookings (P04-D2), with browser journeys and a11y fixes. No… |
| `prod/p05-d-implement-support--reviews--notifications--reports-and-d6-admin-web` | 60357d8 | D | UNMERGED | Carries the P04-D2 admin-web commits (rebased) for the P05 admin screens. |
| `prod/p08-d-issue-admin-support-reporting-exact-rc-acceptance-d1-rc-harness` | 03de304 | D | UNMERGED_HARNESS | Exact-RC admin/support/reporting acceptance harness (P08-D1). No RC exists. |
| `prod/p03-d-implement-admin-live-operations-and-cash-finance-operat-d3-admin-web` | 343038a | D | SUPERSEDED | Merged as #119 (c65db70). Patch ids changed after a rebase; only 3 files still differ from main (admin-web in… |
| `prod/p02-d2-admin-operations-console` | b378117 | D | SUPERSEDED | WIP P02-D2 console; contained in P03-D3 (#119). |
| `prod/p01-c2-workforce-provider` | b9085e2 | C | SUPERSEDED | Paused WIP; the Workforce provider merged through #102. |
| `integration/p02-c-merge-candidate` | 7e59f04 | C | CANDIDATE_TEST_ONLY | P02-C cross-service integration test on the merge candidate. |
| `integration/p03-c-merge-candidate` | ff307d3 | C | CANDIDATE_TEST_ONLY | P03-C real cross-service journeys (older version of -2). |
| `integration/p03-c-merge-candidate-2` | 121a1f3 | C | CANDIDATE_TEST_ONLY | P03-C real cross-service journeys (API + technician app). |
| `integration/p04-c-merge-candidate` | 86ebf09 | C | CANDIDATE_TEST_ONLY | tests/production/C/p04c-real-services.test.mjs (614 lines), not on main. |
| `integration/p05-c-merge-candidate` | cca5019 | C | CANDIDATE_TEST_ONLY | p05c-real-services test and P05-C3 doc, not on main. |
| `prod/p03-e-certify-the-first-real-three-app-cash-vertical-slice-e2-slice-harness` | 6194909 | E | UNMERGED_HARNESS | Real-infra certification harness for the P03 cash slice, plus its method and blocker register. |
| `prod/p06-e-run-full-scope-contract-and-three-app-barrier-e1-scope-registry` | be01edb | E | UNMERGED | Full-scope registry and three-app barrier (P06-E1). |

Uncommitted lane worktrees (no commits, not pushed): `carwash-p04a`, `carwash-p06a1`, `carwash-p05e2`, `cw-p02e2`, `cw-p02e3`, `carwash-p06b7`, `carwash-p08b1`, `carwash-p08b2`, `carwash-p06c`, `carwash-p07c-base`, `carwash-p07c2`, `carwash-p08c1`, `cw-p07d1-configuration`, `cw-p07d2-comms-reporting`. They are listed so that no merge plan assumes their content exists.

## CLOSE sprint map (base `a84b5ee`)

Each CLOSE sprint continues its original work IDs; merged or accepted work is recorded and not rebuilt. Every requirement row is mapped by at least one sprint. Only file 01 (P06-CLOSE-01) was supplied; later CLOSE files are mapped by lane (P06-A..E) until their numbered files are supplied.

| Sprint | Lane | Continues original work | Rows | Live blockers | Key blockers | Merge steps | State on base |
|---|---|---|---|---|---|---|---|
| P06-CLOSE-01 Baseline, scope/design traceability matrix and owner decisions | Lane E | W07-E FULL_SCOPE_MATRIX, P06-B5 finance matrix (#133), P08-E1 release barrier (#131), P09 traceability reconcile (5ef85ed, local), F010 reference pins | 26 | 33 | TRC-X-01, TRC-X-02, TRC-X-03 | — | This change. Carries the unpushed P09 reconcile commit 5ef85ed unchanged and adds this sprint map; no code. |
| P06-A Close all production customer scope and remove demo simulation | Lane A | C001-C014 customer port, P01-A1..A3, P02-A1..A3, P03-A2, P04-A1..A2, P05-A1..A2, P07-A1..A3 | 45 | 42 | TRC-CUS-02, TRC-CUS-03, TRC-CUS-04, TRC-CUS-14 | M3, M6 | Nothing merged. A1 production boundary is uncommitted in carwash-p06a1 (22 files on stale base 3e1ab23); needs rebase plus reference/candidate/diff screenshots (DESIGN_LOCK section 8). |
| P06-B Close commerce/finance functional matrix and admin finance | Lane B | P01-B1, P01-B2, P02-B1, P03-B1, P04-B1, P05-B1..B3, P07-B1, P08-B1..B2 | 15 | 34 | TRC-TEC-03, TRC-CUS-11 | M2 | B1 #135, B2 #142, B4 #136, B5 #133, B6 #144 merged (recorded complete, not rebuilt). B3 8bb3034 competes with merged #134; B7 refund conformance uncommitted in carwash-p06b7. |
| P06-C Close full technician prototype scope with real services | Lane C | P02-C1..C3, P03-C1..C6, P04-C1..C3, P05-C1..C2, P07-C1..C2, P08-C1 | 46 | 45 | TRC-TEC-01, TRC-TEC-02, TRC-TEC-05, TRC-TEC-06, TI-D05 | M4, M6 | Nothing merged. C1 operator-web is uncommitted in carwash-p06c (11 files incl. technician crosswalk and closure doc, base 66aa752). |
| P06-D Admin capabilities on owner services | Lane D | P01-D1..D3, P02-D1..D2, P03-D1..D3, P04-D1..D2, P05-D1..D6, P07-D1..D2, P08-D1 | 41 | 58 | TRC-ADM-02, TRC-ADM-03, TRC-ADM-04, TRC-ADM-09 | M4, M5, M6 | No P06-D writes (owner decision 2026-10-11: wait for P05 merges). P05-D1..D4, D6 and P04-D2 remain unmerged. |
| P06-E Full-scope contract and three-app barrier | Lane E | F001-F010, P01-E1..E3, P02-E1..E3, P03-E2, P04-E1..E4, P05-E1..E2, P07-E1..E4, P08-E1..E2 | 16 | 32 | TRC-X-01, TRC-X-02, TRC-X-03, TRC-TEC-01, TRC-ADM-06 | M1, M5, M7 | E1 scope registry/three-app barrier be01edb (2026-10-11) unmerged; P08-E barrier last NO_GO on 3e1ab23, every family NOT_RUN on a84b5ee. |

Row ids per sprint are in `traceability-matrix.json` under `closeSprints.sprints[].rows`; rows can belong to more than one sprint (for example Lane B finance rows on technician or admin screens).

## Release barrier

Last evaluation: **NO_GO** on `3e1ab23` (2026-10-10; recorded in 59eae8e 2026-10-11). On the base every family is NOT_RUN. External inputs still missing: production authorization, infrastructure target, secrets, merchant onboarding, incident contacts, operating-window policy and branch protection.

## Verification performed

- `node scripts/check-design-reference.mjs` and `node --test tests/design/reference-lock.test.mjs` passed before and after this change (no reference, manifest or baseline modified).
- `node scripts/production/E/traceability-matrix.mjs` PASSED on this tree; `tests/production/E/traceability-matrix.test.mjs` covers each drift class.
- The checker also fails when a row is not mapped to a CLOSE sprint, or when a sprint names an unknown row, blocker or merge step, or a stale live-blocker count.
- Scope: static source/document traceability. No database, broker, browser, provider or production evidence was produced or claimed.
