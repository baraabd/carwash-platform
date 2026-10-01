# F010 — Golden reference provenance

Status: registered for parity harness construction. This file does not claim application or production readiness.

## Approved inputs

- Customer: `design/reference/approved/washgo-payments-interactive.html` — the already frozen WashGo customer reference.
- Technician: `design/reference/approved/washgo-technician-interactive.html` — the owner-approved technician prototype created on 2026-09-20.
- Admin: `design/reference/approved/washgo-admin-prototype.html` — the owner-approved admin prototype created on 2026-09-20.

The technician and admin bytes were imported unchanged from the user's persistent ChatGPT file library. Their registered SHA-256 values are stored in `f010-reference-manifest.json`.

## Scope

F010 freezes the source prototypes and proves that the parity harness is deterministic and fail-closed. It does not port the three applications to React. Customer, technician and admin implementation sprints consume these references later.

The older customer-only `reference-manifest.json` remains byte-identical. F010 uses a separate additive registry so the existing frozen baseline is not rewritten while registering the two later approved prototypes.

No font binary is committed. CI records only the names and SHA-256 hashes of the system font files that Chromium actually resolves on the controlled Linux runner.
