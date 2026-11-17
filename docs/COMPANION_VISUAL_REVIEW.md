# Companion styling review — 13 November 2026

Implemented the eight-step styling plan across the shared CSS and app header. The dropdown
and inspector controllers retain their existing behaviour. This sheet compares logical pixels;
native Figma screenshots use a 2× display scale. Companion measurements are estimates from
the supplied images and the previous live inspection, not an official specification.

| Area                    | Before                 | Implemented                                                         | Reference alignment                                        |
| ----------------------- | ---------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| Internal brand + source | 40 + 62 px             | 49 px source; no extra main-view brand band                         | Native Figma title carries identity; repository is primary |
| Navigation              | 36 px                  | 33 px measured                                                      | Blueprint-specific views retained                          |
| Toolbar                 | 49 px                  | 49 px                                                               | Rounded collection selector, neutral Changes/All track     |
| Table type              | 11 px; 10 px aliases   | 12 px names, values, headings and aliases                           | Readable monospace with 24 px outlined alias chips         |
| Columns                 | 176 px + 124 px modes  | 208 px + minimum 156 px modes                                       | Horizontal scroll preserves type size                      |
| New rows                | Muted mixed green      | Pale name fill, stronger value fill, dark green text and green rail | Closer to the supplied light reference                     |
| Swatches                | 14 px                  | 16 px                                                               | Circular, with alpha checkerboard                          |
| Floating surfaces       | Separate shadows/radii | Shared 8 px radius and shadow                                       | Menu checks, inline dots/counts, inspector hierarchy       |
| Footer                  | 75 px                  | 69 px                                                               | 32 px outlined controls and 11 px status line              |

The header saves 56 px and the footer saves 6 px in the 440 × 720 browser frame. The browser-only
preview banner is separate from the product layout. Connection/settings retain their compact
internal heading band. At 360 px Watch uses its labelled icon to keep the sync label at 12 px.

## Review captures

- [440 px light variables](interface-preview.png), [collection dropdown](dropdown-preview.png),
  and [value inspector](value-inspector.png).
- [620 px multi-mode layout](styling-wide.png): both modes fit in the available width.
- [360 px dark stress layout](interface-preview-stress.png) and
  [long-string inspector](value-inspector-dark.png): the table scrolls independently and the footer fits.
- [Settings](styling-settings.png) and [native Figma preview](styling-figma.png).

## Verification and deliberate differences

- Browser checks cover collection choice, Escape dismissal, settings access/cancellation,
  issue routing to Review, and the multi-mode inspector. The 5,000-token/six-mode fixture
  remains bounded; at 360 px, body and toolbar/footer scroll widths equal their client widths.
- Opened the locally registered Blueprint development plugin in Figma and loaded its sample
  preview. Verified the native title/source relationship and actual dark Figma theme variables.
  Verified collection selection with Down/Enter, inspector opening and mode paging, and
  Escape returning focus after keyboard interaction. The native preview includes existing
  unchanged and updated output, in addition to the browser's new-output fixture.
- No Sync action was used. This visual acceptance does not replace provider, credential,
  mutation, cancellation, or auto-sync release acceptance in TESTING.md.
- Updated/conflicting/skipped rows retain distinct blue/red/amber semantic colours; green
  represents new output. Source and resolved-value context remain in the inspector. Blueprint
  retains Variables/Styles/Review, inclusion controls and repository actions.
- Companion's dark appearance was not measured: Blueprint dark mode is an adaptation using
  native Figma surfaces plus explicit readable green fills. The cross-collection change strip
  remains the deferred UX enhancement identified in the plan.
- All 86 automated tests, formatting, strict typechecking and production bundling passed.
