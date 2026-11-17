# GitLab setup and pull compatibility

17 November 2026. Scope confirmed by the user: match setup and pull behavior; no repository writes.

The setup fields follow the [Tokens Studio GitLab guide](https://docs.tokens.studio/token-storage/remote/sync-git-gitlab): a connection nickname, access token, project path, branch, storage path and optional enterprise base URL. Unlike its two-way provider, Blueprint only fetches existing content and applies it to Figma after confirmation.

## Configure

1. Choose GitLab. Optionally name the connection.
2. Enter the project as `owner/repo` or `group/subgroup/repo`, or use a numeric project ID. Use a project, not a group page. Pasting a repository/file URL remains supported.
3. Set the branch, or use Find default branch. The repository must contain a commit and the configured token content.
4. Set a repository-relative JSON file such as `tokens.json`, or a folder such as `tokens`. Folder pulls include nested token sets and metadata. Metadata-free single-file bundles can be selected explicitly under Advanced connection.
5. For private repositories, supply a personal or project access token with `read_api`. Existing `api` tokens also work. Public repositories can omit the token where GitLab permits anonymous access. See [GitLab token documentation](https://docs.gitlab.com/user/profile/personal_access_tokens/).
6. For self-hosted GitLab, enter its HTTPS base URL. A bare hostname is upgraded to HTTPS. For an installation such as `https://code.example.com:8443/tools/gitlab/team/design`, enter `code.example.com:8443/tools/gitlab` as the base and `team/design` as the repository. Set the base before using **Use URL** so the importer can distinguish the installation path from GitLab subgroups. An existing `/api/v4` suffix is also accepted.

For authenticated enterprise connections, Blueprint looks up the exact project namespace among the token’s memberships and uses its numeric ID for repository reads. This follows the [Tokens Studio project lookup](https://github.com/tokens-studio/figma-plugin/blob/7a1758daa67e10d4d17c6f663a3fadfbeae9d85c/packages/tokens-studio-for-figma/src/storage/GitlabTokenStorage.ts). A manually entered numeric ID skips lookup. Anonymous connections and projects absent from the membership results use the full namespace directly.

Enterprise repository reads use Figma's main plugin fetch API. This avoids the UI iframe's `null`-origin CORS preflight, which some self-managed GitLab servers reject. The plugin still sends the token only to the configured HTTPS API host and refuses redirects. A corporate VPN, TLS certificate, login proxy or API permission can still block the connection. If the server redirects API requests to SSO, use the final API host or ask the GitLab administrator for direct API access; the plugin will not forward the token through a redirect.

Test connection and Save both fetch and parse token content. A bad path does not save the connection. After saving, the token preview is prepared; saving does not apply Figma writes. Credentials are session-only unless Remember is selected.

## Verification

Tests cover combined/split project-path identity equivalence, invalid paths, enterprise roots, personal-token headers, slash-containing branches, commit-pinned single-file pulls with sibling metadata, named connection save/reopen behavior, guarded main-thread transport, directory pagination, nested namespaces, numeric IDs, errors and GET-only requests.

Browser inspection confirmed the revised fields, GitLab guide link and editable project-path/name fields. [Setup screenshot](gitlab-setup.jpg).

No authenticated GitLab or self-hosted server was exercised. Real credentials, SSO, VPN and native Figma networking still require acceptance on the intended deployment. No push, branch creation, or empty-repository initialization is implemented.
