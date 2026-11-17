# Blueprint · Token Sync — audit and improvement backlog

13 November 2026. Audited the plugin running in Figma Desktop and the current workspace source.

The interface already has a coherent foundation: compact token tables, native theme support, a persistent action footer, keyboard-operable collection menus, and useful value inspection. The biggest improvements concern confidence in a sync: seeing exactly what changes, understanding which collections are affected, detecting local edits, and reporting incomplete results accurately.

## Scope and evidence

- Inspected onboarding, Variables, expanded updated-token details, Styles, Review, collection inclusion, the keyboard collection selector, diagnostics, and sync/watch settings in the live Figma plugin.
- The open session used sample tokens against a file that already contained sample output: 18 variables and 11 styles, with one updated variable and one updated style in the preview. No Sync action was performed in the live file.
- Read the controller, provider client, preview serializer, planner, sync engine, Figma adapter, registry, UI, and existing verification documentation.
- Ran `npm run check`: formatting, strict TypeScript, **87/87 tests**, and production bundling passed. This rebuilt the development bundles; the plugin returned to onboarding during the audit and the sample preview was reopened.
- Ran three additional isolated reproductions using the existing Figma mock. Their results appear below. These are code-level evidence, not proof of behavior in a production Figma file.
- No authenticated provider session, live document sync, Enterprise entitlement, installed-font change, or watch cycle was exercised.

Priority: **P1** = address before broader rollout; **P2** = next usability/reliability work. Effort is a relative implementation estimate: small, medium, or large.

## Prioritized backlog

| ID  | Priority | Improvement                                                      | Evidence                                                       | Effort       |
| --- | -------- | ---------------------------------------------------------------- | -------------------------------------------------------------- | ------------ |
| A01 | P1       | Detect local value changes before automatic application          | Reproduced planner behavior; automatic path verified in source | Medium       |
| A02 | P1       | Show current → proposed values for every change                  | Live UI and preview contract                                   | Medium       |
| A03 | P1       | Clearly identify sample mode and its write action                | Live UI and source                                             | Small        |
| A04 | P1       | Report partial syncs and remaining errors accurately             | Reproduced report behavior and source                          | Medium       |
| A05 | P2       | Refresh font availability when retrying                          | Reproduced cache behavior                                      | Small        |
| A06 | P2       | Make Review focus on all pending changes and explain count scope | Live UI and source                                             | Small–medium |
| A07 | P2       | Group diagnostics and distinguish errors, warnings, and notes    | Live UI                                                        | Medium       |
| A08 | P2       | Add visible state labels and verify accessibility                | Live UI and source; contrast testing remains open              | Small–medium |
| A09 | P2       | Offer search across collections and output types                 | Source and live navigation                                     | Medium       |
| A10 | P2       | Simplify repository setup and give targeted recovery actions     | Live onboarding and source                                     | Medium       |
| A11 | P2       | Make style previews visually informative                         | Live Styles view and serializer                                | Medium       |
| A12 | P2       | Add a resizable or wider plugin window                           | Fixed host size in source                                      | Medium       |
| A13 | P2       | Keep the last sync report accessible through recovery            | Source                                                         | Medium       |
| A14 | P1       | Complete and record live release acceptance                      | Existing checklist and current audit limits                    | Medium–large |

### A01 — Detect local value changes before automatic application

The stale-preview check protects edits made **after** a preview. Edits made **before** a new preview are treated as normal repository updates. In the isolated reproduction, changing an already-synced `font/size` from 16 to 99 and preparing the same source produced `action: updated`, no reason, zero variable conflicts, and zero error diagnostics.

The automatic path applies any plan with changes, no conflicts, and no error diagnostics. Consequently, when a later repository commit triggers watch, an unrelated local edit can also be overwritten without being identified as local drift. This consequence is inferred from the reproduced plan and the automatic-application condition; it was not triggered against the live file. An unchanged-revision watch cycle currently returns before auto-sync.

**Improve:** compare the last synced value, current Figma value, and incoming repository value. Offer “keep local,” “use repository,” or “skip” for divergence, and exclude unresolved local divergence from automatic updates. The registry already records `lastValue`, but the planner does not use it for this comparison.

**Acceptance:** sync once, edit a Figma value locally, change an unrelated repository token, and run watch. The local edit is identified and automatic application pauses for the affected plan. Ordinary source-only changes still apply according to the selected policy.

Source: [planner](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/sync/planner.ts:350>), [automatic application](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/ui/app.ts:757>), [mapping baseline](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/sync/engine.ts:77>).

### A02 — Show current → proposed values

The live `color/brand` row is marked Updated, but expanding it only repeats the proposed `#5265ed`. Review shows names, types, and status without a value comparison. The preview serializer sends desired values and target IDs, without the current values needed to explain the change.

**Improve:** add per-mode current/proposed values, alias-target changes, names, and changed style properties to the preview contract. Show a compact comparison in Review and expanded rows, with side-by-side color swatches. Indicate whether the change is a value, binding, description, rename, or mode update.

**Acceptance:** a reviewer can determine what will change without opening Figma's native variable/style editor. An unchanged mode stays visually quiet; a changed alias identifies both targets even when resolved colors match.

Source: [preview contract](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/ui/preview-model.ts:3>), [row details](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/ui/app.ts:392>), [Review rows](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/ui/app.ts:452>).

### A03 — Make sample mode unmistakable

In Figma, sample mode presents “design-tokens,” a green status dot, branch “main,” a fetched timestamp, and “Sync to Figma.” The explicit sample/no-write banner exists only in the standalone browser preview. Sample Sync in Figma intentionally writes to the current file, as documented in the README, but the live interface does not explain that distinction.

**Improve:** use a persistent “Sample tokens” badge, label fetching as loading sample data, remove the fictitious branch control, and name the action “Create/update sample tokens in this file.” Provide a visible route to connect a real repository.

**Acceptance:** users can identify sample mode and the result of its primary action from the main screen, without reading documentation.

Source: [banner](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/ui/app.ts:228>), [source and action rendering](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/ui/app.ts:517>).

### A04 — Distinguish full success, partial success, and unresolved errors

Adding one invalid color token to otherwise valid fixture data produced a syncable plan with one error and no operation conflicts. Applying it in the mock returned `failed: 0`, `skipped: 1`, and an error diagnostic. The UI chooses “Sync complete” from `failed` and `cancelled`, so this result receives success wording despite the omitted token. After refresh, no remaining writes can also be labelled “Up to date” while conversion errors remain.

There is a related state issue: after a successful report, `refreshPreview()` sets the phase to Complete without considering whether the new preview contains further changes, such as after an export-setting change.

**Improve:** derive status from the current plan, unresolved diagnostics, omissions, cancellation, and write failures. Preserve intentional partial sync, but label it “Synced with 1 skipped token” and make omissions visible before application. Use “Up to date” only for a preview with no pending work or unresolved errors within the selected export.

**Acceptance:** invalid input cannot produce an unqualified success/up-to-date message; changing settings after a successful sync produces Ready to sync when it creates new work.

Source: [report construction](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/sync/engine.ts:38>), [completion wording](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/ui/app.ts:513>), [phase calculation](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/ui/app.ts:701>).

### A05 — Refresh the font list on recovery

`prepareFonts()` caches `listAvailableFontsAsync()` for the adapter's entire lifetime. In the isolated reproduction, the available-font response changed from empty to the fixture's valid fonts, but a fresh preview still reported two missing-font diagnostics; the API was called only once. The current error tells the user to install the font and fetch a fresh preview, which does not invalidate this cache.

**Improve:** refresh availability on explicit retry/fetch, or invalidate the font list after a missing-font diagnostic. Offer “Check fonts again.”

**Acceptance:** once Figma itself exposes the font, the next retry in the same plugin session clears the missing-font error. Verify this in real Figma as well as the mock.

Source: [font cache](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/figma/adapter.ts:166>).

### A06 — Make Review and its counters match the user's task

The live UI simultaneously shows collection Changes 1, Review 2, and footer “2 changes.” In Styles/Foundations, Changes is 0 while the footer still offers two changes. Review inherits the current collection and defaults to All statuses, so clicking a badge of two changes can show a long list of unchanged items while hiding the changed style in another collection. The summary is global while the list is scoped.

**Improve:** open Review on pending changes across all included collections. Retain an explicit All items filter for auditing. Label the footer “2 changes across 2 collections,” show inclusion count on “Include…,” and label global summary totals. Include collection/mode operations in the change explanation even when variable/style counts are zero.

**Acceptance:** clicking Review 2 reveals both changed outputs immediately. The browsing collection and the export scope remain independent and visibly understandable.

Source: [toolbar](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/ui/app.ts:309>), [Review](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/ui/app.ts:452>), [global footer](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/ui/app.ts:517>).

### A07 — Make diagnostics concise and actionable

The sample's “2 issues” are the same border-conversion warning repeated for Light and Dark. Two compatibility notes similarly repeat the same explanation. Errors and warnings share the generic issues label, and diagnostics are at the bottom of the Review list.

**Improve:** group by token and diagnostic code, list affected modes together, and separate errors, warnings, and informational conversion notes. Add “Show token,” the relevant setting, and source navigation where available. Keep the existing direct footer shortcut and downloadable diagnostics.

**Acceptance:** the two border warnings become one entry with Light/Dark context; errors state what is blocked or omitted; informational fallbacks remain readable without appearing as failures.

Source: [diagnostics rendering](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/ui/app.ts:475>).

### A08 — Improve visible status and accessibility

The main connection state is visually a dot; its text is screen-reader-only or a tooltip. Updated rows rely heavily on a blue surface/rail and can resemble selected rows. Screen-reader status text and keyboard collection navigation already exist and should be retained.

**Improve:** show short visible state text such as Ready to sync or Needs attention, plus compact New/Updated labels or distinct icons on changed rows. Verify text contrast against actual Figma theme colors, keyboard focus through rerenders, and VoiceOver announcements for previews and results. This audit did not measure contrast or establish a WCAG conformance result.

**Acceptance:** a user can distinguish changed, selected, new, and conflicting rows without relying on hue; keyboard and screen-reader users can complete review and understand the resulting status. Use [W3C's use-of-color guidance](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color) and its [text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) as verification references.

Source: [status markup](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/ui/app.ts:222>), [row markup](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/ui/app.ts:430>).

### A09 — Add search across collections and outputs

Variables and Styles search is limited to the current collection and active output type. Their collection selector has no All collections option, so an apparently missing token may be elsewhere. Review can search globally, but that route is indirect and offers less value context.

**Improve:** add an explicit “This collection / All collections” search scope and optionally match both variable and style names. Group global results by collection and output type. Make alias chips navigable to their target, with a return route to the originating row.

**Acceptance:** a token in Interface can be found while browsing Foundations; result selection opens the correct collection and output without changing sync inclusion.

Source: [scoped toolbar](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/ui/app.ts:309>), [row filtering](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/ui/preview-model.ts:165>).

### A10 — Reduce setup effort and improve connection recovery

Onboarding requires separate owner, repository, branch, and path entries. Token-permission hints are useful, but users must obtain the token themselves and errors use one generic container. Connect checks the commit first; the complete token-path fetch happens after the connection is saved, so a readable repository can still lead to an unreadable-path failure.

**Improve:** accept a pasted repository/file URL and populate the fields, offer default-branch discovery, link to provider token setup, and show relevant field errors or recovery actions for repository/path/access failures. Explain whether the connection is saved when content loading fails. Retain manual fields and enterprise-host support.

**Acceptance:** a normal repository URL can populate setup; a bad path produces an editable path recovery action; private access failures preserve non-secret draft fields and identify the missing access requirement without echoing credentials.

Source: [connection form](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/ui/app.ts:238>), [connect flow](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/ui/app.ts:1041>).

### A11 — Upgrade style previews

Solid paint styles have useful swatches. Typography is represented by text such as “Inter Regular · 16 px,” gradients by “gradient linear · 2 stops,” and effects by a truncated description. Expanded style details also lack a complete property breakdown because the preview contract mostly supplies a summary.

**Improve:** add gradient thumbnails, a full typography property inspector, and a small effect specimen where faithful rendering is feasible. Identify approximate browser previews where they differ from Figma rendering. Keep searchable textual values and show the full destination style name in details.

**Acceptance:** users can inspect gradient stops, line height/letter spacing, and all shadow layers before syncing, including the properties that changed.

Source: [style presentation](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/ui/preview-model.ts:52>), [Styles table](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/ui/app.ts:441>).

### A12 — Support a wider or resizable window

The host always opens at 440 × 720. The table handles overflow and a wider standalone preview already exists, but the controller has no resize handler. Multiple modes and full style names would benefit from more space.

**Improve:** add Compact/Wide sizes or a resize handle, constrain it to usable bounds, and remember the preferred size. Preserve the fixed footer and contained table scrolling. Figma provides [`figma.ui.resize(width, height)`](https://developers.figma.com/docs/plugins/api/figma-ui/) for this purpose.

**Acceptance:** six modes remain usable in both compact and wide layouts; resizing keeps the current search, collection, focus, and scroll position.

Source: [host dimensions](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/plugin.ts:18>).

### A13 — Retain useful sync and recovery context

The engine supports cancellation checkpoints and Undo boundaries, and the UI can show a report. However, starting the next fetch clears that report. A cancelled operation specifically asks the user to fetch again to resume, so useful details disappear during recovery. The metadata-preservation message also always claims preservation, even when description preservation is explicitly disabled.

**Improve:** retain at least the last report until replaced by another sync. Record revision, completion time, selected export scope, counts, and failures; provide its export independently of current preview diagnostics. Describe cancellation and preservation according to the actual result/settings. Add clear immediate Undo guidance after partial failures, without promising Undo remains safe after unrelated edits.

**Acceptance:** after cancellation → fetch → retry, the previous result is still inspectable; a report accurately states which descriptions were updated and which outputs were skipped or failed.

Source: [report wording](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/ui/app.ts:513>), [report reset](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/src/ui/app.ts:712>).

### A14 — Record live acceptance before production rollout

The automated suite is substantial, but mocks cannot certify real native bindings, fonts, Undo, network policy, mode limits, or Enterprise extensions. The existing documentation already identifies these gaps. This session added live interface inspection, not a completed live-write acceptance pass.

**Improve:** execute the existing checklist in disposable files/test repositories and record client version, plan, provider, result, and evidence. Prioritize preview-without-writes, initial sync, repeat idempotency, primitive propagation, local metadata/bindings, missing-font recovery, stale previews, cancellation/resume/Undo, and watch with local divergence. Exercise the actual supported GitHub/GitLab enterprise endpoints before claiming their compatibility.

**Acceptance:** each advertised capability has a recorded live result or a precise limitation in release notes; the three reproduced cases above have regression coverage after correction.

Source: [live acceptance checklist](</Users/ollylenain/Documents/ChatGPT/Blueprint_ Token Sync/docs/TESTING.md:45>).

## Suggested implementation order

1. Fix A01, A03, A04, and A05; add targeted regressions for local divergence, partial-success wording, and font refresh.
2. Build A02 and A06 together so Review explains every pending change across the selected export. Add A07's severity/grouping to the same review workflow.
3. Improve A08–A13 based on representative repositories and larger multi-mode files. Measure search/render latency before choosing virtualization or a UI framework migration; neither is established as necessary by this audit.
4. Complete A14 before a wider release, with earlier live checks used to verify each reliability change.

## Additional isolated reproduction results

These ran against the current source bundled with the existing mock, without writing to the open Figma document:

```json
{"check":"local edit before preview","previousSource":16,"local":99,"action":"updated","reason":null,"conflicts":0,"errorDiagnostics":0}
{"check":"font availability changes in session","missingBefore":2,"missingAfter":2,"fontQueries":1}
{"check":"omitted invalid token","canSync":true,"conflicts":0,"previewErrors":1,"reportFailed":0,"reportSkipped":1,"reportErrorDiagnostics":1}
```

The local-edit reproduction syncs fixture data into the mock, changes `font/size`, and prepares the original source again. The font reproduction returns no fonts, then valid fonts, with a freshly built model for each preview. The omission reproduction adds an invalid color to otherwise valid fixture data and applies the resulting plan in the mock. No plugin source changes were made as part of this audit.
