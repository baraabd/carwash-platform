# Future implementation acceptance — no invented pass status

The frozen HTML exists and is hash-checked. A React candidate does not yet exist here.
Consequently visual parity of a React implementation is NOT tested or claimed.

| Surface / state | Source | Acceptance to capture |
|---|---|---|
| Home and return/resume | Final payments HTML | Layout, CTA, stored draft/repeat without auto-booking |
| Vehicle | Final payments HTML | Cards, exact artwork, plate preview, saved vehicles |
| Care | Final payments HTML | Prices/durations, selection, additions drawer |
| Place | Final payments HTML | Address, map controls, permission denial, manual fallback |
| Time | Final payments HTML | Dates, slots, nearest, no stale repeat-booking slot |
| Contact | Final payments HTML | Fields, errors, focus, Arabic numerals |
| Payment choice | Final payments HTML | Three methods and no implicit confirmation |
| Review | Final payments HTML | Edit/return, fixed price, double-submit handling |
| Wallet QR | Final payments HTML | Both providers, zoom, copy/save, same-phone help |
| Proof/pending/mismatch | Final payments HTML | Proof is not payment, no second-transfer nudging |
| Tracking and cash | Final payments HTML | Service state independent of collection state |
| Completion | Final payments HTML | Before/after drag, animation/pause, rating, repeat |
| Saved vehicles/addresses/account | Final payments HTML | Existing controls and reduced motion |

Screen widths: 320/390/430/768/1024/1440 CSS px; height and DPR recorded per fixture.
Arabic RTL is frozen; English LTR requires separate reviewed translation/layout acceptance.
Use a fixed browser build, OS, fonts, locale, timezone, seed data and clock.
Do not compare a moving animated frame to a settled reference and silently increase tolerance.
Record visual, keyboard, screen-reader, error, offline, responsive and server-persistence evidence separately.
No auto-regeneration of approved baseline screenshots. No claim of global pixel equality across platforms.
