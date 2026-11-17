# Compatibility research — 11 November 2026

This is an independent implementation. Tokens Studio documentation and public type definitions are compatibility references, not a licence to copy branding or proprietary implementations.

## Confirmed contracts

- [Theme export](https://docs.tokens.studio/figma/export/themes): groups become collections; themes become modes.
- [Token sets](https://docs.tokens.studio/manage-tokens/token-sets/): enabled sets export; source sets resolve references only; disabled sets are excluded; later sets override earlier ones. `$metadata.tokenSetOrder` supplies ordering when present.
- [Public ThemeObject](https://github.com/tokens-studio/types/blob/main/src/types/ThemeObject.ts): `id`, `name`, optional `group`, `selectedTokenSets`, `$figmaCollectionId`, `$figmaModeId`, `$figmaVariableReferences`, `$figmaStyleReferences`. References are hints to validate against the current file, not proof of ownership or portable IDs.
- The public [attachLocalVariablesToTheme implementation](https://github.com/tokens-studio/figma-plugin/blob/main/packages/tokens-studio-for-figma/src/plugin/asyncMessageHandlers/attachLocalVariablesToTheme.ts) records variable **keys**, collection IDs and mode IDs; ungrouped themes use their theme name as the collection name. This is implementation evidence, distinct from a stable published schema guarantee. Blueprint accepts local IDs and keys after validation.
- [Variables](https://docs.tokens.studio/figma/variables-overview) have four native types. [Typography](https://docs.tokens.studio/manage-tokens/token-types/typography/) and [shadows](https://docs.tokens.studio/manage-tokens/token-types/box-shadow) use composite values and native styles.
- [Tokens Studio gradients](https://docs.tokens.studio/manage-tokens/token-types/color/gradient) are CSS-like color values. Tokens Studio documents linear gradient export only.
- [DTCG 2025.10](https://www.designtokens.org/tr/2025.10/format/) defines `$type`/`$value`, dimensions, structured colors, composite shadows, typography and gradient stop arrays.
- [Figma typings](https://github.com/figma/plugin-typings) and [Plugin API](https://developers.figma.com/docs/plugins/): async local variable/style discovery, identity-preserving value setters, text style bindings, paint/effect bindings, and local collection `extend()` are available.
- [Extended collections](https://developers.figma.com/docs/plugins/api/ExtendedVariableCollection/) inherit modes and variables. Creation is Enterprise-only and can throw; there is no documented general plan-entitlement probe. Inherited mode IDs must be used for overrides; parent modes must not be changed by an extension sync.
- [GitHub contents](https://docs.github.com/en/rest/repos/contents) needs repository Contents: read for fine-grained tokens. [GitLab scopes](https://docs.gitlab.com/security/tokens/access_token_scopes/) distinguish file-only `read_repository` from broader REST `read_api`; this client uses tree/commit APIs and recommends a project-scoped read_api token.
- [clientStorage](https://developers.figma.com/docs/plugins/api/figma-clientStorage/) is private to the plugin ID, local to the client, limited to 5 MB, and explicitly not a secure vault.

## Design decisions and limits identified before implementation

1. Use a two-step Fetch / Sync workflow, inspired by [Companion](https://documentation.tokens.studio/plugins/companion-by-tokens-studio). Do not connect to Tokens Studio's proprietary platform.
2. Pin a fetch to a commit before reading files. Retrieve JSON under the configured directory or a single file with sibling theme/metadata files. Never write to the provider.
3. Support legacy and DTCG token leaves, group type inheritance, cross-set aliases and nested composite references. Reject unsupported semantic extensions rather than silently ignoring value modifiers. DTCG `$extends` and JSON Pointer `$ref` are outside the initial compatibility boundary.
4. Resolve mappings locally and validate type and collection. Ambiguous matches block that operation until a designer explicitly chooses a target. Unavailable external mappings require an explicit recovery choice. Do not import or publish remote libraries implicitly.
5. Plugin-owned, versioned file registry records repository, token path/type, theme/group, target identity, Figma IDs, last state and status. Store no credentials in document data. Keep source `$themes.json` untouched.
6. Preserve descriptions, scopes, code syntax, visibility and existing local bindings by default. Update values in place. Never delete source-orphaned targets. Rename only with a reliable retained mapping or an explicit designer target selection.
7. No native border style exists. Export compatible border properties as composed variables with a disclosure. Composition and assets are unsupported. Multi-value spacing/radius export named scalar properties with a disclosure.
8. Font family/style must exist and load; never substitute. Numeric weights require an unambiguous installed style mapping. Unsupported font fallbacks and typography properties are reported.
9. Linked styles may be shared across themes only when their bound structure and unbound values agree. Otherwise use theme-specific, group-qualified names. Theme-specific styles use resolved literals so collection mode changes cannot silently override their selected theme.
10. Support a conservative gradient subset: explicit CSS linear angles and positioned stops; centered radial gradients; DTCG stop arrays default to a documented horizontal linear geometry. Reject ambiguous geometry, repeating gradients and unsupported color spaces instead of approximating silently.
11. Detect extension API presence; entitlement is confirmed only by the requested operation. Extensions require matching inherited mode names and existing inherited variables; do not create extra variables or modes in an extension.
12. The API is not transactional. Preflight, per-item error reporting, incremental mapping checkpoints, cancellation between items and a Figma undo checkpoint mitigate partial failures. Live Figma and real provider acceptance still require a designer's file and credentials.
13. Optional watch checks run only while the plugin is open, with backoff. Automatic application is opt-in and disabled whenever the plan has unresolved conflicts/errors.
14. Arbitrary enterprise hosts need the manifest's wildcard network permission (documented reason). Runtime requests use only HTTPS at the configured API origin; no telemetry, third-party proxy, external UI assets or credential-bearing redirect following.

## Architecture proposed before implementation

`providers → repository snapshot → parser → per-theme resolver → converters → desired model → diff/mapping planner → preview → Figma writer → registry`

The iframe owns network requests and parsing. The plugin controller owns credentials in clientStorage, live Figma discovery, planning, fonts and writes. Typed messages cross the boundary; no DOM or document-node scans are needed. Pure conversion/planning code and provider adapters use deterministic fixtures and mocks. The Figma adapter is checked against official typings and exercised with a contract mock; a separate manual checklist covers real Figma behaviours that mocks cannot certify.

Primary references also include the [documentation repository](https://github.com/tokens-studio/tokens-studio-for-figma-plugin-docs), [GitHub setup](https://docs.tokens.studio/token-storage/remote/sync-git-github), [GitLab setup](https://docs.tokens.studio/token-storage/remote/sync-git-gitlab), [style references](https://docs.tokens.studio/figma/export/styles-variable-references), and [manifest network restrictions](https://developers.figma.com/docs/plugins/manifest/).
