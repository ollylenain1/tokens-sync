# Development release status — 17 November 2026

This build incorporates the audit safeguards and the subsequent Companion-inspired simplification. It is **not approved for production rollout**.

Watch/automatic application, the separate Review screen, report/diagnostic downloads and advanced configuration UI were removed at the user’s request on 17 November. Historical native results below apply to the earlier UI; the new dialogs have browser and automated evidence only. See [simplification details](SIMPLIFICATION_2026-11-17.md).
Automated and standalone-browser results do not establish native Figma or provider compatibility.

## Verified scope

The full local check passes 119 tests, strict TypeScript, formatting and production bundling.
Controller tests exercise the bundled message bridge using a mock Figma API.
Browser checks use the packaged UI with sample tokens and an in-memory document; they never write to Figma.
Native acceptance on 15 November verified sample creation, repeat-preview idempotency, partial-failure reporting, and immediate Undo in the disposable file listed below. Other native scenarios remain open.

| Capability                              | Evidence available                                                                                         | Release limitation                                                                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Conversion and aliases                  | Parser/converter/resolver tests; real fixture previews                                                     | Native variable types, alias propagation and six-mode plan limits are not certified                                                       |
| In-place sync and identity preservation | Planner/engine/mock controller tests                                                                       | Sample creation/idempotency and immediate Undo passed; IDs, metadata and node-binding preservation under source changes remain unverified |
| Local edit protection                   | Baseline divergence and explicit replacement regression tests                                              | Live local-drift handling during manual fetch/send remains unverified                                                                     |
| Fonts                                   | Same-session availability-refresh regression                                                               | Real font installation/helper reconnect and missing-font cleanup remain unverified                                                        |
| Text, paint and effect styles           | Property serialization tests; browser gradient specimen                                                    | Native typography, shadow order, gradient orientation and mode-dependent bindings require comparison                                      |
| Review, omissions and recovery          | Compiled UI tests, browser inspection                                                                      | Native immediate Undo and partial-failure wording passed; cancellation, storage failure and resume remain unverified                      |
| GitHub/GitLab                           | Mock provider requests, pagination, permissions and setup failure tests                                    | Public/private authenticated fetches, SSO, real rate limits and network restrictions are unverified                                       |
| Enterprise providers                    | URL normalization and request unit tests                                                                   | No GitHub Enterprise or self-managed GitLab endpoint has been certified; use manual fields for subpath deployments                        |
| Window sizing                           | Corner-drag/browser keyboard checks; controller persistence/bounds tests                                   | Native resize and preference restoration after reopening remain unverified                                                                |
| Accessibility                           | Visible states, keyboard browser checks, measured fallback contrast, persistent live-region implementation | VoiceOver completion/announcements and actual Figma theme contrast remain unverified; no WCAG conformance claim                           |
| Credentials                             | Storage lifecycle and request tests                                                                        | Native device persistence and outbound-network inspection remain unverified                                                               |

## Current user-visible limits

- Repository access is read-only; applying tokens writes to the open Figma file.
- Sample mode writes when “Apply sample to this file” is used in Figma. Browser sample mode cannot write.
- Repository/file URLs with slash-containing branch names may require manual correction of branch and path.
- Global collection search uses the active Variables or Styles tab. Searching both output types together is not implemented.
- Browser paint/shadow specimens are approximate; geometry, blending, font rendering and native bindings may differ.
- Unsupported effects retain textual property inspection rather than a misleading specimen.
- The last sync report survives fetching within the session; it is not a persisted history across plugin restarts.
- Keep local is an explicit skip for the current plan; it does not write that local change back to the repository.
- Source-removed or excluded outputs remain in Figma.

## Native acceptance attempt

On 15 November, Figma showed a reconnect warning and a blank new-file tab. The file later loaded,
but a computer-use interruption reported user activity and the active file changed. No sample
sync, variable/style edits, or renaming was performed. That attempt is not a passed acceptance check.

Use the checklist in [TESTING.md](TESTING.md) in an identified disposable file and test repository.
Record the Figma client/version, plan, file/repository identity, observed result and evidence for each
case before removing a limitation. Never replace a missing live result with a mock result.

### Successful native pass and resulting fix

Disposable file: [Blueprint audit acceptance — disposable — 2026-11-15](https://www.figma.com/design/YfutC4bPUl6auNlAz3HDxP/).
The plugin was launched through the existing development registration. A fresh preview offered 31
operations across two collections. The first native sync reported 28 created and one failed text
style, correctly retaining a partial-failure report.

Review isolated the failure to Figma's additional FontName variationSettings (slnt: 0, wght: 400).
The comparison now checks explicitly exported font metadata and does not propose deleting native
axis defaults. Regression coverage still detects a changed unbound style.

After rebuilding and reopening, the existing sample produced zero pending changes. Immediate Figma
Undo restored 31 pending operations. A clean sync then reported **29 created, 0 updated, 0 skipped,
0 failed** (collection creation is outside these output counts). Its refreshed preview showed
**18 unchanged variables and 11 unchanged styles**, zero pending changes and a disabled Up to date
action. Screenshot: [native sync report](audit-native-sync.png).

This pass establishes the stated sample behavior only. It does not certify authenticated providers,
watch, local-drift handling in live mode, font installation recovery, or node-level propagation.
Figma showed intermittent reconnect warnings; cloud persistence is not established by these checks.

Further native checks are deferred at the user’s request to leave Figma alone. This does not change the verified results above or remove any remaining release limitation.

GitLab setup now uses a combined project path and optional connection name, accepts bare HTTPS enterprise hostnames, and links to the Tokens Studio setup guide. Added regression coverage for canonical identity, single-file pulls, nested namespaces and saving/reopening the form. These are automated/browser results; authenticated GitLab and enterprise acceptance remain unverified.
