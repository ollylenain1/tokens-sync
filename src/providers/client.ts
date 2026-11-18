import { Connection, RepositorySnapshot, SyncError } from '../core/model';
export type Fetcher = typeof fetch;
export type Progress = (message: string, done?: number, total?: number) => void;
const MAX_FILE = 5 * 1024 * 1024,
  MAX_TOTAL = 30 * 1024 * 1024,
  MAX_FILES = 2000;
export class ProviderError extends SyncError {
  constructor(
    code: string,
    message: string,
    public status = 0,
    public retryAfter = 0,
  ) {
    super(code, message);
  }
}
export function normalizeConnection(input: Connection): Connection {
  if (!['github', 'gitlab'].includes(input.provider))
    throw new SyncError('CONFIG', 'Select GitHub or GitLab.');
  const c = {
    ...input,
    name: input.name?.trim(),
    owner: input.owner.trim().replace(/^\/+|\/+$/g, ''),
    repository: input.repository.trim(),
    branch: input.branch.trim(),
    path: input.path.trim().replace(/^\/+|\/+$/g, ''),
  };
  if (c.provider === 'gitlab') {
    const parts = [c.owner, c.repository]
      .filter(Boolean)
      .join('/')
      .replace(/^\/+|\/+$/g, '')
      .split('/');
    if (
      parts.some(
        (part) => !part || part === '.' || part === '..' || /[\\\u0000-\u0020?#:@]/.test(part),
      )
    )
      throw new SyncError(
        'CONFIG',
        'Enter a GitLab project as owner/repo, group/subgroup/repo, or a numeric project ID.',
      );
    c.repository = parts.pop() ?? '';
    c.owner = /^\d+$/.test(c.repository) && !parts.length ? '' : parts.join('/');
    if (!c.owner && !/^\d+$/.test(c.repository))
      throw new SyncError(
        'CONFIG',
        'Enter the full GitLab project path (owner/repo), not a group URL.',
      );
  }
  if (!c.repository || !c.branch || (c.provider === 'github' && !c.owner))
    throw new SyncError(
      'CONFIG',
      'Repository, branch and required owner/namespace fields must be filled in.',
    );
  if (c.path.split('/').some((p) => p === '..' || p === '.') || /[\u0000-\u001f\\]/.test(c.path))
    throw new SyncError('CONFIG', 'Use a repository-relative path without traversal segments.');
  c.baseUrl = providerApiRoot(c.provider, c.baseUrl);
  return c;
}

export function providerApiRoot(provider: Connection['provider'], baseUrl: string): string {
  let url: URL;
  let server = baseUrl.trim();
  if (provider === 'gitlab' && server && !/^[a-z][a-z\d+.-]*:\/\//i.test(server))
    server = 'https://' + server;
  try {
    url = new URL(
      server || (provider === 'github' ? 'https://api.github.com' : 'https://gitlab.com'),
    );
  } catch {
    throw new SyncError('CONFIG', 'Enter a valid HTTPS server URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new SyncError(
      'CONFIG',
      'The server URL must use HTTPS without credentials, query parameters or fragments.',
    );
  let path = url.pathname.replace(/\/+$/, '');
  if (provider === 'github' && url.hostname === 'github.com') {
    url.hostname = 'api.github.com';
    path = '';
  }
  if (provider === 'github' && url.hostname !== 'api.github.com' && !path.endsWith('/api/v3'))
    path += '/api/v3';
  if (provider === 'gitlab' && !path.endsWith('/api/v4')) path += '/api/v4';
  return url.origin + path;
}
export class RepositoryClient {
  readonly connection: Connection;
  private cooldownUntil = 0;
  private cache = new Map<string, string>();
  constructor(
    input: Connection,
    private fetcher: Fetcher = fetch,
  ) {
    this.connection = normalizeConnection(input);
  }
  get identity(): string {
    const c = this.connection;
    return JSON.stringify([c.provider, c.baseUrl, c.owner, c.repository, c.path]);
  }
  private projectId?: number;
  private get repoPath(): string {
    const c = this.connection,
      enc = encodeURIComponent;
    return c.provider === 'github'
      ? `/repos/${enc(c.owner)}/${enc(c.repository)}`
      : `/projects/${enc(this.projectId ?? [c.owner, c.repository].filter(Boolean).join('/'))}`;
  }
  async request(
    path: string,
    raw = false,
    signal?: AbortSignal,
  ): Promise<{ text: string; headers: Headers }> {
    if (!path.startsWith('/') || path.startsWith('//'))
      throw new SyncError('ORIGIN', 'Invalid provider API route.');
    if (Date.now() < this.cooldownUntil)
      throw new ProviderError(
        'RATE_LIMIT',
        'Provider rate limit reached. Wait before fetching again.',
        429,
        this.cooldownUntil - Date.now(),
      );
    const c = this.connection;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal?.aborted) throw new SyncError('CANCELLED', 'Fetch cancelled.');
      const controller = new AbortController(),
        cancel = () => controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(cancel, 25000);
      let response: Response;
      try {
        const headers: Record<string, string> = {
          Accept:
            c.provider === 'github'
              ? raw
                ? 'application/vnd.github.raw+json'
                : 'application/vnd.github+json'
              : 'application/json',
        };
        if (c.token)
          headers[c.provider === 'github' ? 'Authorization' : 'PRIVATE-TOKEN'] =
            c.provider === 'github' ? `Bearer ${c.token}` : c.token;
        response = await this.fetcher(c.baseUrl + path, {
          method: 'GET',
          headers,
          redirect: 'error',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: controller.signal,
        });
        if (
          response.status === 429 ||
          (response.status === 403 &&
            (response.headers.get('x-ratelimit-remaining') === '0' ||
              response.headers.has('retry-after')))
        ) {
          const retry =
            Number(response.headers.get('retry-after')) * 1000 ||
            Math.max(60000, Number(response.headers.get('x-ratelimit-reset')) * 1000 - Date.now());
          this.cooldownUntil = Date.now() + retry;
          throw new ProviderError(
            'RATE_LIMIT',
            'Provider rate limit reached. Wait for the reset or use an authenticated read-only token.',
            response.status,
            retry,
          );
        }
        if (response.status >= 500 && attempt < 2) {
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
          continue;
        }
        if (!response.ok) {
          const messages: Record<number, string> = {
            401: 'Authentication failed. Replace the expired or invalid access token.',
            403: 'Access denied. Check read permissions, organisation SSO authorisation and repository access.',
            404: 'Repository, branch or path not found, or the token cannot access it.',
          };
          throw new ProviderError(
            `HTTP_${response.status}`,
            messages[response.status] ??
              `The provider returned HTTP ${response.status}. Try again later.`,
            response.status,
          );
        }
        if (Number(response.headers.get('content-length')) > MAX_TOTAL)
          throw new SyncError(
            'SIZE',
            'Provider response is too large. Select a narrower token directory.',
          );
        const text = await response.text();
        if (text.length > MAX_TOTAL)
          throw new SyncError(
            'SIZE',
            'Provider response is too large. Select a narrower token directory.',
          );
        return { text, headers: response.headers };
      } catch (error) {
        if (error instanceof SyncError) throw error;
        throw new ProviderError(
          signal?.aborted ? 'CANCELLED' : 'NETWORK',
          signal?.aborted
            ? 'Fetch cancelled.'
            : 'Could not reach the configured host. Check HTTPS, network access, CORS, VPN and the plugin manifest. Redirects are refused to protect credentials.',
        );
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      }
    }
    throw new ProviderError('NETWORK', 'The provider is unavailable.');
  }
  private async get(path: string, signal?: AbortSignal): Promise<any> {
    const { text } = await this.request(path, false, signal);
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError(
        'RESPONSE',
        'The provider returned an invalid API response. Check the server base URL.',
      );
    }
  }
  private async resolveEnterpriseProject(signal?: AbortSignal) {
    const c = this.connection;
    if (
      c.provider !== 'gitlab' ||
      !c.owner ||
      !c.token ||
      this.projectId ||
      c.baseUrl === 'https://gitlab.com/api/v4'
    )
      return;
    // An enterprise proxy may reject encoded namespace slashes on project routes.
    const namespace = c.owner + '/' + c.repository;
    for (let page = 1; page <= 500; page++) {
      const query =
        'membership=true&simple=true&per_page=100&search=' + encodeURIComponent(c.repository);
      let result;
      try {
        result = await this.request('/projects?' + query + '&page=' + page, false, signal);
      } catch (error) {
        // Some project-scoped tokens can read a project but cannot list memberships.
        if (error instanceof ProviderError && [403, 404].includes(error.status)) return;
        throw error;
      }
      let projects;
      try {
        projects = JSON.parse(result.text);
      } catch {
        throw new ProviderError(
          'RESPONSE',
          'GitLab returned an invalid project list. Check the enterprise base URL.',
        );
      }
      if (!Array.isArray(projects))
        throw new ProviderError('RESPONSE', 'GitLab returned an invalid project list.');
      const match = projects.find((project) => project?.path_with_namespace === namespace);
      if (Number.isSafeInteger(match?.id) && match.id > 0) {
        this.projectId = match.id;
        return;
      }
      if (projects.length < 100 || result.headers.get('x-next-page') === '') return;
    }
  }
  async defaultBranch(signal?: AbortSignal): Promise<string> {
    await this.resolveEnterpriseProject(signal);
    const data = await this.get(this.repoPath, signal);
    if (typeof data?.default_branch !== 'string' || !data.default_branch.trim())
      throw new ProviderError(
        'RESPONSE',
        'No default branch was returned. Enter a branch manually; the repository may be empty.',
      );
    return data.default_branch;
  }
  async listBranches(signal?: AbortSignal): Promise<{ names: string[]; defaultBranch?: string }> {
    await this.resolveEnterpriseProject(signal);
    const github = this.connection.provider === 'github';
    const route = this.repoPath + (github ? '/branches' : '/repository/branches');
    const names = new Set<string>();
    let defaultBranch = github ? await this.defaultBranch(signal) : undefined;
    for (let page = 1; ; page++) {
      const { text, headers } = await this.request(
        route + '?per_page=100&page=' + page,
        false,
        signal,
      );
      let branches;
      try {
        branches = JSON.parse(text);
        if (
          !Array.isArray(branches) ||
          branches.some((branch) => typeof branch?.name !== 'string' || !branch.name)
        )
          throw new Error();
      } catch {
        throw new ProviderError('RESPONSE', 'The provider returned an invalid branch list.');
      }
      const previousCount = names.size;
      for (const branch of branches) {
        names.add(branch.name);
        if (!github && branch.default === true) defaultBranch = branch.name;
      }
      const nextPage = headers.get('x-next-page');
      const links = headers.get('link');
      const hasNext =
        nextPage !== null ? !!nextPage : links ? /rel="next"/.test(links) : branches.length === 100;
      if (!hasNext || !branches.length) break;
      if (names.size === previousCount)
        throw new ProviderError('RESPONSE', 'The provider repeated a page of branches.');
    }
    return { names: [...names], defaultBranch };
  }
  async revision(signal?: AbortSignal): Promise<string> {
    await this.resolveEnterpriseProject(signal);
    const c = this.connection;
    const data = await this.get(
      this.repoPath +
        (c.provider === 'github' ? '/commits/' : '/repository/commits/') +
        encodeURIComponent(c.branch),
      signal,
    );
    const revision = c.provider === 'github' ? data.sha : data.id;
    if (typeof revision !== 'string' || !/^[a-f\d]{7,64}$/i.test(revision))
      throw new ProviderError('RESPONSE', 'The provider did not return a valid commit identity.');
    return revision;
  }
  async test(signal?: AbortSignal): Promise<string> {
    return this.revision(signal);
  }
  private async files(
    revision: string,
    signal?: AbortSignal,
  ): Promise<{ path: string; sha?: string }[]> {
    const c = this.connection,
      enc = encodeURIComponent;
    if (c.path.endsWith('.json')) return [{ path: c.path }];
    if (c.provider === 'github') {
      let sha = revision;
      for (const part of c.path.split('/').filter(Boolean)) {
        const tree = await this.get(`${this.repoPath}/git/trees/${sha}`, signal);
        const entry = tree.tree?.find((item: any) => item.path === part && item.type === 'tree');
        if (!entry)
          throw new ProviderError('PATH', 'Token directory not found on the selected branch.');
        sha = entry.sha;
      }
      const tree = await this.get(`${this.repoPath}/git/trees/${sha}?recursive=1`, signal);
      if (tree.truncated)
        throw new ProviderError(
          'TRUNCATED',
          'The provider truncated this directory tree. Select a smaller token directory.',
        );
      if (!Array.isArray(tree.tree))
        throw new ProviderError('RESPONSE', 'Invalid repository tree.');
      return tree.tree
        .filter(
          (v: any) =>
            v.type === 'blob' &&
            v.mode !== '120000' &&
            typeof v.path === 'string' &&
            v.path.endsWith('.json'),
        )
        .map((v: any) => ({ path: [c.path, v.path].filter(Boolean).join('/'), sha: v.sha }));
    }
    const entries: { path: string; sha?: string }[] = [];
    for (let page = 1; page <= 500; page++) {
      const response = await this.request(
        `${this.repoPath}/repository/tree?ref=${enc(revision)}&path=${enc(c.path)}&recursive=true&per_page=100&page=${page}`,
        false,
        signal,
      );
      let data: any;
      try {
        data = JSON.parse(response.text);
      } catch {
        throw new ProviderError('RESPONSE', 'Invalid repository tree.');
      }
      if (!Array.isArray(data)) throw new ProviderError('RESPONSE', 'Invalid repository tree.');
      entries.push(
        ...data
          .filter(
            (v: any) =>
              v.type === 'blob' &&
              v.mode !== '120000' &&
              typeof v.path === 'string' &&
              v.path.endsWith('.json'),
          )
          .map((v: any) => ({ path: v.path, sha: v.id })),
      );
      if (entries.length > MAX_FILES)
        throw new ProviderError(
          'FILE_LIMIT',
          `More than ${MAX_FILES} JSON files. Select a narrower token directory.`,
        );
      if (
        data.length < 100 ||
        (response.headers.has('x-next-page') && !response.headers.get('x-next-page'))
      )
        return entries;
    }
    throw new ProviderError(
      'FILE_LIMIT',
      'Repository tree pagination limit reached. Select a narrower directory.',
    );
  }
  async fetch(progress: Progress = () => {}, signal?: AbortSignal): Promise<RepositorySnapshot> {
    progress('Checking repository and branch…');
    const c = this.connection,
      revision = await this.revision(signal),
      files: Record<string, string> = Object.create(null);
    const pathError = (error: unknown): never => {
      if (error instanceof ProviderError && error.status === 404)
        throw new ProviderError(
          'PATH',
          'Repository and branch are readable, but the token path was not found or is not accessible. Check the file or directory path and content permissions.',
          404,
        );
      throw error;
    };
    const entries = await this.files(revision, signal).catch(pathError),
      single = c.path.endsWith('.json');
    const root = single ? c.path.slice(0, c.path.lastIndexOf('/') + 1) : c.path ? `${c.path}/` : '';
    if (single)
      for (const name of ['$themes.json', '$metadata.json'])
        if (c.path !== root + name) entries.push({ path: root + name });
    if (!entries.length)
      throw new ProviderError('NO_FILES', 'No JSON files found in the selected directory.');
    if (entries.length > MAX_FILES)
      throw new ProviderError(
        'FILE_LIMIT',
        `More than ${MAX_FILES} JSON files. Select a narrower directory.`,
      );
    let cursor = 0,
      done = 0,
      totalBytes = 0;
    const nextCache = new Map<string, string>();
    const worker = async () => {
      while (cursor < entries.length) {
        const entry = entries[cursor++];
        if (!entry.path.startsWith(root) || entry.path.split('/').includes('..'))
          throw new ProviderError(
            'PATH',
            'The provider returned a path outside the configured directory.',
          );
        const cacheKey = entry.sha ? `${entry.path}:${entry.sha}` : `${entry.path}:${revision}`;
        let content = this.cache.get(cacheKey);
        try {
          if (content === undefined) {
            const route =
              c.provider === 'github'
                ? `${this.repoPath}/contents/${entry.path.split('/').map(encodeURIComponent).join('/')}?ref=${revision}`
                : `${this.repoPath}/repository/files/${encodeURIComponent(entry.path)}/raw?ref=${revision}`;
            content = (await this.request(route, true, signal)).text;
          }
        } catch (error) {
          if (
            single &&
            entry.path !== c.path &&
            error instanceof ProviderError &&
            error.status === 404
          ) {
            done++;
            continue;
          }
          throw error;
        }
        if (content.length > MAX_FILE)
          throw new ProviderError(
            'SIZE',
            'A token file exceeds the 5 MB limit. Split it into token sets.',
          );
        totalBytes += content.length;
        if (totalBytes > MAX_TOTAL)
          throw new ProviderError(
            'SIZE',
            'Token JSON exceeds the 30 MB limit. Select a narrower directory.',
          );
        files[entry.path.slice(root.length)] = content;
        nextCache.set(cacheKey, content);
        progress('Retrieving token files…', ++done, entries.length);
      }
    };
    // Wait for every worker before returning an error, preventing a failed fetch overlapping the next.
    const workers = await Promise.allSettled(
      Array.from({ length: Math.min(4, entries.length) }, worker),
    );
    const failure = workers.find((v): v is PromiseRejectedResult => v.status === 'rejected');
    if (failure) pathError(failure.reason);
    this.cache = nextCache;
    return {
      identity: this.identity,
      revision,
      files,
      fetchedAt: new Date().toISOString(),
      layout: c.layout,
      singleFile: single ? c.path.slice(root.length) : undefined,
    };
  }
}
