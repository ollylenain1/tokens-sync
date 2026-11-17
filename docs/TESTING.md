# Testing and acceptance

## Automated verification

Run `npm run check` for formatting, strict typechecking, tests and production bundling. `npm audit` checks dependency advisories. Tests use Node’s built-in test runner; no browser test server, test account or access token is required.

| Suite       | Outcomes covered                                                                                                                                                                                                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core        | Single/multi-file structures, legacy/DTCG parsing, inherited types, set precedence, source/disabled behaviour, missing/circular references, scalar conversions, all supported composite outputs, gradient geometry, disclosures, linked and theme-specific strategies                                                            |
| Providers   | GitHub and GitLab request routes, hosted/enterprise bases, nested namespaces and numeric project IDs, single-file siblings, pagination, commit pinning, GET-only transport, secret-safe errors, cooldown, truncation, file-size limits, concurrency, cache, cancellation                                                         |
| Sync        | No document mutation during preview, native output types, mode creation, repeated idempotent sync, ID/alias/metadata preservation, primitive propagation, removals, reliable renames, mapping conflicts, fonts, extensions, plan limits, stale previews, registry integrity, cancellation, 5,000-token event-loop responsiveness |
| Regressions | Potential-rename confirmation, Styles-only output, stale variable bindings, explicit skip, collection collisions, per-mode alias direction changes, bound effect removal, style-key mappings, unsupported-item counts and normalized-name collisions                                                                             |
| Controller  | Bundled plugin message flow, preview/sync separation, stale-preview rejection, session-only and opt-in credential storage, and disconnect cleanup                                                                                                                                                                                |

The shared preview model has coverage for ordered mode values, alpha colors, aliases, style summaries, theme labels, and independent collection scope/inclusion. Compiled UI interaction tests exercise search, inclusion changes, collection-conflict navigation, pending/failed previews, sync gating, settings cancellation, and aborting connection tests.
The value-inspector check passed all 86 tests, formatting, typechecking, and production bundling.

The compiled UI also has startup regression tests covering parent, relayed and null-source host messages, explicit host errors and a missing-response timeout. These exercise the iframe path independently of the standalone demo, which bypasses the Figma bridge.

The Figma mock implements the API shape used by the adapter, verifies that no deletion occurs and records IDs, values, bindings and writes. It does not render Figma geometry, enforce every native constraint or simulate authentication. A mock pass is not a claim that the plugin has passed real Figma acceptance.

## Browser review

Run `npm run preview` and visit `http://127.0.0.1:4174/?demo=1`. This uses the production UI and actual parser/converters/planner against an empty in-memory document. The banner labels it as a sample preview. Sync deliberately refuses to pretend it has written a Figma file.

The compact UI was visually reviewed on 12–13 November 2026 in the in-app browser: connection and
advanced settings, Variables/Styles/Review, two-mode values, alpha swatches, alias details,
search and focus retention, collection inclusion/exclusion, warning navigation, styles-only
conflicts, and watch settings. Light and dark previews and the 360 px layout were inspected.
The footer stays visible and horizontal overflow is contained in the value table.

The standalone preview accepts `?demo=1&theme=dark` and `?demo=1&width=360`. The small theme
button in its banner is a preview control; the plugin uses Figma's native theme colors.
`?demo=stress` generates 5,000 tokens in six modes for layout/performance review. At 440 × 720,
it displayed 11 full rows, rendered 60 initially and 120 after Show more, and could search for
the final token. Long strings remain readable in expanded row details. This browser exercise
checks rendering and interaction, not live Figma write performance.

Screenshots: [variables](interface-preview.png), [dark variables](interface-preview-dark.png),
and [connection](interface-preview-connection.png). The browser preview and the live controller
now use the same typed preview serializer. The automated controller tests exercise its message
flow with the Figma mock; real Figma rendering, credentials, watch/auto-apply, and cancellation
still require the live checklist below.

## Live release checklist — partially executed; see release status

Use an isolated, editable Figma file and a test repository. Keep real PATs out of fixtures, screenshots and issue reports.

1. Import the development manifest; verify that both plugin entry points load without console errors.
2. Connect to a public GitHub repo with the single-file fixture, then a private repo using a fine-grained Contents: read token. Test an expired token and an SSO-restricted repository.
3. Connect GitLab with a project `read_api` token using both project ID and nested namespace. Test a multi-file directory with more than one tree page. Repeat for the organisation’s actual enterprise hosts, VPN and CORS policy.
4. Fetch. Verify that **no Figma variable, collection, mode or style** is created or changed before Sync.
5. Sync the sample. Verify Foundations/Default and Interface/Light/Dark. Inspect native variable types and cross-collection aliases, text styles, ordered inner/drop shadows, blur and gradient paint styles.
6. Apply sample variables and styles to nodes. Switch modes and verify typography, colors and shadows visually. Compare CSS gradient orientation at 0°, 90°, 180° and 270° and review normalized-bounds limitations on non-square nodes.
7. Record object IDs. Set local descriptions, scopes, code syntax and hidden-from-publishing flags. Modify a primitive in the repository, fetch and sync. Verify only changed values update and the original IDs/node bindings/local metadata remain.
8. Repeat Fetch/Sync without source changes. Expect zero new or updated objects. Edit a Figma value locally after preview and verify stale-preview rejection.
9. Export separate theme styles, verify distinct names and literal values, and confirm another theme cannot overwrite them. Confirm linked shared styles only occur when their bound structure/unbound values permit it.
10. Remove or rename source tokens. Confirm existing targets remain; resolve potential-renames explicitly and verify ID preservation. Check stale Tokens Studio IDs/keys from another file and duplicate-name conflicts.
11. Install the exact required font, export typography, then repeat with a missing family/style. Verify a missing font does not silently substitute or leave a newly created empty text style.
12. Enterprise extension configuration is not exposed by the simplified UI; do not advertise it as a user capability. Adapter coverage remains internal.
13. Stop a large sync mid-run. Verify completed targets persist, mapped partial targets resume without duplicates and immediate Figma Undo recovers the session. Exercise a mode limit and a document storage failure in a disposable test file.
14. Fetch an unrelated source change after editing a value locally. Verify the conflict dialog blocks sending until the local divergence is resolved. Confirm no polling or automatic application occurs; these features have been removed.
15. Reopen with session-only credentials, remembered credentials and after removing the connection. Verify the intended credential lifecycle; inspect outbound requests to confirm only the selected provider receives credentials/content.

Release approval requires completing these checks on the supported Figma clients/plans and enterprise endpoints. No source repository, real credential or Figma test file was supplied for this implementation session.

### Live Companion reference refinement — 13 November 2026

Inspected the open Companion plugin in Figma, including collection selection, search expansion
and filtering, alias chips, changed-row styling and grouped footer actions. Restored its search
and collection view after inspection; no fetch, push or send action was used.

Blueprint browser verification covered the compact Changes/All toolbar, search focus and Escape
reset, alias chips and resolved-value details, light/dark styles, and a 360 px dark stress view
with 5,000 tokens and six modes. Body, toolbar and footer remained within their containers; only
the token table scrolled horizontally. Searching token4999 returned one row and closing search
restored focus to the search button. Automated coverage verifies changed-status membership and
that searching/filtering does not request a new preview or alter export inclusion.

This was a live reference inspection and local Blueprint preview check. Running the updated
Blueprint bundle through the Figma bridge remains part of the manual acceptance checklist.

### Value inspector — 13 November 2026

Added a floating hover/focus inspector based on the supplied Companion screenshot. Automated
checks cover ordered mode/alias/value correspondence, missing values, false/zero/empty literals,
style context, edge placement, hover delay/cancellation, immediate focus opening and cancellation
of pending hover on rerender.

Browser checks covered click and keyboard opening, next/previous mode paging, arrow keys, Escape
and focus return, Tab access to the card, a single-mode bottom-row value opening above its anchor,
and a long string with six modes in the 360 px dark stress preview. Cards stayed inside the plugin
and above the footer. Screenshots: [light](value-inspector.png), [dark/narrow](value-inspector-dark.png).

### Companion dropdowns — 13 November 2026

Replaced native select popups with themed menus across collection browsing, status filters,
connection and settings fields. Collection choices show a checkmark, count and change-status dot.
Browser checks covered pointer selection, Arrow keys/Home/Enter, typeahead, Escape focus return,
Tab dismissal, updating the style strategy and filtering Review. Selecting a collection retains
the existing browsing-only behavior; export inclusion remains a separate control.

The full check passed all 86 tests, typechecking, formatting and bundling. The startup harness
was extended with the DOM query interface used while mounting dropdowns. Reviewed screenshots:
[collection dropdown](dropdown-preview.png) and [dark/narrow dropdown](dropdown-preview-dark.png).

### Styling plan implementation — 13 November 2026

See [the visual review sheet](COMPANION_VISUAL_REVIEW.md) for measured before/after dimensions,
screenshots and deliberate differences from Companion. Reviewed 440 px light, 620 px wide,
and 360 px dark stress layouts. The 56 px reduction above the table adds space without
shrinking values. Shared typography, panel tokens and secondary text also cover settings,
connection, Review, feedback and reports.

Opened the current development bundle inside Figma and loaded the sample preview. Confirmed
native dark theme rendering, a single main-view title hierarchy, collection keyboard selection,
and value-inspector paging/dismissal. The file already contained sample output, providing
unchanged and updated rows for inspection. No document sync was performed. Broader live release
checks above remain pending; the previous statement that the UI had never been run in Figma
is superseded by this visual-only verification. The full automated check passes 86 tests.

The preview also accepts `?demo=1&width=620` for a wider comparison. Demo window framing is
restricted to the standalone preview so a wider Figma iframe uses its full available width.

### Hover and focus audit — 13 November 2026

Addressed the four supplied UI screenshots: pointer-triggered rerenders no longer leave keyboard
focus outlines on buttons; keyboard navigation retains a 1 px focus indicator. Search retains
its field outline, with an inset 24 px close control and SVG close icon. Include now has a
compact rounded hover target. Value buttons no longer add a second grey fill over the row's
hover surface, and semantic updated/new/conflict colours retain precedence. Expanded details
use the scrolling viewport width rather than a fixed 420 px cap, with a continuous background.
Escape also dismisses a hover-only inspector while focus remains on the iframe body.

Verified mouse expansion and keyboard Tab focus in the browser, search opening/closing,
358 px detail wrapping within the 360 px six-mode dark stress preview, and actual Figma light
mode updated rows. In Figma, Escape dismissed the hover-only card without moving focus into it.
No sync was performed. Added a compiled UI regression test for pointer/keyboard modality across
rerenders. All 87 tests, formatting, typechecking and production build pass.

Capture: [native expanded-row correction](hover-audit-figma.png).
