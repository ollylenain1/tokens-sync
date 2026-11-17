# Third-party notices

Runtime dependency: **Color.js 0.5.2**, MIT License, copyright Lea Verou and contributors. Source and licence: https://github.com/color-js/color.js.

Build-only dependencies: TypeScript (Apache-2.0), esbuild (MIT), Figma plugin typings (MIT), and Node.js typings (MIT). Exact versions and integrity hashes are in `package-lock.json`. Their code is not a repository access proxy or remote runtime service.

Tokens Studio documentation and public schemas/implementation were used as behavioural compatibility references. No Tokens Studio package, branding or proprietary platform implementation is included. Figma’s official typings define the host API; the adapter is independently implemented.

The archive includes the Color.js licence under `docs/licenses/` because its runtime code is bundled into the plugin.

Provider-selector artwork: user-supplied GitHub Invertocat black/white SVGs and GitLab RGB SVG, bundled locally in `src/ui/provider-logos.json`. GitLab’s transparent viewBox padding is trimmed for icon alignment; artwork paths and colors are unchanged. These marks identify their respective repository providers.
