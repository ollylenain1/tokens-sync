import { Connection, SyncError } from '../core/model';
import { normalizeConnection } from './client';

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
  input: Connection,
  requestedUrl: string,
  fetcher: PluginFetcher,
  accept?: string,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const connection = normalizeConnection(input);
  const url = new URL(requestedUrl);
  const apiRoot = new URL(connection.baseUrl);
  const route = connection.provider === 'gitlab' ? '/projects/' : '/repos/';
  if (
    url.protocol !== 'https:' ||
    url.origin !== apiRoot.origin ||
    !url.pathname.startsWith(apiRoot.pathname.replace(/\/$/, '') + route) ||
    url.username ||
    url.password ||
    url.hash
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
  const response = await fetcher(url.toString(), {
    method: 'GET',
    headers,
    credentials: 'omit',
    redirect: 'error',
  });
  if (response.redirected || (response.url && response.url !== url.toString()))
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
