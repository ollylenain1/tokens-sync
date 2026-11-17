import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Connection } from '../src/core/model';
import { RepositoryClient, normalizeConnection } from '../src/providers/client';
import { parseRepository } from '../src/core/parser';
const sha = 'a'.repeat(40);
const config: Connection = {
  provider: 'github',
  baseUrl: '',
  owner: 'team',
  repository: 'tokens',
  branch: 'feature/colors',
  path: 'tokens',
  layout: 'auto',
  token: 'secret-never-log',
  remember: false,
};
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers });
const text = (value: string, status = 200) => new Response(value, { status });
test('GitHub reads a commit-pinned nested directory and never sends write requests', async () => {
  const calls: { url: string; options?: RequestInit }[] = [];
  const client = new RepositoryClient(config, async (input, options) => {
    const url = String(input);
    calls.push({ url, options });
    if (url.includes('/commits/')) return json({ sha });
    if (url.endsWith(`/git/trees/${sha}`))
      return json({ tree: [{ path: 'tokens', type: 'tree', sha: 'b'.repeat(40) }] });
    if (url.includes('/git/trees/'))
      return json({
        truncated: false,
        tree: [
          { path: 'nested/core.json', type: 'blob', mode: '100644', sha: 'c'.repeat(40) },
          { path: '$themes.json', type: 'blob', mode: '100644', sha: 'd'.repeat(40) },
        ],
      });
    if (url.includes('core.json')) return text('{"space":{"type":"spacing","value":"8px"}}');
    return text(
      '[{"id":"t","name":"Default","group":"Base","selectedTokenSets":{"nested/core":"enabled"}}]',
    );
  });
  const snapshot = await client.fetch(),
    project = parseRepository(snapshot);
  assert.equal(project.sets['nested/core'][0].path, 'space');
  assert.equal(snapshot.revision, sha);
  assert(calls[0].url.includes('feature%2Fcolors'));
  assert(
    calls.filter((c) => c.url.includes('/contents/')).every((c) => c.url.endsWith(`ref=${sha}`)),
  );
  for (const call of calls) {
    assert.equal(call.options?.method, 'GET');
    assert.equal(call.options?.redirect, 'error');
    assert.equal(call.options?.credentials, 'omit');
    assert.equal(new URL(call.url).origin, 'https://api.github.com');
    assert(!call.url.includes(config.token));
  }
});
test('GitHub single-file storage reads sibling metadata and tolerates missing themes only', async () => {
  const client = new RepositoryClient({ ...config, path: 'design/tokens.json' }, async (input) => {
    const url = String(input);
    if (url.includes('/commits/')) return json({ sha });
    if (url.includes('%24themes.json')) return text('not found', 404);
    if (url.includes('%24metadata.json')) return text('{"tokenSetOrder":["tokens"]}');
    return text('{"x":{"type":"number","value":1}}');
  });
  const snapshot = await client.fetch();
  assert.equal(snapshot.singleFile, 'tokens.json');
  assert.equal(Object.keys(snapshot.files).length, 2);
  assert.equal(parseRepository(snapshot).themes[0].name, 'Default');
});
test('GitLab supports nested namespaces, pagination, pinned refs and raw JSON files', async () => {
  const urls: string[] = [];
  const client = new RepositoryClient(
    {
      ...config,
      provider: 'gitlab',
      owner: 'org/subgroup',
      repository: 'design',
      baseUrl: 'https://gitlab.example.com',
    },
    async (input, options) => {
      const url = String(input);
      urls.push(url);
      assert.equal((options?.headers as Record<string, string>)['PRIVATE-TOKEN'], config.token);
      if (url.includes('/commits/')) return json({ id: sha });
      if (new URL(url).searchParams.get('page') === '1')
        return json(
          Array.from({ length: 100 }, (_, i) => ({ path: `tokens/folder${i}`, type: 'tree' })),
          200,
          { 'x-next-page': '2' },
        );
      if (url.includes('/tree?'))
        return json([{ path: 'tokens/base.json', type: 'blob', mode: '100644', id: 'abc' }], 200, {
          'x-next-page': '',
        });
      return text('{"color":{"type":"color","value":"#fff"}}');
    },
  );
  const snapshot = await client.fetch();
  assert.equal(parseRepository(snapshot).sets.base.length, 1);
  assert(
    urls.every((u) =>
      u.startsWith('https://gitlab.example.com/api/v4/projects/org%2Fsubgroup%2Fdesign/'),
    ),
  );
  assert(urls.some((u) => u.includes('tokens%2Fbase.json/raw?ref=' + sha)));
});
test('numeric GitLab project IDs do not require a namespace', () => {
  const c = normalizeConnection({
    ...config,
    provider: 'gitlab',
    owner: '',
    repository: '123',
    baseUrl: '',
  });
  assert.equal(c.baseUrl, 'https://gitlab.com/api/v4');
});
test('enterprise API roots are normalized once and insecure endpoints rejected', () => {
  assert.equal(
    normalizeConnection({ ...config, baseUrl: 'https://github.company.test/' }).baseUrl,
    'https://github.company.test/api/v3',
  );
  assert.equal(
    normalizeConnection({ ...config, baseUrl: 'https://github.company.test/api/v3' }).baseUrl,
    'https://github.company.test/api/v3',
  );
  for (const baseUrl of [
    'http://github.test',
    'https://user:secret@github.test',
    'https://github.test?token=secret',
    'javascript:alert(1)',
  ])
    assert.throws(() => normalizeConnection({ ...config, baseUrl }));
  assert.throws(() => normalizeConnection({ ...config, path: '../secrets' }));
});
test('expired credentials and permission errors never include provider response bodies or tokens', async () => {
  for (const status of [401, 403, 404]) {
    const client = new RepositoryClient(config, async () => text(`Secret ${config.token}`, status));
    await assert.rejects(
      () => client.fetch(),
      (e) =>
        e instanceof Error &&
        !e.message.includes(config.token) &&
        /Authentication|Access|not found/.test(e.message),
    );
  }
});
test('network/redirect failures use sanitized actionable errors', async () => {
  const client = new RepositoryClient(config, async () => {
    throw new Error('URL contains secret-never-log');
  });
  await assert.rejects(
    () => client.test(),
    (e) =>
      e instanceof Error &&
      !e.message.includes(config.token) &&
      e.message.includes('Redirects are refused'),
  );
});
test('rate-limit responses enforce a cooldown without request storms', async () => {
  let calls = 0;
  const client = new RepositoryClient(config, async () => {
    calls++;
    return json({}, 429, { 'retry-after': '120' });
  });
  await assert.rejects(() => client.fetch(), /rate limit/);
  await assert.rejects(() => client.fetch(), /rate limit/);
  assert.equal(calls, 1);
});
test('truncated GitHub trees are rejected rather than producing incomplete sync', async () => {
  const client = new RepositoryClient({ ...config, path: '' }, async (input) =>
    String(input).includes('/commits/') ? json({ sha }) : json({ tree: [], truncated: true }),
  );
  await assert.rejects(() => client.fetch(), /truncated/);
});
test('file SHA cache avoids downloading unchanged JSON during repeat fetches', async () => {
  let downloads = 0;
  const client = new RepositoryClient({ ...config, path: '' }, async (input) => {
    const url = String(input);
    if (url.includes('/commits/')) return json({ sha });
    if (url.includes('/git/trees/'))
      return json({
        tree: [{ type: 'blob', mode: '100644', path: 'base.json', sha: 'b'.repeat(40) }],
      });
    downloads++;
    return text('{"x":{"type":"number","value":1}}');
  });
  await client.fetch();
  await client.fetch();
  assert.equal(downloads, 1);
});
test('file download concurrency is bounded and cancelled fetches are safe', async () => {
  let active = 0,
    peak = 0;
  const client = new RepositoryClient({ ...config, path: '' }, async (input) => {
    const url = String(input);
    if (url.includes('/commits/')) return json({ sha });
    if (url.includes('/git/trees/'))
      return json({
        tree: Array.from({ length: 12 }, (_, i) => ({
          type: 'blob',
          mode: '100644',
          path: `${i}.json`,
        })),
      });
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return text('{}');
  });
  await client.fetch();
  assert(peak <= 4);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => client.fetch(() => {}, controller.signal), /cancelled/);
});
test('malformed API JSON, large files and foreign tree paths fail clearly', async () => {
  await assert.rejects(
    () => new RepositoryClient(config, async () => text('<html>login</html>')).test(),
    /invalid API response/,
  );
  const huge = new RepositoryClient({ ...config, path: 'tokens.json' }, async (input) =>
    String(input).includes('/commits/') ? json({ sha }) : text('x'.repeat(5 * 1024 * 1024 + 1)),
  );
  await assert.rejects(() => huge.fetch(), /5 MB/);
  const foreign = new RepositoryClient({ ...config, provider: 'gitlab' }, async (input) =>
    String(input).includes('/commits/')
      ? json({ id: sha })
      : json([{ path: 'other/base.json', type: 'blob' }]),
  );
  await assert.rejects(() => foreign.fetch(), /outside/);
});

test('default branch discovery uses repository metadata for both providers and rejects empty repositories', async () => {
  for (const provider of ['github', 'gitlab'] as const) {
    const urls: string[] = [];
    const client = new RepositoryClient({ ...config, provider }, async (input) => {
      urls.push(String(input));
      return json({ default_branch: 'release/design' });
    });
    assert.equal(await client.defaultBranch(), 'release/design');
    assert.equal(
      urls[0],
      provider === 'github'
        ? 'https://api.github.com/repos/team/tokens'
        : 'https://gitlab.com/api/v4/projects/team%2Ftokens',
    );
  }
  const empty = new RepositoryClient(config, async () => json({ default_branch: null }));
  await assert.rejects(empty.defaultBranch(), /No default branch/);
});
