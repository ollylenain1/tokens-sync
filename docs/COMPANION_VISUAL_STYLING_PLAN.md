# Blueprint visual alignment with Companion

Status: implemented visual refinement, 13 November 2026. Browser and native Figma visual
verification are recorded in [the review sheet](COMPANION_VISUAL_REVIEW.md). This builds on
the completed interaction work in [UI_ALIGNMENT_PLAN.md](UI_ALIGNMENT_PLAN.md).
The targets below retain the original plan; the review sheet records actual measurements and limits.

## Goal and current baseline

Bring Blueprint's visual weight, typography, surfaces and spacing closer to Companion by
Tokens Studio. Preserve Blueprint's repository workflow, output views, inclusion controls,
conflict recovery and sync behaviour while refining their presentation.

The reference is the Companion instance inspected in Figma on 13 November, plus the supplied
collection-menu and value-hover screenshots. The current live reference is a wider window;
the earlier screenshots show the same interface at a narrow width. Compare logical UI pixels
and equal-sized content regions: the native Figma captures and browser screenshots have
different display scales. Reference dimensions inferred from images are estimates, not an
official Tokens Studio specification. The numeric targets below are proposed starting values.

Blueprint already has the main interaction patterns: collection browsing, Changes/All,
on-demand search, aliases, changed rows, custom dropdowns, a value inspector and outlined
footer controls. Refine these components rather than rebuilding them.

| Area               | Current Blueprint                                            | Remaining visual difference                                                    |
| ------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Type               | 12 px base; 11 px table; 10 px alias chips                   | Table values and aliases appear smaller than the reference                     |
| Header             | 40 px internal brand bar, 62 px source row, 36 px navigation | More stacked chrome above the data; Figma also supplies a native title bar     |
| Collection toolbar | 32 px selector; about 49 px toolbar                          | Pattern is close; label, count, segment and icon proportions need tuning       |
| Table              | 34 px rows; 176 px name column; 124 px minimum mode width    | Names and values are more compressed; change colours are quieter               |
| Dropdowns          | Checkmarks, inline counts/dots and rounded menus             | Tune type, padding, radius, hover/selection and shadow as one component        |
| Value inspector    | Mode paging, alias, resolved value and context               | Match the reference's header/body hierarchy and visual weight                  |
| Footer             | Branch/refresh, Watch, outlined Sync; 75 px total            | Controls and status text are small; spacing and action emphasis need balancing |

The inspected live Companion also shows a conditional “More changes in other collections”
strip. Treat this as a possible later UX enhancement; it is not necessary for this styling pass.

## Step-by-step implementation plan

### 1. Establish comparable reference screens

- Record the closed collection view, open dropdown and value inspector at a common logical
  width. Keep the source, toolbar, table and footer visible in each comparison.
- Use Blueprint's 440 × 720 window as the primary baseline; include a 360 px robustness check
  and a wider comparison against the current Companion window.
- Capture both products in light mode. Capture Companion dark mode when available; the live
  inspection for this plan established the light reference, not a complete dark specification.
- Use matching token types and states: an alias, an alpha colour, a scalar, a long name and
  enough rows to fill the table. Record the extra native Figma title bar separately.

Deliverable: a small reference sheet with annotated differences in type, spacing, colour,
radius and hierarchy. Use it to review every following step.

### 2. Define the visual tokens and type scale

In `src/ui/style.css`, replace scattered component values with shared typography, spacing,
surface, border, radius and elevation variables. Separate success text, row fills, value-cell
fills and status dots so one green does not determine every visual treatment.

| Property                                | Proposed starting target                       |
| --------------------------------------- | ---------------------------------------------- |
| Primary interface text                  | 12 px; 16–18 px line height                    |
| Token names, values and column headings | 12 px monospace; 18 px line height             |
| Alias chips                             | 11–12 px monospace; about 24 px overall height |
| Source title                            | 14–15 px semibold                              |
| Secondary labels                        | 11 px; reserve 10 px for occasional metadata   |
| Controls                                | 32 px height; 6 px corners                     |
| Dropdown rows                           | 34–36 px height                                |
| Floating panels                         | 7–8 px corners; fine border and soft shadow    |
| Spacing                                 | Shared 4 / 8 / 12 / 16 px scale                |

Keep Figma theme variables as the theme input, with explicit light/dark semantic fills for
planned changes. Use readable dark green text on pale green light-mode surfaces, a stronger
green value-cell fill, and a clear leading rail. Match the reference visually and retain
readable text and visible focus indicators in both themes.

Acceptance: the token table, menu and footer share a consistent scale; aliases no longer need
smaller type to fit their cells. Review these foundations before fine component tuning.

### 3. Reduce the header stack and strengthen the source hierarchy

In `src/ui/app.ts` and `src/ui/style.css`:

- Let Figma's native title bar carry the Blueprint identity in the live plugin. Consolidate
  the internal branding/status band into the source area; retain connection status and settings.
- Reduce the source block from 62 px towards 44–48 px. Make the repository name primary,
  with owner/path and fetch information secondary. Keep the source icon and edit affordance small.
- Retain Variables, Styles, Review and Include as visible Blueprint controls in a restrained
  28–32 px navigation band, with consistent selected treatment and count badges.
- Keep Collection, Changes/All and search aligned in a single toolbar. Search adds its input
  row only when opened.

Acceptance: recover roughly 50–60 px above the table at the baseline size. The source remains
clear, and every output/review/inclusion control remains discoverable and keyboard reachable.
Judge the live plugin with its native title bar included, not just the standalone demo.

### 4. Match the table, value chips and change states

In `src/ui/style.css`, refine the existing variable and style views:

- Apply the agreed 12 px table scale while retaining approximately 34–36 px ordinary rows.
- Trial a 200–224 px name column and 148–160 px minimum mode columns. Keep the name column
  and headings sticky. At narrow widths, allow table scrolling to preserve legibility.
- Give names, headings, swatches and aliases consistent left padding and vertical alignment.
  Use approximately 16 px colour swatches and larger, lightly outlined alias chips.
- Increase the distinction between the pale name-cell fill and stronger changed value cells.
  Keep dividers fine; reduce the visual weight of vertical separators.
- Apply the same visual vocabulary to updated, conflicting, skipped and unchanged output.
  Retain text/status explanations so colour is not the sole indicator.
- Keep style summaries and theme context readable at the same scale, without adding variable
  mode columns to styles.

Acceptance: names, aliases and colour values resemble the reference in weight and density.
Two complete mode columns are not a requirement at 440 px if that would force smaller text;
horizontal overflow stays inside the table. Long values remain available in the inspector.

### 5. Finish dropdowns, segmented controls and value inspectors

Refine `src/ui/select-menu.ts`, `src/ui/value-inspector.ts` and their CSS classes:

- Align dropdown trigger padding, prefix/value emphasis, chevron size and border treatment.
  Tune the menu checkmark column, inline count spacing and green dot to the supplied screenshot.
- Use the same menu radius, shadow and option states across collections, filters, settings,
  connection fields and conflict choices. Counts and dots remain meaningful for each context.
- Match Changes/All text, badge size, selected inset surface and outer neutral track.
- Give the value card a clear mode heading, balanced previous/count/next controls, a fine
  divider and a green alias pill. Keep Blueprint's resolved value and source context secondary.
- Standardise hover, pressed, selected, disabled and focus states across all these controls.
  Retain the implemented hover intent, keyboard navigation, dismissal and focus return.

Acceptance: an open menu and an open inspector look like parts of the same component system.
They remain inside the plugin bounds in light/dark and narrow/wide layouts, with full long-value
access and clear keyboard focus.

### 6. Balance the footer and icon system

- Use consistent 16 px icons, stroke weight, optical alignment and icon/text gaps.
- Keep branch and refresh as a connected group on the left, with a clearly labelled outlined
  Sync to Figma action on the right. Give Watch a consistent utility treatment between them.
- Use 12 px action labels and a compact, readable secondary line for change totals, issues and
  conflicts. Aim for a balanced footer around 64–72 px high rather than reducing text size.
- Keep controls usable during fetching, syncing, disabled and up-to-date states. Check long
  branch names and Watch/Auto-sync labels at 360 px; use labelled icon controls where needed.

Acceptance: the footer feels as deliberate as Companion's action area, remains visible, and
does not compete with the source or the token table. Every control represents existing Blueprint
behaviour; the visual reference does not add a Studio push action.

### 7. Carry the styling through secondary screens and feedback

- Apply the agreed scale, field heights, corners and spacing to connection and settings views.
- Use consistent disclosure rows and section dividers, with clear primary and secondary text.
- Restyle warnings, conflict controls, progress, empty states and sync reports with the same
  surfaces and icon language. Keep actionable issue routes visible from the token views.
- Check selected, disabled and error treatments on the shared dropdown component in these
  screens as well as in the collection toolbar.

Acceptance: connection, settings and Review feel like the same plugin as the main browser,
including error and busy states. Blueprint's safety and recovery information remains legible.

### 8. Verify in Figma and refresh the review artifacts

- Compare screenshots at equal logical sizes: normal view, open menu, value inspector,
  settings, warning/conflict, empty and busy states.
- Check light and dark themes at 440 px, then narrow and wider layouts. Exercise long names,
  multiple modes, alpha colours, long strings and the existing 5,000-token fixture.
- Verify the real Figma plugin's native title/header relationship and theme variables.
  Confirm menus, popovers, scrolling and focus behave inside the plugin sandbox.
- Run the existing `npm run check` suite after implementation. Add behavioural tests only
  when a changed interaction needs coverage; use visual review for styling decisions.
- Refresh the screenshots and [TESTING.md](TESTING.md), recording any deliberate differences
  from Companion. The latest pre-plan implementation baseline passes 86 tests.

Acceptance: the visual comparison has no unexplained differences in typography, chrome,
surfaces or component styling, and the existing sync/inclusion/conflict behaviour still passes
its checks. Keep the Blueprint name and its product-specific output and repository terminology.

## Recommended implementation order

Use four reviewable passes: **tokens and typography → header and table → floating controls
and footer → secondary states and Figma verification**. Finish the highest-impact type,
colour and header corrections before spending time on small shadows or icon offsets.
