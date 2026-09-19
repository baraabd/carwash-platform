# Customer web

Current executable: `prototype/index.html`, an exact copy of the approved final payments HTML.
Run from repository root: `node scripts/serve-prototype.mjs`, then open http://127.0.0.1:4173.
Or open the HTML directly. Do not enter real payment details.

This is the unchanged local prototype, not a React port or a backend-integrated application.
Planned React/Vite implementation must preserve docs/design/DESIGN_LOCK.md exactly.
Any production service integration must use server facts and remove designer-only controls
from production, while preserving the immutable reference itself.
