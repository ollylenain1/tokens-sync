import { Connection, SyncError } from '../core/model';

import { providerApiRoot } from './client';

/** Parse web URLs only; never import credentials or fetch a pasted URL directly. */
export function parseRepositoryURL(value: string, provider: Connection['provider'], baseUrl = '') {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new SyncError('CONFIG', 'Paste an HTTPS repository or file URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new SyncError(
      'CONFIG',
      'Use an HTTPS URL without credentials, query parameters or fragments.',
    );
  if (url.hostname === 'github.com') provider = 'github';
  if (url.hostname === 'gitlab.com') provider = 'gitlab';
  let root = url.origin;
  let pathname = url.pathname;
  if (provider === 'gitlab' && baseUrl.trim()) {
    const instance = new URL(providerApiRoot(provider, baseUrl));
    const prefix = instance.pathname.replace(/\/api\/v4$/, '');
    if (instance.origin === url.origin && prefix) {
      if (!pathname.startsWith(prefix + '/'))
        throw new SyncError(
          'CONFIG',
          'The repository URL is outside the configured GitLab installation path.',
        );
      root += prefix;
      pathname = pathname.slice(prefix.length);
    }
  }
  let parts: string[];
  try {
    parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    throw new SyncError('CONFIG', 'The URL contains invalid escaping.');
  }
  if (parts.some((part) => /[\\\u0000-\u001f]/.test(part) || part === '..' || part === '.'))
    throw new SyncError('CONFIG', 'Use a repository URL without traversal segments.');
  const marker = provider === 'github' ? 2 : parts.indexOf('-');
  const repoParts = marker < 0 ? parts : parts.slice(0, marker);
  const tail = marker < 0 ? [] : parts.slice(marker + (provider === 'gitlab' ? 1 : 0));
  if (
    repoParts.length < 2 ||
    (provider === 'github' && repoParts.length !== 2) ||
    (tail.length && (!['blob', 'tree'].includes(tail[0]) || !tail[1]))
  )
    throw new SyncError(
      'CONFIG',
      'Use a repository URL or a file/directory URL containing blob or tree.',
    );
  const repository = repoParts.pop()!.replace(/\.git$/, '');
  if (!repository) throw new SyncError('CONFIG', 'The repository name is missing.');
  return {
    provider,
    baseUrl: root,
    owner: repoParts.join('/'),
    repository,
    branch: tail[1] ?? '',
    path: tail.length ? tail.slice(2).join('/') : 'tokens',
    fileURL: tail.length > 0,
  };
}
