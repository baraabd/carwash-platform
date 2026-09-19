# ADR 0004 — Approved UI takes precedence over architecture shorthand

Status: recorded from the owner's explicit instruction to preserve the approved design.

The supplied plan describes six conceptual booking stages at its opening. The approved
payments prototype has seven actual screens: vehicle, care, place, time, contact, payment, review.
The plan explicitly states that it does not replace the carwash UI. Therefore the seven-screen
prototype is the customer-journey authority; the architecture text remains the backend authority.
No modification is made to the uploaded plan to hide this distinction.

React, Tailwind, Radix and Lucide are implementation options, not permission to substitute
new component visuals for the existing CSS/SVG artwork. Preserve originals during extraction.
Store final approved files with hashes, never reinterpret screenshots as a replacement implementation.

Prototype-local persistence and payment simulation are not production requirements.
Keep their UX shape while moving real state to the appropriate server service. Hide/remove
unsecured designer simulation controls from production; retain the unchanged prototype as reference.
Actual money flow stays disabled until merchant setup and provider verification are established.
Any user-facing addition/removal beyond this safety boundary requires explicit owner approval.

Admin and operator shells in the foundation are not implemented screens. Their future full designs
require separate acceptance; using shared tokens does not establish previous approval.
