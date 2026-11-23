# P06 operator/admin contrast correction — PR #147 repair

Status: **implemented for the current PR repair; final-candidate CI required**.

The current owner instruction is to correct PR #147 accurately and merge it into
`develop`. This change implements the narrowly scoped accessibility fixes already
made concrete in this PR. It does not assert an earlier design approval, revise
any immutable reference, create a new golden baseline, or waive a WCAG finding.
No layout, wording, icon, navigation, interaction, motion or focus rule changes.

## Failure and retained evidence

The original operator candidate failed acceptance because its inherited serious
contrast findings were marked TODO. The admin bookings subtitle also failed
contrast. Both were defects in the original reference colour pairs, not reasons
to suppress accessibility assertions on the production apps.

The retained [operator artifact from the prior candidate](https://github.com/baraabd/carwash-platform/actions/runs/45007169491/artifacts/14748538372)
contains `diagnostics/operator-a11y/axe-summary.json`. All 14 recorded colour
previews (seven affected states at 390 and 1440 pixels) report
`geometryUnchanged: true` and `proposalViolations: []` on pinned Chromium
153.0.8010.12. This is historical proposal evidence, not acceptance of the current
source. The same precise selectors and colours are now shipped in separate
accessibility stylesheets.

## Exact production changes

`apps/operator-web/src/styles/04-accessibility.css` sets `#5f7264` instead of
`#65786a` on:

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

It sets `#617153` instead of `#859276` on
`#main > .stepper > .steps > li:not(.current)`, and `#5f6f51` instead of
`#708062` on `#main > .segmented > .segment[aria-pressed="false"]`.
The active step and selected filter retain their original distinct colours.

`apps/admin-web/src/accessibility.css` sets `#5f6f86` instead of `#64748b`
on `#bookings > .page-head > div > p` only.

### Calculated contrast

These values use the CSS sRGB colours and the WCAG relative-luminance formula.
They are calculations, not new browser measurements. Actual candidate axe checks
remain mandatory on the final commit.

| Text group | Background | Before | Corrected | Before ratio | Corrected ratio |
|---|---|---|---|---:|---:|
| Operator muted text on main/sheet surface | `#f6f8f2` | `#65786a` | `#5f7264` | 4.41265:1 | 4.81363:1 |
| Checked checklist description | `#f0f8e4` | `#65786a` | `#5f7264` | 4.32826:1 | 4.72157:1 |
| Inactive/completed step labels | `#f6f8f2` | `#859276` | `#617153` | 3.08105:1 | 4.91277:1 |
| Unselected filter label | `#eaf0e1` | `#708062` | `#5f6f51` | 3.64422:1 | 4.65300:1 |
| Admin bookings description | `#f4f7fb` | `#64748b` | `#5f6f86` | 4.42888:1 | 4.76147:1 |

[WCAG 2.2 SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
requires at least 4.5:1 for ordinary text; comparisons use unrounded values.

## Verification and honest visual comparison

- The original HTML, reference hashes and three extracted operator reference CSS
  files remain unchanged.
- Operator accessibility measures all 20 view/width combinations and now requires
  **zero serious or critical findings** on the actual candidate, including any
  inherited ones. No TODO or reference-debt waiver remains in this production suite.
- Raw reference and candidate screenshots remain separate. The visual suite's
  independently specified text-colour transformation applies only the exact
  selectors/colours above to a derived comparison document. It first checks each
  original colour, records before/after computed colours and rectangles, and
  requires unchanged background, typography, opacity and geometry. The candidate
  is only inspected; its styles are never replaced by the test.
- The six-width comparison retains its existing channel threshold and zero
  undeclared-pixel requirement. There is no new mask or regenerated snapshot.
  `contrastCorrection` in each capture records the declared colour difference;
  raw captures and raw difference ratios retain the original visual departure.
- Admin accessibility checks the actual corrected bundle; its raw reference,
  candidate and diff captures remain part of the existing V1 evidence. Finance
  workflow changes are documented separately and do not count as contrast repair.

Pinned Node builds and source checks can run locally. The executor cannot download
Chromium153 (HTTP403), and its installed Chromium156 cannot start because socket
creation is denied. No local browser success is claimed. Canonical browser,
keyboard/motion and six-width parity acceptance must pass on the final CI source.

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
deterministic alignment with the existing C3 fixture's visibility rule. That earlier fixture correction did not alter product/design approval. The
separate bounded contrast repair in this document supplies the colour correction. The previous candidate passed this fixture correction; the final-candidate CI must
repeat it. Local source checks are not browser acceptance.
