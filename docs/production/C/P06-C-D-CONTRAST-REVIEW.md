# P06 operator/admin contrast correction — owner review candidate

Status: **proposed only; not applied to either application; not accepted**.

This is a bounded accessibility correction for current CI findings. It does not
authorize a redesign, change the approved HTML, expand a reference-debt allowance,
relax a screenshot threshold, or turn the existing TODO into a passing result.

## Observed failure and design reconciliation

The source `979d399780f8935382dab402a278ddf5685028ff` failed the canonical
[operator fixture job](https://github.com/baraabd/carwash-platform/actions/runs/44997840550/job/137132620290)
because its accessibility result contains one TODO for serious inherited contrast.
The original candidate's keyboard/motion tests passed. The seven affected views
at both 390 and 1440 px were tasks, completed tasks, collections, wash, electronic
payment handoff, closed task, and the cash sheet. The original results remain
required assertions in `tests/production/C/operator-web-a11y.test.mjs`.

The [admin browser job](https://github.com/baraabd/carwash-platform/actions/runs/44997840550/job/137132620119)
reported serious contrast on `#bookings > .page-head > div > p`. Its functional
failures are separate investigations and are not resolved by this proposal.

`AGENTS.md`, `docs/design/DESIGN_LOCK.md` §9 and ADR 0004 require an explicit
decision for a visible departure from the immutable design. The F010 debt
inventory explicitly says it is not a production WCAG waiver. These requirements
can be reconciled by reviewing the following exact text-colour changes, retaining
the original reference and recording the approved exception separately. They
cannot be reconciled by suppressing the finding or silently editing the reference.

## Exact proposal

All rules below are restricted to the selectors exported by
`tests/production/support/contrast-review.mjs`. No root token, geometry, text,
background, icon, motion, or focus rule is changed. A rule can match multiple
existing instances of the listed component in the measured view.

### Operator

Propose text colour `#5f7264` instead of the inherited `--muted: #65786a` on:

```css
.header-center > small
#main > .heading > div > p
#main > .stepper > .stepper-head > span
#main > .section-title > small
#main .check-button.checked > .grow > small
#main > .center > p.muted
#main .compare-caption > span
#main .compare-caption > .text-btn
#sheet .field-label > .muted
```

Propose `#617153` instead of `#859276` on:

```css
#main > .stepper > .steps > li:not(.current)
```

Propose `#5f6f51` instead of `#708062` on:

```css
#main > .segmented > .segment[aria-pressed="false"]
```

The active task step and selected filter retain their existing distinct colours.

### Admin

Propose `#5f6f86` instead of inherited `--muted: #64748b` on exactly:

```css
#bookings > .page-head > div > p
```

### Calculated contrast

These values are calculated from the current CSS sRGB colours with the WCAG
relative-luminance formula. They are a design calculation, **not a fresh browser
measurement**. Actual rendered backgrounds, all affected states, and the absence
of new findings must still be checked by the CI captures and axe results.

| Text group | CSS background | Before | Proposal | Before ratio | Proposed ratio |
|---|---|---|---|---:|---:|
| Operator muted text on main/sheet surface | `#f6f8f2` | `#65786a` | `#5f7264` | 4.41265:1 | 4.81363:1 |
| Operator checked checklist description | `#f0f8e4` | `#65786a` | `#5f7264` | 4.32826:1 | 4.72157:1 |
| Operator inactive/completed step labels | `#f6f8f2` | `#859276` | `#617153` | 3.08105:1 | 4.91277:1 |
| Operator unselected filter label | `#eaf0e1` | `#708062` | `#5f6f51` | 3.64422:1 | 4.65300:1 |
| Admin bookings description | `#f4f7fb` | `#64748b` | `#5f6f86` | 4.42888:1 | 4.76147:1 |

[WCAG 2.2 SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
requires at least 4.5:1 for ordinary text. Threshold comparisons must use the
unrounded result. The texts in this proposal are ordinary text, not a logo or an
inactive control; an unselected filter remains an operable control.

## Reviewable browser evidence

The existing suites now create **additional test-only previews**:

- Operator: every view with serious contrast gets an untouched reference capture,
  original candidate, colour proposal, proposal diff, original/proposed computed
  styles and rectangles, and a separate proposed axe result. Files are written to
  `.acceptance/production-C/operator-web/a11y/`; the full report is `axe-summary.json`.
- Admin: the bookings test retains its original axe result and separately writes
  `bookings-contrast-1440-candidate.png`,
  `bookings-contrast-1440-proposal-candidate.png`,
  `bookings-contrast-1440-proposal-diff.png`, and `contrastProposal` in its existing
  `browser-report.json`. Its original reference screenshots remain part of V1.
- The preview stylesheet is removed in `finally`. No app bundle imports it. Every
  required accessibility assertion and the existing visual parity checks continue
  to use the original candidate, so a proposed improvement cannot produce a false
  acceptance. Reports label the preview `UNAPPROVED_COLOR_PROPOSAL_ONLY` and record
  whether every matched element retained its geometry.
- Outer acceptance retains only the declared synthetic PNG and JSON diagnostics.
  It does not retain session state, cookies, HAR files or customer recovery data.

The next canonical CI run must supply these images before a visual decision is
requested. Local pinned Chromium153 could not be downloaded (HTTP403). An installed
Chromium156 binary was found, but its ordinary Playwright smoke launch was blocked
by the executor's socket restriction. No local browser acceptance or screenshots
are claimed, and no fallback was added to canonical launch configuration.

## Independent three-pixel visual failure and fixture correction

The retained Chromium `153.0.8010.12` evidence for source
`8c956a61c4a93a5772e6cb94967f4ac1cedee7a8` contains raw reference, declared
reference, candidate and diff images. It identifies the same three changed pixels
in `task-assigned-c3` at each of the six widths; every other scenario passed the
existing zero-difference requirement. At width 390 the pixels are:

| Position | Declared reference RGB | Candidate RGB |
| --- | --- | --- |
| (205, 64) | (236, 224, 195) | (246, 248, 242) |
| (206, 64) | (191, 200, 199) | (246, 248, 242) |
| (207, 64) | (214, 232, 233) | (246, 248, 242) |

The existing `.header-center small` mask records `y=52.84375, height=11` on
both pages. Its unchanged integer painting covers rows 52 through 63. Reference
area text paints these three pixels at row 64, outside the inline element's CSS
box. The candidate displays only `09:30`; the reference still displays
`المزة · 09:30` after PC-04 removes the prototype qualifier. This is the
already documented D10 unavailable-address difference, not an emoji or a general
header layout difference.

The source authority predates this repair: `P03-C5-operator-web.md` §3 records
D10, and `P03-C3-booking-technician-view.md` authorization matrix row 5 refuses
Booking details while Dispatch says `OFFERED`, including an offer to the caller.
`services/booking/src/application/technician-view.ts` enforces that rule before
reading Booking. Its real-owner regression is
`tests/production/C/booking-technician-view.test.mjs`. The operator therefore
correctly retains the Dispatch slot time without inventing a Booking area.

The visual fixture now applies one exact D10 reference operation **after PC-04**:
`المزة · 09:30` becomes `09:30`. It checks that exactly one raw reference subtitle
has the known original content, that the candidate independently contains only
the expected time, and that exactly one D10 operation produced the expected
reference subtitle. A changed time, extra header, unexpected markup, unremoved
area or unmatched source text fails the capture. It never copies arbitrary
candidate markup or colour into the reference.

The immutable reference bytes, raw capture, app styles, rendering contract,
comparison threshold, zero-difference assertion, mask selectors and mask painting
algorithm are unchanged. The selected subtitle's measured box becomes the
time-only box on both pages; no comparison area is newly excluded. This is
deterministic alignment with the existing C3 fixture's visibility rule. It grants
no new product/design approval and does not resolve the contrast or other pending
owner decisions above. The next canonical CI browser run must verify the corrected
six-width comparison; local source checks are not browser acceptance.

## Acceptance after an explicit visual decision

An approval must name these selectors/colours and this evidence record. If approved,
apply the rules in a separate production accessibility stylesheet, preserve the
byte-identical reference CSS and golden files, and declare only the approved colour
exception in parity tooling. Then run the original accessibility checks without a
TODO allowance, all six-width parity scenarios, keyboard/motion suites and design
guards on the exact final commit. Until that succeeds, the affected accessibility
and visual gates remain open blockers.
