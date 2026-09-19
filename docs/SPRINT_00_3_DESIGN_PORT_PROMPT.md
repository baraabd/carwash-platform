# Next UI implementation slice — exact port, not redesign

Read AGENTS.md, CLAUDE.md, docs/design/DESIGN_LOCK.md and ADR0004.
Read all CSS/SVG/JS in the frozen payments HTML. Do not infer it from a screenshot.

1. Establish the dependency lock/build foundation in Sprint0.2 first. Do not claim it is done.
2. Inventory screens, state transitions, tokens, icons and animation values from the HTML.
3. Build the React shell with unchanged appearance. Keep prototype separate and immutable.
4. Port one screen at a time with deterministic reference/candidate comparisons.
5. Preserve all seven steps, footer, drawers, validation, repeat flow and all payment states.
6. Server integration is a later tested boundary: quoteId, capacity, identity, order and payment
   states are server facts. No mock payment may be displayed as verified production money.
7. Finish each slice with tests and reviewed visual artifacts. Never overwrite the reference.
8. Stop on unapproved visual scope changes and record the decision needed; continue non-conflicting work.

The working admin/operator apps and live financial integrations are not part of this bootstrap.
