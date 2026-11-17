# Companion-inspired UI alignment plan

Status: implemented in source and production bundles; finalized 13 November 2026. Browser and automated
verification completed; live Figma acceptance remains in [the testing checklist](TESTING.md).

Implementation includes the compact shell, Variables/Styles/Review views, collection inclusion
panel, shared preview serializer, mode values, alias details, style summaries, conflict/issue
shortcuts, grouped settings, and persistent footer. The connection form uses an Advanced
disclosure. Standalone previews support dark/narrow views and a generated 5,000-token fixture.
The stress preview displayed 11 full rows at 440 × 720 with bounded rendering.

Reviewed screens: [light](interface-preview.png), [dark](interface-preview-dark.png), and
[connection](interface-preview-connection.png). The original direction and acceptance plan follow the live-reference update below.

## Live Companion refinement — 13 November 2026

Inspected the Companion instance open in Figma, including its collection menu and search behavior.
The live reference puts more emphasis on the source name, keeps search collapsed until requested,
uses an inline Changes/All switch, shows aliases as outlined chips, tints changed rows, and groups
branch selection with refresh above outlined output actions.

Implemented those observations in Blueprint:

- Stronger repository heading with direct connection editing.
- Compact collection toolbar with scoped Changes/All counts and on-demand search. Escape clears
  and closes search, returning focus to its trigger.
- The detailed Changes tab is now **Review**, keeping conflicts, diagnostics and totals distinct
  from the inline Changes filter. **Include…** remains the export selection control.
- Alias target chips, swatches and theme-aware row tints; resolved values remain in hover text
  and expandable row details. Status is also available as text for accessibility.
- Branch and refresh grouped in the footer, alongside Watch and an outlined Sync to Figma action.

The filter affects browsing only. New, updated and conflicting rows appear under Changes; All
also includes unchanged and skipped output. Counts follow collection and search. Production
bundles and screenshots were refreshed. `npm run check` passed all 82 tests, typechecking,
formatting and bundling. Light/dark and the 360 px, 5,000-token stress preview were inspected.

## Value hover interaction — 13 November 2026

The supplied Companion screenshot adds a compact floating card with a mode heading, page count,
previous/next controls and an alias value. Blueprint now provides this interaction on variable
values and style previews, including resolved values and full text that would otherwise truncate.
Variable paging follows collection mode order and starts on the hovered cell's mode; styles keep
their actual theme context in a single page.

The card opens after a short hover delay and immediately on keyboard focus or click. It stays open
while the pointer or keyboard focus is within it, supports arrow keys and Escape, and clears when
the underlying view changes. Placement flips above low rows and stays within the plugin bounds.
The latest validation passed all 86 tests, typechecking, formatting and bundling, plus browser
checks for keyboard access, mode paging, long values and narrow/dark layout.

## Dropdown refinement — 13 November 2026

Matched the supplied collection-dropdown reference with a rounded floating panel, padded option
rows, selected checkmark, inline status dots and counts, and a custom chevron. The shared menu
also styles status, connection, settings and conflict selects while retaining their existing
values and change handlers. It supports arrow keys, Home/End, typeahead, Enter/Space, Escape,
Tab and outside dismissal, with scrolling and placement constrained to the plugin window.

## Direction

Make Blueprint feel like a compact Figma utility: a small source header, a collection selector,
a table of tokens and mode values, and a persistent action toolbar. Adapt Companion's visual
hierarchy and density to Blueprint's repository-based workflow and native variable/style output.

The recommended first release includes the table as well as the styling. Reducing padding alone
would leave the largest difference in place: Blueprint currently leads with repository and change
summary cards, while Companion leads with the tokens themselves.

## Reference and current UI

The supplied [Companion documentation](https://documentation.tokens.studio/plugins/companion-by-tokens-studio)
and its [light-mode interface screenshot](https://documentation.tokens.studio/images/Fetch%20Updates.png)
show a compact source identity row, collection dropdown, search control, fine table dividers,
monospaced token names/values, color swatches, and outlined footer actions. The
[overview image](https://documentation.tokens.studio/images/Companion%20Plugin.png) also shows a
dark interface. These are observations from the documentation images, not measurements from a
published component specification or a claim about the latest plugin build.

The pre-change baseline was inspected from the previous interface screenshot and
`src/ui/app.ts` / `src/ui/style.css`. Its 440 × 720 window is configured in `src/plugin.ts`.
The previous UI used a 61 px brand bar, 20 px content gutters, rounded repository and collection
cards, a prominent change-count table, and a filled accent-colored sync button. The connection
screen had a 26 px headline and a three-step introduction.

## Proposed changes

| Area           | Proposed treatment                                                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header         | Use a compact Blueprint identity and status; avoid duplicating Figma's native plugin title bar.                                                                            |
| Source         | Replace the repository card with a two-line row: repository name, then branch/path. Put connection editing and settings in one clearly labelled menu.                      |
| Toolbar        | Place the collection selector, collection inclusion controls, and search directly above the data.                                                                          |
| Main content   | Show variables as rows with a name column and one value column per mode. Use fine dividers instead of separate cards.                                                      |
| Navigation     | Use compact Variables, Styles, and Changes tabs. Collections become a browsing scope and export selection control.                                                         |
| Change summary | Move detailed output counts into Changes. Keep a short actionable count and visible warning/conflict indicator near the footer.                                            |
| Footer         | Group Fetch updates, Watch, and Sync to Figma in a stable toolbar. Use mostly neutral outlined controls, with stronger emphasis for the main action.                       |
| Onboarding     | Replace the hero with a concise connection heading and compact form. Put server URL and format overrides in an Advanced disclosure that opens for saved nondefault values. |
| Settings       | Group output, preservation, token sets, extended collections, and watch options in compact sections with progressive disclosure.                                           |

Proposed starting dimensions, to refine during visual review: 12 px body text, 11–12 px mono
token values, 4/8/12/16 px spacing, 4–6 px control corners, 28–32 px controls, and 32–36 px
table rows. Use Figma theme colors for neutral surfaces, text, borders, and semantic states.
Keep color primarily in value swatches, focus/selection, and status indicators. Replace the
current hardcoded light status fills with theme-aware equivalents.

## Main screen structure

```text
Blueprint                         Ready   [Menu]
team / design-tokens
main · tokens/ · fetched 2 minutes ago
───────────────────────────────────────────────
Variables     Styles     Changes (3)
[Collection: Interface ▾] [Include…] [Search…]
───────────────────────────────────────────────
Token name                 Light        Dark
color/background           ○ #ffffff    ● #101010
color/text                 ● #202020    ○ #eeeeee
spacing/base                  8            8
…
───────────────────────────────────────────────
3 updates · 1 warning [View]
[Fetch] [Watch]                 [Sync to Figma]
```

This is an illustrative layout, not sample fixture data. The table occupies the available
height; its headers and the action toolbar stay visible. At the current 440 px window width,
target at least ten ordinary rows with two modes visible without vertical scrolling. Support
horizontal scrolling inside the table for additional modes and keep the name column visible.
Use the existing 440 × 720 size initially; review at 360 px width as a robustness check.

## Interaction and data decisions

- **Collection scope versus inclusion:** selecting a collection changes what is being viewed.
  The Include control edits the existing export group selections and refreshes the preview.
  Viewing a collection must not silently change the sync scope. Show excluded groups explicitly.
- **Variables:** display the planned native output, including decomposed variables. Each mode
  cell shows its resolved value and an alias indicator where applicable. A detail disclosure
  reveals the full path, reference target, and conversion notes. Use a checkerboard for alpha
  colors and readable text for numbers, booleans, and strings. Values are read-only.
- **Styles:** show compact text, effect, and paint summaries with theme or Linked context.
  Styles do not receive fictitious Figma mode columns. Start with reliable text/swatch summaries;
  richer typography and effect rendering can follow separately.
- **Changes:** retain the current action filters, variables/styles totals, conflict recovery,
  skipped reasons, preserved missing-source items, and downloadable diagnostics. Show a visible
  route to conflicts from every tab; unresolved conflicts keep sync disabled.
- **Search:** search the current view within the selected collection, with a clear reset and
  labelled empty results. Show the scope in the UI. Preserve query, collection, scroll, and focus
  when opening details or changing a conflict choice; reset scope deliberately on source changes.
- **States:** cover disconnected, connected before fetch, fetching, preparing preview, ready,
  syncing, complete, no changes, no matches, unsupported output, conflict, error, and stopped.
  Pending counts must not appear as zero. Status announcements should not steal keyboard focus.
- **Watch:** expose the existing watch settings through the toolbar and show whether it fetches
  previews or automatically applies safe updates. Its actual interval is five minutes while open,
  with backoff; retain the separate opt-in for automatic application. Companion's documented
  five-second polling and minimization are separate behavior changes outside this UI plan.
- **Actions:** use accessible names, tooltips, keyboard focus, and adequate pointer targets for
  icon controls. Keep the Blueprint name/mark and the Sync to Figma label. Companion's Delete
  variables action is outside this plan; Blueprint's existing preservation workflow still applies.

## Implementation sequence

### 1. Establish the visual foundation and compact shell

In `src/ui/style.css`, define semantic surface, border, text, status, spacing, size, and radius
tokens. In `src/ui/app.ts`, rebuild the source row, navigation, footer, connection form, and
settings layout. Use a height-constrained flex/grid shell with a scrolling content region so
the footer does not obscure content; include the standalone preview banner in the layout.

Deliverable: reviewable light and dark versions of connection, connected, and settings screens
using existing functionality. Apply the new density consistently before adding the value table.

### 2. Expose a shared, typed preview presentation model

The live `previewPayload()` in `src/plugin.ts` currently exposes names, actions, types, and
collection mode names, but omits variable values. The browser demo separately spreads desired
objects and therefore already exposes more data than the live bridge. A value table built only
against the demo would give misleading confidence.

Extract a shared serializer and types, for example `src/ui/preview-model.ts`, used by both the
controller and `demoRPC()`. Include ordered mode keys/names, planned variable literals and alias
targets, style summaries/theme context, and existing action/conflict information. Derive these
from the existing desired model and plan so the UI displays the same conversions used for sync.
Reuse alias keys rather than inventing reference resolution in the UI. Keep credentials and
unneeded raw source objects out of the presentation model.

Deliverable: consistent live/demo preview payloads with meaningful coverage for a two-mode
color, a scalar, an alias, a linked style, and a theme-specific style. Verify preview serialization
does not mutate the document. No new provider integration is needed.

### 3. Build the collection and value browser

Implement the collection selector, inclusion panel, variable matrix, style list, row details,
and scoped search. Keep the current bounded rendering approach (60 rows with Show more) initially.
Check large fixtures before introducing virtualization. Keep Changes available throughout the
refactor so existing conflict and diagnostic tools remain reachable.

Deliverable: the main screen resembles Companion's compact table-based hierarchy and can be
used to inspect Blueprint's actual planned variables and styles.

### 4. Integrate feedback and review actions

Move the full count table into Changes; add a compact summary/status strip, conflict and warning
shortcuts, consistent progress/error states, and the Watch settings entry point. Surface collection
conflicts as well as variable/style conflicts. Retain the existing preview-ID sync request and
stale-preview rejection. Preserve cancellation and partial-result reporting.

Deliverable: the common path is connect → fetch → inspect → sync, with explicit recovery for
warnings, conflicts, and interrupted operations.

### 5. Verify and refresh the documentation

Run `npm run check` after implementation. Add targeted checks for the shared payload and changed
interactions: view scope versus export selection, search, conflict navigation, and disabled/busy
actions. Avoid tests that merely assert CSS values or reproduce template strings.

Review screenshots at 440 × 720 in both Figma light and dark themes. Check keyboard navigation,
focus after rerenders, long names, many modes, alpha colors, no styles, styles-only output,
empty/error states, and 5,000-token responsiveness. Check 360 px width and ensure only the table
scrolls horizontally. The browser preview demonstrates layout; verify the same screens through
the real Figma bridge, including startup and preview freshness. Exercise watch/auto-apply and
cancellation in a disposable file, then update `docs/interface-preview.png`, `docs/TESTING.md`,
and the README's flow description.

## Completion criteria

- Token values and modes are the main content immediately after fetch, with at least ten
  ordinary two-mode rows visible at 440 × 720.
- The shell, typography, borders, controls, and footer form a consistent compact hierarchy in
  light and dark themes, with no card stack competing with the data.
- Browsing scope and export inclusion are visibly distinct, and changing one does not
  accidentally change the other.
- Styles, diagnostics, conflict resolution, preservation controls, and watch options remain
  accessible from the new layout; blocking conflicts are visible from every tab.
- Live Figma and the demo use the same preview presentation model. Values match the planned
  output, and fetching/browsing do not write to Figma.
- Keyboard users can reach and operate every control; focus and content are not lost beneath
  the toolbar or during routine rerenders.

Implementation began with the compact shell and a two-mode variable table, then added the
settings, diagnostics, and exceptional states. The final `npm run check` passed formatting,
typechecking, all 81 tests, and production bundling.
