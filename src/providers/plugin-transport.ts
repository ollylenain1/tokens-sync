import { Connection, SyncError } from '../core/model';

export interface PluginFetchResponse {
  headersObject: Record<string, string>;
  redirected: boolean;
  status: number;
  url: string;
  text(): Promise<string>;
}

export type PluginFetcher = (
  url: string,
  options: {
    method: 'GET';
    headers: Record<string, string>;
    credentials: 'omit';
    redirect: 'error';
  },
) => Promise<PluginFetchResponse>;

export async function readProviderRoute(
  connection: Connection,
  requestedUrl: string,
  fetcher: PluginFetcher,
  accept?: string,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  // The UI passes its canonical API root. Figma's main sandbox has no browser URL API.
  const root = connection.baseUrl;
  const gitlab = connection.provider === 'gitlab';
  const prefix = gitlab ? '/projects/' : '/repos/';
  const relative = requestedUrl.slice(root.length);
  const path = relative.split('?')[0];
  if (
    !['github', 'gitlab'].includes(connection.provider) ||
    !/^https:\/\/(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::[0-9]+)?(?:\/[^/?#@\\\s]+)*$/i.test(root) ||
    (gitlab && !root.endsWith('/api/v4')) ||
    !requestedUrl.startsWith(root) ||
    /[#\\\s\u0000-\u001f]/.test(requestedUrl) ||
    /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(root + path) ||
    !(
      path.startsWith(prefix) ||
      (gitlab && path === '/projects' && relative.startsWith('/projects?'))
    )
  )
    throw new SyncError('ORIGIN', 'Invalid provider API route.');
  const headers: Record<string, string> = {
    Accept:
      connection.provider === 'github'
        ? accept === 'application/vnd.github.raw+json'
          ? accept
          : 'application/vnd.github+json'
        : 'application/json',
  };
  if (connection.token)
    headers[connection.provider === 'github' ? 'Authorization' : 'PRIVATE-TOKEN'] =
      connection.provider === 'github' ? `Bearer ${connection.token}` : connection.token;
  const response = await fetcher(requestedUrl, {
    method: 'GET',
    headers,
    credentials: 'omit',
    redirect: 'error',
  });
  if (response.redirected || (response.url && response.url !== requestedUrl))
    throw new SyncError(
      'REDIRECT',
      'The provider redirected the request. Use its final HTTPS API host directly.',
    );
  const maxResponseSize = 30 * 1024 * 1024;
  const length = Number(
    response.headersObject['content-length'] ?? response.headersObject['Content-Length'],
  );
  if (length > maxResponseSize)
    throw new SyncError(
      'SIZE',
      'Provider response is too large. Select a narrower token directory.',
    );
  const body = await response.text();
  if (body.length > maxResponseSize)
    throw new SyncError(
      'SIZE',
      'Provider response is too large. Select a narrower token directory.',
    );
  return { status: response.status, headers: response.headersObject, body };
}
