import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepositoryURL } from '../src/providers/repository-url';

test('repository URLs populate hosted providers, nested GitLab namespaces and file paths', () => {
  assert.deepEqual(parseRepositoryURL('https://github.com/team/tokens.git', 'gitlab'), {
    provider: 'github',
    baseUrl: 'https://github.com',
    owner: 'team',
    repository: 'tokens',
    branch: '',
    path: 'tokens',
    fileURL: false,
  });
  const file = parseRepositoryURL(
    'https://gitlab.com/group/subgroup/tokens/-/blob/develop/design/tokens.json',
    'github',
  );
  assert.equal(file.owner, 'group/subgroup');
  assert.equal(file.branch, 'develop');
  assert.equal(file.path, 'design/tokens.json');
  const enterprise = parseRepositoryURL(
    'https://git.example.com/team/tokens/tree/release%2Fv2/design',
    'github',
  );
  assert.equal(enterprise.baseUrl, 'https://git.example.com');
  assert.equal(enterprise.branch, 'release/v2');
  assert.equal(enterprise.path, 'design');
});

test('repository URLs reject credential-bearing URLs and unrelated pages', () => {
  for (const url of [
    'http://github.com/a/b',
    'https://secret@github.com/a/b',
    'https://github.com/a/b?token=secret',
    'https://github.com/a/b#secret',
    'https://github.com/a/b/issues/1',
    'https://github.com/a',
  ]) {
    assert.throws(() => parseRepositoryURL(url, 'github'));
  }
});
