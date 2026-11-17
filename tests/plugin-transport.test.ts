import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Connection } from '../src/core/model';
import { PluginFetcher, readProviderRoute } from '../src/providers/plugin-transport';

const connection: Connection = {
  provider: 'gitlab',
  baseUrl: 'https://gitlab.company.test/gitlab',
  owner: 'group/subgroup',
  repository: 'tokens',
  branch: 'main',
  path: 'tokens.json',
  layout: 'auto',
  token: 'private-token',
  remember: false,
};
const url =
  'https://gitlab.company.test/gitlab/api/v4/projects/group%2Fsubgroup%2Ftokens/repository/commits/main';

test('enterprise GitLab requests use the main-thread transport with read-only guarded options', async () => {
  const calls: { url: string; options: Parameters<PluginFetcher>[1] }[] = [];
  const result = await readProviderRoute(connection, url, async (requested, options) => {
    calls.push({ url: requested, options });
    return {
      status: 200,
      url: requested,
      redirected: false,
      headersObject: { 'x-next-page': '2', 'content-length': '12' },
      text: async () => '{"id":"abc"}',
    };
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, url);
  assert.deepEqual(calls[0].options, {
    method: 'GET',
    headers: { Accept: 'application/json', 'PRIVATE-TOKEN': 'private-token' },
    credentials: 'omit',
    redirect: 'error',
  });
  assert.equal(result.headers['x-next-page'], '2');
  assert.equal(result.body, '{"id":"abc"}');
});

test('main-thread transport refuses foreign hosts and redirects before exposing response data', async () => {
  let calls = 0;
  const fetcher: PluginFetcher = async (requested) => {
    calls++;
    return {
      status: 200,
      url: requested,
      redirected: true,
      headersObject: {},
      text: async () => 'secret response',
    };
  };
  await assert.rejects(
    () => readProviderRoute(connection, url.replace('gitlab.company.test', 'other.test'), fetcher),
    /Invalid provider API route/,
  );
  assert.equal(calls, 0);
  await assert.rejects(() => readProviderRoute(connection, url, fetcher), /redirected/);
  assert.equal(calls, 1);
});

test('GitHub raw file responses retain the required media type', async () => {
  const github: Connection = {
    ...connection,
    provider: 'github',
    baseUrl: 'https://api.github.com',
    owner: 'team',
  };
  await readProviderRoute(
    github,
    'https://api.github.com/repos/team/tokens/contents/tokens.json?ref=abc',
    async (requested, options) => {
      assert.equal(options.headers.Accept, 'application/vnd.github.raw+json');
      return {
        status: 200,
        url: requested,
        redirected: false,
        headersObject: {},
        text: async () => '{}',
      };
    },
    'application/vnd.github.raw+json',
  );
});
