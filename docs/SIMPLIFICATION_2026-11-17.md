# Companion-inspired simplification — 17 November 2026

The user supplied five Companion screenshots and explicitly requested removing automatic sync/watch, the separate Review screen, report/diagnostic downloads, and other features that diverge substantially from that flow. This supersedes the corresponding expansion items in the original audit backlog.

## Current flow

- Main view: source name, collection selector, Changes/All, search, token table, compact export-warning shortcut, branch/fetch and Send to Figma.
- Styles remain available from the source menu. Expanded rows retain current/proposed values and aliases.
- Send opens a modal containing variable/style choices and collection checkboxes. Mode names are listed under each collection; individual mode selection has not been added.
- The split-button menu offers variables-only and styles-only export. Selection changes refresh the preview without writing. Closing the modal restores the prior selection.
- Warnings and conflicts use focused dialogs. Conflicts still block writes. Missing fonts still have a retry action.
- Sync results open in a modal and can be reopened from the menu. No report or diagnostic downloads remain.
- Watch and automatic-application execution were deleted. The advanced configuration screen, including Enterprise extension setup, naming, units and per-set/style-theme customization, was removed. The engine retains its underlying compatibility logic and uses safe defaults in the simplified UI.
- Repository access remains read-only; a Push to Studio action has not been added.

## Verification

The full check passed 115 tests, formatting, TypeScript and bundling after the initial simplification. Tests were updated to exercise confirmation, cancellation restoring export choices, split output selection, retained result dialogs, and the absence of removed controls. Existing planner, conversion, drift and preservation checks remain.

Browser verification confirmed that the main table has no Review/Include tabs or Watch controls. The export modal exposes only its own controls in the accessibility tree, refreshes the plan after deselecting a collection, restores focus to the export button on Escape, and restores the original two-collection selection on reopening. Browser mode explicitly cannot write to Figma.

Screenshots: [table](companion-simple-table.png), [export dialog](companion-simple-send.png).

Figma was not accessed, in accordance with the user’s request to leave it alone. Native dialog and result acceptance remains unverified; the prior sample sync evidence does not certify this new UI.

## Corner resize follow-up

Removed the Window size menu option. A bottom-right corner handle now resizes continuously in both dimensions, with bounds of 360–1200 px wide and 400–1000 px high. Final dimensions are saved on release and restored on launch; old Compact/Wide preferences migrate. Arrow keys resize by 10 px; Shift uses 40 px. Resize does not rebuild the UI or invalidate the sync plan.

Browser checks confirmed drag resizing, keyboard resizing and the absence of Window in the dropdown. Controller tests cover bounds, invalid dimensions, persistence, legacy migration and plan preservation; pointer tests cover coalescing requests and persisting the release coordinates. Native Figma resizing has not been exercised in this pass. Screenshot: [corner resize](companion-corner-resize.png).

## Footer CTA styling

Matched the Companion references with 40 px outlined button groups, softer shared borders, 8 px outer corners, consistent icon sizing, downward dropdown chevrons and a downward Send arrow. The output menu has larger left-aligned options and a restrained shadow. Narrow layouts reduce label spacing while retaining the same control height.

Browser checks covered 440 px light and 360 px dark layouts, split-menu placement, keyboard opening and focus visibility. Both footer groups remain within the narrow footer. Formatting and production bundling pass. Screenshots: [light CTA menu](companion-cta-styling.png), [dark narrow CTA menu](companion-cta-dark-narrow.png).
