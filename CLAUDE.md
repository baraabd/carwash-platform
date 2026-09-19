# WashGo / carwash-platform

@AGENTS.md
@docs/design/DESIGN_LOCK.md
@docs/adr/0004-approved-ui-precedence.md

Read the files above and the immutable HTML reference BEFORE editing any UI.
The user requests exact preservation, not a newer-looking redesign.
The design checker is `node scripts/check-design-reference.mjs`.
Prototype: `node scripts/serve-prototype.mjs` (local-only, no production API).
Do not touch baraabd/homeservicemarketplace. Do not replace true microservices with a shared business DB.
Follow `.claude/rules/washgo-design-lock.md` for visual surfaces.
