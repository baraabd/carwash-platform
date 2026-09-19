# Carwash Platform — mandatory engineering and design rules

## Read before any change
1. `docs/design/DESIGN_LOCK.md`
2. `design/reference/approved/washgo-payments-interactive.html`
3. `docs/design/reference-manifest.json`
4. `docs/adr/0004-approved-ui-precedence.md`
5. `docs/ARCHITECTURE_AR.md`, `architecture/service-catalog.json`, `docs/VERIFICATION.md`

The owner explicitly requires the already-approved UI to remain unchanged.
This is implementation/migration work, NOT a redesign brief.
Preserve exact visuals, Arabic copy, seven separate booking screens, icons, SVG artwork,
spacing, motion, reduced-motion behavior, focus, price footer, bottom sheets,
plate preview, repeat booking, before/after and payment states.
Do not merge steps. Do not substitute framework defaults. Do not regenerate baselines.
The only canonical customer UI is the final payments reference, not older mockups.
Do not infer missing admin/operator/English screen designs; identify them as pending.
No planned feature, benchmark, historical test count or local success may be called production-ready.

Run `node scripts/check-design-reference.mjs` before and after edits.
Run `node --test tests/design/reference-lock.test.mjs` for guard changes in an owner-approved process.
For an actual UI port, provide deterministic reference/candidate/diff screenshots and flow tests.
Hash checks do NOT prove that a new frontend visually matches the reference.
Never update snapshots simply to make a failing comparison pass.
Never use a design requirement as a reason to leave a known security defect unfixed.
Document the conflict and get an explicit decision for visible changes.

# Carwash engineering rules

Read docs/ARCHITECTURE_AR.md, architecture/service-catalog.json and docs/VERIFICATION.md first.

- This is a new microservices project, not permission to modify the original repository.
- Each domain owns data, migrations, runtime identity, API/events and release artifact.
- Never import another service's implementation or Prisma client. No shared business database.
- Gateway and admin are not business-data owners.
- Share only versioned external contracts, technical libraries and UI primitives.
- No fabricated authentication, payment success, persisted saves or readiness.
- Payment, access, resource availability and booking state are independent server facts.
- Every distributed write needs an explicit failure/compensation and idempotency design.
- Financial confirmation and refunds require server-side verification and audit.
- Add schema mirrors and migrations together. No production db push/reset.
- Arabic/English and RTL/LTR, accessible focus, mobile interaction and low-bandwidth behavior are acceptance requirements.
- Use scope-specific tests. Never present domain tests as database, broker, browser or production evidence.
- Keep migration, contract compatibility, rollback, security and source-provenance evidence per final commit.
- Pin resolved dependency versions and commit lockfiles only after install/build/security checks.
- Foundation shells intentionally return 503 readiness until the actual service is implemented.

