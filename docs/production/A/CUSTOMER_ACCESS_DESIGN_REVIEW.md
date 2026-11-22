# Customer guest entry and recovery — design decision pending

The current candidate implements real guest creation, session recovery and
profile/garage/address persistence. The exact `8fcae7e` customer browser CI
journey passed against real Identity, Customer, Vehicle, Redis and PostgreSQL.
That is functional evidence; it does not approve a new visible design.

The approved customer HTML has a profile sheet but no guest entry, one-time
recovery receipt, recovery form or session termination controls. The candidate
reuses the existing sheet, input and button styles without changing reference
files. `AGENTS.md`, DESIGN_LOCK section 9 and ADR-0004 require an explicit owner
decision for these new controls and their Arabic copy.

## Concrete review material

The `a-customer-browser` family produces three 390px design previews:

| File | Visible decision |
| --- | --- |
| `guest-entry-390-candidate.png` | Guest entry explanation, continue button and recovery entry. |
| `guest-recovery-390-candidate.png` | Empty recovery field and return to new guest entry. |
| `guest-receipt-390-candidate.png` | One-time receipt explanation, a visibly synthetic placeholder, expiry/rotation explanation, acknowledgement and sign-out controls. |

The preview helper runs the actual production UI in a separate browser context
with explicit synthetic API responses. Every API request is intercepted and
fulfilled or rejected; none is forwarded to an owner. It has no owner cookies
or real recovery value. Its manifest states `acceptedDesign: false` and
`ownerJourneyEvidence: false`. Only these three exact filenames and that
manifest can enter the diagnostic artifact. A missing or non-synthetic manifest
prevents retention. Real-owner authentication tests remain uncaptured: no
screenshots, traces or storage snapshots are taken from their contexts.

Review concerns are the controls, wording and layout; these previews are not
new visual baselines, a substitute for the real-owner journey or permission to
change any other customer screen. The account's canonical profile fields and
the explanatory text about an unverified contact number also require review
where they differ from the demonstration wording.

## Acceptance boundary

Preserve all seven approved booking screens, current artwork and interaction
structure. The guest receipt remains memory-only until acknowledged; recovery
rotates it and revokes earlier sessions, as enforced by Identity. Choosing the
guest flow never implies account registration or phone verification.

Owner acceptance of this bounded design, and final exact-source functional CI,
are separate gates. The remaining production checkout, provider configuration
and release receipts are still tracked in the sprint inventory.
