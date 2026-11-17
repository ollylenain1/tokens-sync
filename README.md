# Blueprint · Token Sync

A read-only Figma plugin for bringing Tokens Studio-compatible GitHub and GitLab token repositories into native **variables, text styles, effect styles and paint styles**.

Fetch a commit-pinned snapshot, review changes, then sync in place. Existing IDs, scopes, code syntax, publishing visibility and node bindings are preserved. Local descriptions and style bindings are preserved by default. Source-removed items are retained.

**Development release:** native writes, authenticated providers and Enterprise compatibility still require live acceptance. See [release status and precise limitations](docs/RELEASE_STATUS.md).

## Install locally

Requirements: Node.js 18.18+ (22 LTS recommended), npm, and Figma Desktop with permission to run development plugins.

```sh
npm ci
npm run check
```

1. In Figma Desktop, open a design file, then **Plugins → Development → Import plugin from manifest**.
2. Select this repository’s `manifest.json`. The compiled files are `dist/code.js` and `dist/ui.html`.
3. Run **Blueprint · Token Sync**.
4. For distribution, create a plugin through Figma’s developer UI and replace the development `id` in `manifest.json` with your assigned Figma plugin ID. Keep that ID stable: clientStorage and plugin data are scoped to it.

The local development manifest uses a descriptive development ID. If your Figma client requires an assigned numeric ID, create a development plugin first and copy its generated ID into this manifest. No proposed or private API is required.

## Connect and sync

- **GitHub:** owner/organisation, repository, branch and token directory or JSON file. Use a fine-grained PAT restricted to the repository with **Contents: read**. Public repositories can omit the token.
- **GitLab:** namespace/project or numeric project ID, branch and path. A project-scoped **read_api** token supports the complete tree/commit/file workflow.
- **Enterprise hosts:** enter the HTTPS server URL. GitHub `/api/v3` and GitLab `/api/v4` are appended when necessary.
- **Storage:** a directory contains named JSON token sets plus optional `$themes.json` / `$metadata.json`; a single-file bundle contains named sets and optional `$themes` / `$metadata`. Use the format selector for metadata-free single-file bundles.

Use **Test connection**, then **Connect repository**. Fetch retrieves and validates tokens without modifying Figma. Browse the table by collection, use **Changes / All**, and open values to inspect aliases and differences. **Styles** is available in the source menu. Drag the bottom-right corner to resize the plugin; its final dimensions are remembered.

Choose **Send to Figma** to select collections and variable/style output, then confirm the write. The adjacent arrow offers **Send variables only** and **Send styles only**. Closing the dialog discards its selection changes. Export warnings and conflicts open focused dialogs; local divergence must still be resolved before sending. The result appears in a dialog and remains accessible through **Last sync result** in the menu.

There is no watch, automatic application, separate Review screen, advanced export configuration screen, or report/diagnostic download. Updates are fetched and applied manually. Safe metadata/binding preservation and linked-style defaults remain enabled. The simplified UI does not offer Enterprise extensions or per-set/naming/unit customization.

**Explore sample tokens** works without a repository. In Figma, pressing **Apply sample to this file** on the sample intentionally creates its variables and styles in the open file. The standalone browser preview is clearly labelled and never writes to Figma.

Remembering credentials is optional and off by default. Figma client storage is local and plugin-scoped but **not an encrypted secret vault**. Remove the connection to delete its stored credential. No repository contents or credentials go to an unrelated service.

## Development

```sh
npm run dev       # rebuild plugin and UI on changes
npm run typecheck # strict TypeScript against official Figma typings
npm run format    # format source, tests and documentation
npm test          # Node test runner: providers, resolver, converters, sync
npm run build     # self-contained production bundles
npm run preview   # local interface preview at http://127.0.0.1:4174/?demo=1
npm run package   # build a zip containing source, docs, fixtures and compiled plugin
```

Re-run the development plugin after rebuilding; the Figma iframe does not hot-reload. UI resources are bundled locally; no CDN or backend is needed. Tests do not require credentials or modify a Figma file.

## Documentation

- [Research and decisions](docs/RESEARCH.md): primary sources, verified APIs and choices recorded before implementation.
- [Architecture](docs/ARCHITECTURE.md): module boundaries, mapping identity, preservation, storage and failure handling.
- [Compatibility and limits](docs/COMPATIBILITY.md): precise input/conversion support and unsupported behaviour.
- [UI alignment plan and implementation](docs/UI_ALIGNMENT_PLAN.md): Companion-inspired layout, data contract, and acceptance results.
- [Testing and live acceptance](docs/TESTING.md): automated coverage and remaining Figma/provider checks.
- [Sample repositories](fixtures/README.md): single-file, multi-file and DTCG examples.

The implementation and automated checks are complete for the documented compatibility boundary. **Live authentication, actual Figma rendering/fonts and Enterprise entitlement have not been certified in this environment.** Complete the live checklist before a production rollout. Advanced unsupported composites are reported explicitly; the plugin never invents a lossy native equivalent silently.

This project is independent of Tokens Studio and Figma and does not use their branding or proprietary platform code.
