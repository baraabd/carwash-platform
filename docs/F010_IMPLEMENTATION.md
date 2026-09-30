# F010 — Golden HTML parity harness

## Deliverable

F010 registers the approved customer, technician and admin HTML prototypes without changing their bytes and supplies deterministic browser tooling for future React parity work.

The harness controls Chromium, locale, timezone, viewport, DPR, reduced motion and time/randomness inputs. CI captures all three references at six canonical widths: 18 deterministic reference captures per run.

## Acceptance

- three registered hashes and byte lengths must match;
- the legacy customer frozen reference must still match its older manifest;
- no horizontal overflow at canonical widths;
- Arabic/RTL root attributes remain intact;
- a keyboard focus target must be reachable;
- no uncaught page errors or external network requests are allowed;
- Axe serious/critical WCAG A/AA findings block the run;
- two captures of the same state must have zero changed pixels;
- an intentional visual mutation must be detected by the same comparator;
- font file names and SHA-256 values are recorded, never font binaries;
- future trusted-base runs compare the registered manifest and reference bytes with the base commit.

This is a harness acceptance only. It does not state that the future React customer, technician or admin applications already match these files.
