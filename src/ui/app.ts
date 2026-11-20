import providerLogos from './provider-logos.json';
import { savedWindowSize } from '../core/window-size';
import { createWindowResizer } from './window-resizer';
import {
  Connection,
  Settings,
  SyncReport,
  TokenProject,
  defaultSettings,
  record,
  safeError,
} from '../core/model';
import { styleSpecimen } from './style-specimen';
import { groupDiagnostics } from './diagnostics';
import { parseRepositoryURL } from '../providers/repository-url';
import { parseRepository } from '../core/parser';
import { ProviderError, RepositoryClient, normalizeConnection } from '../providers/client';
import fixture from '../../fixtures/single-file/tokens.json';
import { uiStressFixture } from '../../fixtures/ui-stress';
import { createValueInspector } from './value-inspector';
import { createSelectMenus } from './select-menu';
import { previewStatus, reportHasIssues, reportTitle, omittedCount } from './sync-status';
import {
  Preview,
  PreviewRow as Row,
  VariableRow,
  StyleRow,
  previewPayload,
  formatLiteral,
  isIncluded,
  visibleRows,
  toggleList,
  conflictCount,
  changeCount,
} from './preview-model';

type Phase =
  | 'disconnected'
  | 'connected'
  | 'fetching'
  | 'previewing'
  | 'ready'
  | 'syncing'
  | 'complete'
  | 'error';
const demo = window.parent === window;
const app = document.getElementById('app')!;
let connection: Connection | undefined,
  draft: Connection = blankConnection();
let settings: Settings = structuredClone(defaultSettings),
  project: TokenProject | undefined,
  preview: Preview | undefined;
const valueInspector = createValueInspector(app, () => preview);
const selectMenus = createSelectMenus(app, () => {
  menuOpen = false;
  app.querySelector('.menu')?.remove();
  valueInspector.close();
});
let phase: Phase = 'disconnected',
  view: 'main' | 'connection' = 'main',
  tab = 'variables';
let browseAll = false;
const navigationHistory: {
  tab: string;
  scope: string;
  search: string;
  browseAll: boolean;
  browseFilter: string;
  rowLimit: number;
  origin: string;
}[] = [];
let scope = '',
  searchOpen = false,
  browseFilter = 'all',
  menuOpen = false;
const expandedRows = new Set<string>();
let error = '',
  notice = '',
  report: SyncReport | undefined,
  client: RepositoryClient | undefined,
  sample = false;
let choices: Record<string, string> = {},
  search = '',
  rowLimit = 60;
let progress = { text: '', done: 0, total: 0 },
  abort: AbortController | undefined;
let recoveryField = '';
let repositoryURL = '';
let windowSize = savedWindowSize(undefined);
let branchDraft = '';
type BranchMenu = {
  request: AbortController;
  result?: Awaited<ReturnType<RepositoryClient['listBranches']>>;
  failed?: boolean;
};
let branchMenu: BranchMenu | undefined;
function closeBranchMenu() {
  branchMenu?.request.abort();
  branchMenu = undefined;
}
let dialog: 'branch' | 'send' | 'report' | 'issues' | 'conflicts' | undefined;
let openDiagnosticDetails = '';
let sendMenuOpen = false;
let settingsBeforeSend: Settings | undefined;
let nextId = 0;
if (demo) {
  const params = new URLSearchParams(location.search);
  if (params.get('theme') === 'dark') document.documentElement.dataset.previewTheme = 'dark';
  if (['360', '620'].includes(params.get('width') ?? ''))
    document.documentElement.dataset.previewWidth = params.get('width')!;
}
const pending = new Map<
  number,
  {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout?: ReturnType<typeof setTimeout>;
  }
>();
function blankConnection(): Connection {
  return {
    provider: 'github',
    baseUrl: '',
    owner: '',
    repository: '',
    branch: 'main',
    path: 'tokens',
    layout: 'auto',
    token: '',
    remember: false,
  };
}
function rpc(type: string, data: Record<string, unknown> = {}): Promise<any> {
  if (demo) return demoRPC(type, data);
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    // Long syncs are cancellable and may legitimately take minutes. Only the initial
    // handshake has a deadline so a broken host bridge cannot hide the UI forever.
    const timeout =
      type === 'init'
        ? setTimeout(() => {
            pending.delete(id);
            reject(
              new Error(
                'Figma did not respond while opening Blueprint. Close and reopen the plugin. If this continues, open the plugin development console (Plugins → Development → Show/Hide console) and check for an error, then rebuild with npm run build.',
              ),
            );
          }, 15000)
        : undefined;
    pending.set(id, { resolve, reject, timeout });
    try {
      parent.postMessage({ pluginMessage: { id, type, ...data } }, '*');
    } catch (cause) {
      clearTimeout(timeout);
      pending.delete(id);
      reject(cause);
    }
  });
}
function repositoryClient(config: Connection): RepositoryClient {
  config = normalizeConnection(config);
  if (demo) return new RepositoryClient(config);
  const fetcher: typeof fetch = async (input, options) => {
    const signal = options?.signal;
    if (signal?.aborted) throw new ProviderError('CANCELLED', 'Fetch cancelled.');
    let onAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(new ProviderError('CANCELLED', 'Fetch cancelled.'));
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const response = await Promise.race([
        rpc('providerFetch', {
          connection: config,
          url: String(input),
          accept: (options?.headers as Record<string, string> | undefined)?.Accept,
        }),
        cancelled,
      ]);
      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      });
    } catch (cause) {
      if (cause instanceof ProviderError) throw cause;
      throw new ProviderError(
        'NETWORK',
        cause instanceof Error ? cause.message : 'The configured Git host could not be reached.',
      );
    } finally {
      if (onAbort) signal?.removeEventListener('abort', onAbort);
    }
  };
  return new RepositoryClient(config, fetcher);
}
window.addEventListener('message', (event) => {
  // Figma relays sandbox messages through pluginMessage. Its documented bridge
  // does not guarantee that MessageEvent.source is the immediate parent Window.
  // This UI embeds no external frames; validate the envelope and pending ID.
  const message = event.data?.pluginMessage;
  if (!record(message)) return;
  if (message.type === 'progress') {
    progress = {
      text: String(message.text),
      done: Number(message.done),
      total: Number(message.total),
    };
    updateProgress();
    return;
  }
  if (!Number.isSafeInteger(message.id) || typeof message.ok !== 'boolean') return;
  const request = pending.get(message.id as number);
  if (!request) return;
  clearTimeout(request.timeout);
  pending.delete(message.id as number);
  if (message.ok) request.resolve(message.result);
  else request.reject(new Error(String(message.error ?? 'Plugin operation failed.')));
});
// Keep pointer-triggered rerenders from inheriting the browser's keyboard-focus
// heuristic. Inputs still retain their field focus treatment in either modality.
window.addEventListener(
  'pointerdown',
  () => {
    document.documentElement.dataset.inputModality = 'pointer';
  },
  true,
);
window.addEventListener(
  'keydown',
  (event) => {
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key))
      document.documentElement.dataset.inputModality = 'keyboard';
    // Hover cards can be open while focus remains on the iframe body.
    if (event.key === 'Escape' && !app.contains(event.target as Node))
      valueInspector.keydown(event);
  },
  true,
);
const icons: Record<string, string> = {
  close: '<path d="m6 6 10 10M16 6 6 16"/>',
  search: '<circle cx="9" cy="9" r="5.5"/><path d="m13 13 5 5"/>',
  watch: '<circle cx="11" cy="12" r="7"/><path d="M8 2h6m-3 6v4l2 2"/>',
  more: '<circle cx="5" cy="11" r="1"/><circle cx="11" cy="11" r="1"/><circle cx="17" cy="11" r="1"/>',
  link: '<path d="m9 14-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m1 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0M8 14l6-6"/>',
  chevron: '<path d="m8 5 6 6-6 6"/>',
  grid: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="13" y="3" width="6" height="6" rx="1"/><rect x="3" y="13" width="6" height="6" rx="1"/><rect x="13" y="13" width="6" height="6" rx="1"/>',
  branch:
    '<path d="M6 3v10a4 4 0 0 0 4 4h6M16 5v12"/><circle cx="6" cy="3" r="2"/><circle cx="16" cy="5" r="2"/><circle cx="16" cy="17" r="2"/>',
  refresh: '<path d="M18 7A7 7 0 1 0 19 14M18 2v5h-5"/>',
  settings:
    '<path d="M4 6h14M4 16h14"/><circle cx="9" cy="6" r="3" fill="var(--bg)"/><circle cx="14" cy="16" r="3" fill="var(--bg)"/>',
  arrow: '<path d="M11 4v14m-6-6 6 6 6-6"/>',
  git: '<path d="m11 2 9 9-9 9-9-9 9-9Z"/><path d="m7 6 8 8M10 9v7"/><circle cx="10" cy="9" r="1"/><circle cx="15" cy="14" r="1"/>',
  check: '<path d="m4 11 5 5L18 6"/>',
};
const icon = (name: string) =>
  `<svg class="icon" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.grid}</svg>`;
const esc = (text: unknown) =>
  String(text ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const busy = () => ['fetching', 'previewing', 'syncing'].includes(phase);
const checked = (value: boolean) => (value ? ' checked' : '');
const disabled = (value = busy()) => (value ? ' disabled' : '');
const selected = (a: unknown, b: unknown) => (a === b ? ' selected' : '');
function statusLabel() {
  if (phase === 'ready' || phase === 'complete') return previewStatus(preview);
  return {
    disconnected: 'Not connected',
    connected: 'Connected',
    fetching: sample ? 'Loading sample' : 'Fetching',
    previewing: 'Preparing preview',
    syncing: 'Synchronising',
    error: 'Needs attention',
  }[phase];
}
function connectionStatus() {
  return `<span class="status" title="${esc(statusLabel())}" aria-label="${esc(statusLabel())}"><span class="dot ${busy() ? 'working' : connection || sample ? 'online' : ''}"></span><span class="status-label">${esc(statusLabel())}</span></span>`;
}
function settingsMenu() {
  return `<div class="menu-anchor"><button class="quiet icon-button" data-action="menu" aria-label="Connection and settings" aria-expanded="${menuOpen}" title="Connection and settings"${disabled()}>${icon('more')}</button>${menuOpen ? `<div class="menu"><div class="menu-label">Browse</div><button data-tab="variables">Variables</button><button data-tab="styles">Styles</button><div class="menu-divider"></div><button data-action="edit">Repository connection</button>${report ? '<button data-action="report">Last sync result</button>' : ''}</div>` : ''}</div>`;
}
function topbar() {
  const banner = demo
    ? '<div class="demo-banner">Blueprint · Sample preview · No Figma writes<button class="quiet" data-action="theme" aria-label="Toggle preview theme" title="Toggle preview theme">◐</button></div>'
    : '';
  if (view === 'main' && (connection || sample))
    return (
      banner +
      (sample && !demo
        ? '<div class="sample-banner">Sample tokens · Applying these changes writes to this Figma file.</div>'
        : '')
    );
  return `${banner}<header class="topbar"><div class="brand">${icon('grid')}<span>Blueprint</span><span class="brand-sub">Token Sync</span></div>${connectionStatus()}</header>`;
}
function field(name: keyof Connection, label: string, placeholder = '', type = 'text', hint = '') {
  return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(draft[name])}" placeholder="${esc(placeholder)}" autocomplete="${type === 'password' ? 'new-password' : 'off'}" spellcheck="false" ${disabled()} >${hint ? `<small>${hint}</small>` : ''}</label>`;
}
function providerLogo(provider: 'github' | 'gitlab') {
  const image = (svg: string, variant = '') =>
    `<img class="provider-logo ${variant}" src="data:image/svg+xml,${encodeURIComponent(svg)}" alt="" aria-hidden="true">`;
  return provider === 'github'
    ? image(providerLogos.githubBlack, 'github-light') +
        image(providerLogos.githubWhite, 'github-dark')
    : image(providerLogos.gitlab);
}
function welcomeView() {
  return `<main class="main welcome" aria-labelledby="welcome-title"><div class="welcome-inner">
    <figure class="welcome-art" aria-label="Example color tokens from tokens.json">
      <figcaption><span aria-hidden="true">{ }</span> tokens.json</figcaption>
      <div class="welcome-palette">
        <div class="welcome-swatch ink"><span>color.ink</span><small>#182230</small></div>
        <div class="welcome-swatch paper"><span>color.paper</span><small>#FFFFFF</small></div>
        <div class="welcome-swatch brand-color"><span>color.brand</span><small>#5265ED</small></div>
      </div>
    </figure>
    <div class="welcome-copy"><h1 id="welcome-title">Bring your tokens into Figma.</h1>
      <p>Connect a GitHub or GitLab repository to preview your tokens, then apply them as Figma variables and styles.</p>
      <div class="welcome-actions"><button class="primary" data-action="edit">Connect repository ${icon('chevron')}</button><button data-action="sample">Explore sample tokens</button></div>
    </div>
  </div></main>`;
}
function connectionView() {
  const first = !connection && !sample;
  const gitlab = draft.provider === 'gitlab';
  const findBranch = `<button type="button" class="quiet tiny" data-action="default-branch"${disabled()}>Find default branch</button>`;
  return `<main class="main form-view" data-scroll="form"><div class="settings-heading"><button class="quiet icon-button" data-action="back" aria-label="Back">←</button><div><h1>${first ? 'Connect a repository' : 'Repository connection'}</h1><p>Bring your tokens into Figma as variables and styles.</p></div></div>
  <div class="provider-tabs" aria-label="Repository provider"><button aria-pressed="${draft.provider === 'github'}" class="${draft.provider === 'github' ? 'selected' : ''}" data-provider="github"${disabled()}>${providerLogo('github')} GitHub</button><button aria-pressed="${draft.provider === 'gitlab'}" class="${draft.provider === 'gitlab' ? 'selected' : ''}" data-provider="gitlab"${disabled()}>${providerLogo('gitlab')} GitLab</button></div>
  <form id="connection-form" class="${gitlab ? 'gitlab-form' : ''}"><div class="url-entry"><label class="field"><span>Repository or file URL</span><input id="repository-url" type="url" value="${esc(repositoryURL)}" placeholder="${gitlab ? 'https://gitlab.com/team/design-tokens' : 'https://github.com/team/design-tokens'}" autocomplete="off"${disabled()}>${gitlab ? '' : '<small>For enterprise URLs, select the provider first. Manual fields remain editable.</small>'}</label><button type="button" data-action="parse-url"${disabled()}>Use URL</button></div>${gitlab ? `<div class="project-fields">${field('name', 'Connection name (optional)', 'My GitLab tokens')}${field('repository', 'Repository (owner/repo)', 'group/subgroup/design-tokens', 'text', 'Enter the project path or numeric project ID.')}</div>` : `<div class="two">${field('owner', 'Owner / organisation', 'your-team')}${field('repository', 'Repository', 'design-tokens')}</div>`}
  <div class="two"><div>${field('branch', 'Branch', 'main')}${gitlab ? findBranch : ''}</div>${field('path', gitlab ? 'Token storage location' : 'File or directory path', 'tokens.json', 'text', gitlab ? 'Path to an existing JSON file or folder.' : '')}</div>
  ${gitlab ? '<section class="gitlab-access" aria-label="Repository access">' : findBranch}
  ${field('token', gitlab ? 'Personal access token' : 'Access token', 'Optional for public repositories', 'password', draft.provider === 'github' ? 'Fine-grained token with Contents: read access.' : 'Use a personal or project token with read_api or api scope.')}
  <label class="check"><input type="checkbox" name="remember"${checked(draft.remember)}${disabled()}>Remember access token on this device</label>
  <p class="credential-note">Stored locally in Figma, not in an encrypted vault. Leave off to keep the token for this session.</p>
  <div class="connection-guides">${gitlab ? '<p class="small"><a href="https://docs.tokens.studio/token-storage/remote/sync-git-gitlab" target="_blank" rel="noopener noreferrer">Tokens Studio GitLab setup guide ↗</a></p>' : ''}
  <p class="small"><a href="${draft.provider === 'github' ? 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens' : 'https://docs.gitlab.com/user/profile/personal_access_tokens/'}" target="_blank" rel="noopener noreferrer">Access token setup guide ↗</a></p></div>${gitlab ? '</section>' : ''}
  <details class="settings-section" data-disclosure="advanced"${draft.baseUrl || draft.layout !== 'auto' ? ' open' : ''}><summary>Advanced connection</summary>
  ${field('baseUrl', gitlab ? 'Base URL — Enterprise (optional)' : 'Server URL', gitlab ? 'https://gitlab.company.com' : 'https://api.github.com', gitlab ? 'text' : 'url', gitlab ? 'For self-managed GitLab, enter the host and any installation path before using a repository URL.' : 'Leave blank for the hosted service. Supports enterprise servers.')}
  <label class="field"><span>Single-file format</span><select name="layout"${disabled()}><option value="auto"${selected(draft.layout, 'auto')}>Auto · detect from metadata</option><option value="bundle"${selected(draft.layout, 'bundle')}>Tokens Studio bundle (named sets)</option><option value="single-set"${selected(draft.layout, 'single-set')}>One token tree</option></select><small>Directories use one token set per JSON file.</small></label></details></form>
  ${progressView()}${notice ? `<div class="notice success" role="status">${esc(notice)}</div>` : ''}${errorView()}
  ${first ? '<button class="quiet full sample-link" data-action="sample">Explore sample tokens →</button>' : connection ? '<button class="quiet full error-color" data-action="disconnect">Remove connection &amp; stored credential</button>' : ''}
  </main><footer class="footer"><div class="footer-row">${busy() ? `<button data-action="cancel"${disabled(!abort)}>Stop</button>` : '<button data-action="test">Test connection</button>'}<button class="primary" data-action="connect"${disabled()}>${first ? 'Connect repository' : 'Save connection'}</button></div><div class="footer-note">Read-only repository access</div></footer>`;
}
function errorView() {
  return error
    ? `<div class="notice error" role="alert"><div class="notice-title">Unable to complete this step</div>${esc(error)}${recoveryField ? `<p><button class="quiet tiny" data-action="recover-connection">${recoveryField === 'token' ? 'Review access token' : recoveryField === 'path' ? 'Edit token path' : 'Review repository and branch'}</button></p>` : ''}</div>`
    : '';
}
function progressView() {
  if (!busy()) return '';
  const known = progress.total > 0;
  const percent = known
    ? Math.min(100, Math.max(0, Math.round((progress.done / progress.total) * 100)))
    : 0;
  return `<div class="loading${phase === 'syncing' ? ' sync-progress' : ''}"><div class="loading-line"><span class="spinner" aria-hidden="true"></span><span id="progress-text" role="status">${esc(progress.text || statusLabel())}</span></div><div class="progress-metrics"><span id="progress-count">${known ? `Step ${progress.done} of ${progress.total}` : 'Preparing…'}</span><span id="progress-percent">${known ? `${percent}%` : ''}</span></div><div id="progress-track" class="progress-track${known ? '' : ' indeterminate'}" role="progressbar" aria-label="${phase === 'syncing' ? 'Sending to Figma' : 'Progress'}" aria-valuemin="0" aria-valuemax="100"${known ? ` aria-valuenow="${percent}"` : ''}><div id="progress-fill" class="progress-fill" style="width:${known ? percent : 35}%"></div></div></div>`;
}
function updateProgress() {
  const text = document.getElementById('progress-text');
  const fill = document.getElementById('progress-fill');
  const track = document.getElementById('progress-track');
  const count = document.getElementById('progress-count');
  const percentage = document.getElementById('progress-percent');
  const known = Number.isFinite(progress.total) && progress.total > 0;
  const done = Number.isFinite(progress.done)
    ? Math.max(0, Math.min(progress.done, progress.total))
    : 0;
  const percent = known ? Math.round((done / progress.total) * 100) : 0;
  if (text) text.textContent = progress.text;
  if (count) count.textContent = known ? `Step ${done} of ${progress.total}` : 'Preparing…';
  if (percentage) percentage.textContent = known ? `${percent}%` : '';
  if (fill) fill.style.width = `${known ? percent : 35}%`;
  if (track) {
    track.classList.toggle('indeterminate', !known);
    if (known) track.setAttribute('aria-valuenow', String(percent));
    else track.removeAttribute('aria-valuenow');
  }
}
function conflictControls(row: Row) {
  if (row.action !== 'conflicting') return '';
  if (row.localDrift)
    return `<div class="conflict-controls"><p>${esc(row.reason)}</p><button data-skip="${esc(row.key)}"${disabled()}>Keep local · skip</button><button data-repository="${esc(row.key)}"${disabled()}>Use repository</button></div>`;
  return `<div class="conflict-controls"><p>${esc(row.reason)}</p>${row.candidates ? `${row.candidates.length ? `<input data-candidate-search="${esc(row.key)}" placeholder="Find a local target by name…" aria-label="Filter compatible targets">` : ''}<select data-choice="${esc(row.key)}" aria-label="Resolve mapping for ${esc(row.name)}"${disabled()}><option value="">Choose a safe recovery…</option><option value="skip">Skip this item</option><option value="create">Create a new local target</option>${candidateOptions(row.candidates.slice(0, 100))}</select>` : `<button class="tiny" data-skip="${esc(row.key)}"${disabled()}>Skip this item</button>`}</div>`;
}
function candidateOptions(candidates: { id: string; name: string }[]) {
  return candidates
    .map((c) => `<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.id)}</option>`)
    .join('');
}
function collectionGroups() {
  return [...new Set(project?.themes.map((theme) => theme.group) ?? [])];
}
function browserToolbar() {
  const groups = collectionGroups();
  const rows: Row[] = tab === 'styles' ? (preview?.styles ?? []) : (preview?.variables ?? []);
  const collectionRows = rows;
  const metadata = (group: string) => {
    const items = visibleRows(collectionRows, group, '');
    const state =
      group && !isIncluded(settings.groups, group)
        ? 'excluded'
        : (['conflicting', 'updated', 'new', 'skipped'].find((action) =>
            items.some((row) => row.action === action),
          ) ?? 'unchanged');
    const count = preview && !busy() ? String(items.length) : '—';
    const description = `${count} ${tab} · ${state === 'excluded' ? 'Excluded from sync' : state === 'unchanged' ? 'No pending changes' : `${state} output`}`;
    return `data-count="${count}" data-status="${state}" data-description="${esc(description)}"`;
  };
  const counts = {
    changed: visibleRows(rows, scope, search, 'changed').length,
    all: visibleRows(rows, scope, search).length,
  };
  return `<div class="browser-toolbar">${navigationHistory.length ? '<button class="quiet tiny" data-action="back-to-token">← Back to previous token</button>' : ''}${searchOpen || search ? `<div class="search-row"><div class="search-box">${icon('search')}<input id="token-search" type="search" placeholder="Search ${tab}…" aria-label="Search ${tab} in ${esc(scope || 'all collections')}" value="${esc(search)}"><button class="quiet icon-button" data-action="close-search" aria-label="Close and clear search" >${icon('close')}</button></div></div>` : ''}
  <div class="scope-row"><div class="scope-control"><select id="collection-scope" data-prefix="Collection" aria-label="Browse collection"${disabled(!project)}><option value="" ${metadata('')}${selected(scope, '')}>All collections</option>${groups.map((group) => `<option value="${esc(group)}" ${metadata(group)}${selected(scope, group)}>${esc(group)}${isIncluded(settings.groups, group) ? '' : ' · Excluded'}</option>`).join('')}</select></div>
  <div class="browse-filter" role="group" aria-label="Show tokens">${(['changed', 'all'] as const).map((value) => `<button data-browse-filter="${value}" aria-pressed="${browseFilter === value}" title="${value === 'changed' ? 'New, updated, or conflicting output in this collection' : 'All output in this collection'}">${value === 'changed' ? 'Changes' : 'All'}<span class="count-pill">${preview && !busy() ? counts[value] : '—'}</span></button>`).join('')}</div>
  <button class="quiet icon-button search-toggle" data-action="search" aria-label="Search tokens" aria-expanded="${searchOpen || !!search}" title="Search tokens">${icon('search')}</button></div></div>`;
}
function emptyView(title: string, description = '', action = '') {
  return `<div class="empty"><span class="empty-icon">${icon('grid')}</span><h2>${esc(title)}</h2>${description ? `<p>${esc(description)}</p>` : ''}${action}</div>`;
}
function browseEmpty(kind: 'variables' | 'styles') {
  if (busy() && !preview)
    return emptyView('Preparing your tokens', 'The preview will appear here when it is ready.');
  if (!preview)
    return emptyView(
      project ? 'Fetch a fresh preview' : 'Your tokens are one fetch away',
      'Fetch updates to inspect collections, values, and styles.',
    );
  if (scope && !isIncluded(settings.groups, scope))
    return emptyView(
      'Collection excluded',
      'Include this collection in sync to prepare its output.',
      '<button data-action="include">Choose collections</button>',
    );
  if (!settings[kind])
    return emptyView(
      `${kind === 'variables' ? 'Variable' : 'Style'} output is off`,
      'Choose this output in the Send to Figma dialog.',
      '<button data-action="send">Choose outputs</button>',
    );
  if (!search && browseFilter === 'changed' && visibleRows<Row>(preview[kind], scope, '').length)
    return emptyView(
      previewStatus(preview) === 'Up to date'
        ? 'Figma is up to date'
        : 'No changes in this collection',
      previewStatus(preview) === 'Up to date'
        ? `Every included ${kind === 'variables' ? 'variable' : 'style'} matches the source.`
        : 'There are no pending changes here. Review the export for skipped items.',
      '<button data-browse-filter="all">Show all tokens</button>',
    );
  return emptyView(
    search ? 'No matching tokens' : `No ${kind} in this collection`,
    search
      ? `No results for “${search}”. Try another name or collection.`
      : 'Review the export to see how tokens were converted.',
    search
      ? '<button data-action="clear-search">Clear search</button>'
      : '<button data-action="issues">Review export</button>',
  );
}
function valueView(value: import('../core/model').Literal | undefined, alias?: string) {
  if (value === undefined) return '<span class="muted" title="No planned value">—</span>';
  const text = formatLiteral(value),
    color = typeof value === 'object';
  const target = alias ? preview?.variables.find((row) => row.key === alias) : undefined;
  return `<span class="token-value">${color ? `<span class="swatch" style="--swatch:${text}" aria-hidden="true"></span>` : ''}${alias ? `<span class="alias-chip" aria-label="${esc(`Alias: ${target?.name ?? alias}; resolved value ${text}`)}">{${esc(target?.name ?? alias)}}</span>` : `<span>${esc(text || '""')}</span>`}</span>`;
}
function valueTrigger(row: VariableRow | StyleRow, mode: { key: string; name: string }) {
  const thumbnail =
    !('values' in row) && row.type === 'PAINT' && !row.swatch && row.data
      ? styleSpecimen(row.type, row.data)
      : undefined;
  const content =
    'values' in row
      ? valueView(row.values[mode.key]?.literal, row.values[mode.key]?.alias)
      : row.swatch
        ? valueView(row.swatch)
        : `<span class="style-summary">${esc(row.summary)}</span>`;
  const cellValue = `${thumbnail ? `<span class="gradient-thumbnail" style="${esc(thumbnail.css)}" role="img" aria-label="${esc(thumbnail.label)}"></span>` : ''}${content}`;
  const hasIssue = preview?.diagnostics.some(
    (diagnostic) =>
      diagnostic.token === row.path &&
      (diagnostic.level === 'warning' || diagnostic.level === 'error'),
  );
  if (row.action === 'unchanged' && !hasIssue)
    return `<span class="value-display">${cellValue}</span>`;
  return `<button class="value-trigger" data-value="${esc(JSON.stringify([row.key, mode.key]))}" aria-label="${esc(`Inspect ${row.name}, ${mode.name}`)}" aria-haspopup="dialog" aria-controls="value-inspector" aria-expanded="false">${cellValue}</button>`;
}
function comparisonValue(value: unknown): string {
  if (value === undefined) return '<span class="muted">Not present</span>';
  if (record(value) && value.type === 'VARIABLE_ALIAS')
    return `<span class="comparison-alias">Alias: ${esc(value.name)} <small>(${esc(String(value.id).startsWith('pending:') ? 'new target' : value.id)})</small></span>`;
  if (record(value) && ['r', 'g', 'b'].every((key) => typeof value[key] === 'number'))
    return valueView({
      r: value.r as number,
      g: value.g as number,
      b: value.b as number,
      a: typeof value.a === 'number' ? value.a : 1,
    });
  return `<span>${esc(typeof value === 'object' ? JSON.stringify(value) : value === '' ? '""' : value)}</span>`;
}
function diffView(row: Row): string {
  const changes = row.changes ?? [];
  const changed = changes.filter((change) => change.changed);
  const unchanged = changes.filter((change) => !change.changed);
  const table = (items: typeof changes) =>
    `<table class="comparison-table"><thead><tr><th>Property / mode</th><th>Current Figma</th><th>Repository proposal</th></tr></thead><tbody>${items.map((change) => `<tr><th>${esc(change.field)}<small>${esc(change.kind)}</small></th><td>${comparisonValue(change.before)}</td><td>${comparisonValue(change.after)}</td></tr>`).join('')}</tbody></table>`;
  return `${changed.length ? table(changed) : ''}${unchanged.length ? `<details class="unchanged-properties"><summary>${unchanged.length} unchanged ${unchanged.length === 1 ? 'property' : 'properties'}</summary>${table(unchanged)}</details>` : ''}`;
}
function specimenView(row: StyleRow) {
  const specimen = row.data ? styleSpecimen(row.type, row.data) : undefined;
  return specimen
    ? `<figure class="style-specimen"><div class="specimen-stage"><div class="specimen-object ${row.type === 'PAINT' ? 'paint-specimen' : ''}" style="${esc(specimen.css)}" role="img" aria-label="${esc(specimen.label)}"></div></div><figcaption>${esc(specimen.label)}</figcaption></figure>`
    : '';
}
function rowDetails(row: VariableRow | StyleRow) {
  const notes = preview?.diagnostics.filter((diagnostic) => diagnostic.token === row.path) ?? [];
  const bindings =
    'values' in row
      ? Object.entries(row.values)
          .filter(([, value]) => value.alias)
          .map(([mode, value]) => ({
            label:
              preview?.collections
                .find((collection) => collection.name === row.group)
                ?.modes.find((item) => item.key === mode)?.name ?? mode,
            key: value.alias!,
          }))
      : row.bindings.map((binding) => ({ label: binding.field, key: binding.variable }));
  return `<div class="row-details">${'values' in row ? '' : specimenView(row)}${diffView(row)}<div class="detail-label">${esc(row.type)} · ${esc(row.action)}</div><code>${esc(row.name)}</code><p class="small">Source: ${esc(row.group)} / ${esc(row.path)}</p>${row.description ? `<p>${esc(row.description)}</p>` : ''}${
    'values' in row
      ? `<dl class="detail-values">${Object.entries(row.values)
          .map(
            ([mode, value]) =>
              `<div><dt>${esc(preview?.collections.find((collection) => collection.name === row.group)?.modes.find((item) => item.key === mode)?.name ?? mode)}</dt><dd>${esc(formatLiteral(value.literal))}</dd></div>`,
          )
          .join('')}</dl>`
      : ''
  }${bindings
    .map((binding) => {
      const target = preview?.variables.find((item) => item.key === binding.key);
      return `<p class="reference-detail">${icon('link')} ${esc(binding.label)} → ${target ? `<button class="alias-chip" data-open-token="${esc(target.key)}" data-origin-token="${esc(row.key)}">{${esc(target.group)} / ${esc(target.name)}}</button>` : esc(binding.key)}</p>`;
    })
    .join(
      '',
    )}${row.reason ? `<p>${esc(row.reason)}</p>` : ''}${notes.map((note) => `<p class="${note.level === 'error' ? 'error-color' : 'muted'}">${esc(note.message)}</p>`).join('')}${row.action === 'conflicting' ? '<button class="tiny" data-action="conflicts">Resolve conflict</button>' : ''}</div>`;
}
function moreView(total: number) {
  return total > rowLimit
    ? `<button class="load-more" data-action="more">Show more · ${total - rowLimit} remaining</button>`
    : '';
}
function globalBrowseView(rows: (VariableRow | StyleRow)[]) {
  return `<div class="table-scroll global-results" data-scroll="table" tabindex="0" role="region" aria-label="Results across all collections">${collectionGroups()
    .map((group) => {
      const matches = rows.slice(0, rowLimit).filter((row) => row.group === group);
      if (!matches.length) return '';
      return `<section><h2 class="detail-label">${esc(group)} · ${esc(tab)}</h2>${matches.map((row) => `<div class="change"><button class="token-name" data-open-token="${esc(row.key)}">${esc(row.name)} <span class="row-status">${esc(row.action)}</span></button><p class="small">${esc(row.type)}${'theme' in row ? ' · ' + esc(row.theme) : ''}</p></div>`).join('')}</section>`;
    })
    .join('')}${moreView(rows.length)}</div>`;
}
function variableView() {
  const rows = visibleRows(preview?.variables ?? [], scope, search, browseFilter);
  if (!rows.length) return browseEmpty('variables');
  if (!scope) return globalBrowseView(rows);
  const modes = preview?.collections.find((collection) => collection.name === scope)?.modes ?? [];
  return `<div class="table-scroll" data-scroll="table" tabindex="0" role="region" aria-label="Scrollable token values"><table class="token-table" style="--mode-count:${modes.length}"><caption class="sr-only">Planned variables in ${esc(scope)}</caption><thead><tr><th scope="col" class="name-column">Token name <span class="muted">${rows.length}</span></th>${modes.map((mode) => `<th scope="col" title="${esc(mode.name)}">${esc(mode.name)}</th>`).join('')}</tr></thead><tbody>${rows
    .slice(0, rowLimit)
    .map(
      (row) =>
        `<tr class="token-row state-${row.action}"><th scope="row" class="name-column"><button class="token-name" data-row="${esc(row.key)}" aria-expanded="${expandedRows.has(row.key)}" title="${esc(row.name)} · ${esc(row.action)}"><span class="sr-only">${esc(row.action)} · </span><span class="row-chevron ${expandedRows.has(row.key) ? 'expanded' : ''}">${icon('chevron')}</span><span>${esc(row.name)}</span>${row.action !== 'unchanged' ? `<span class="row-status" aria-hidden="true">${esc(row.action)}</span>` : ''}${row.action === 'conflicting' ? '<span class="error-color" aria-label="Conflict">!</span>' : ''}</button></th>${modes.map((mode) => `<td>${valueTrigger(row, mode)}</td>`).join('')}</tr>${expandedRows.has(row.key) ? `<tr class="detail-row"><td colspan="${modes.length + 1}">${rowDetails(row)}</td></tr>` : ''}`,
    )
    .join('')}</tbody></table>${moreView(rows.length)}</div>`;
}
function styleView() {
  const rows = visibleRows(preview?.styles ?? [], scope, search, browseFilter);
  if (!rows.length) return browseEmpty('styles');
  if (!scope) return globalBrowseView(rows);
  return `<div class="table-scroll" data-scroll="table" tabindex="0" role="region" aria-label="Scrollable token values"><table class="token-table style-table"><caption class="sr-only">Planned styles in ${esc(scope)}</caption><thead><tr><th scope="col" class="name-column">Style name <span class="muted">${rows.length}</span></th><th scope="col">Preview</th></tr></thead><tbody>${rows
    .slice(0, rowLimit)
    .map(
      (row) =>
        `<tr class="token-row state-${row.action}"><th scope="row" class="name-column"><button class="token-name" data-row="${esc(row.key)}" aria-expanded="${expandedRows.has(row.key)}" title="${esc(row.name)} · ${esc(row.action)}"><span class="sr-only">${esc(row.action)} · </span><span class="row-chevron ${expandedRows.has(row.key) ? 'expanded' : ''}">${icon('chevron')}</span><span>${esc(row.path)}</span>${row.action !== 'unchanged' ? `<span class="row-status" aria-hidden="true">${esc(row.action)}</span>` : ''}</button><span class="style-context">${esc(row.type === 'TEXT' ? 'Text' : row.type === 'EFFECT' ? 'Effect' : 'Paint')} · ${esc(row.theme)}</span></th><td>${valueTrigger(row, { key: 'style', name: row.theme })}</td></tr>${expandedRows.has(row.key) ? `<tr class="detail-row"><td colspan="2">${rowDetails(row)}</td></tr>` : ''}`,
    )
    .join('')}</tbody></table>${moreView(rows.length)}</div>`;
}
function sourceDetails(path: string, code: string) {
  const definitions = Object.entries(project?.sets ?? {}).flatMap(([set, tokens]) =>
    tokens.filter((token) => token.path === path).map((token) => ({ set, token })),
  );
  return `<div class="source-details" aria-label="Source details"><p class="small">Code <code>${esc(code)}</code></p>${definitions.map(({ set, token }) => `<p>${esc(set)} · ${esc(token.type)}</p><pre class="source-token-value">${esc(JSON.stringify(token.value, null, 2))}</pre>`).join('')}</div>`;
}
function diagnosticsView() {
  if (!preview) return '';
  const grouped = groupDiagnostics(preview.diagnostics);
  if (!grouped.length && !preview.missing.length) return '<p>No export issues found.</p>';
  return `${(['error', 'warning', 'info'] as const)
    .map((level) => {
      const entries = grouped.filter((d) => d.level === level);
      if (!entries.length) return '';
      const label =
        level === 'info' ? 'Conversion notes' : level === 'error' ? 'Errors' : 'Warnings';
      return `<section class="diagnostics"><h3>${label}</h3>${entries
        .map((d) => {
          const modes = d.themes.map(
            (id) => project?.themes.find((theme) => theme.id === id)?.name ?? id,
          );
          const detailKey = JSON.stringify([level, d.code, d.token]);
          const expanded = openDiagnosticDetails === detailKey;
          return `<div class="diagnostic ${level}">${d.token ? `<strong>${esc(d.token)}${modes.length ? ` <span class="muted">· ${esc(modes.join(', '))}</span>` : ''}</strong>` : ''}${d.messages.map((message) => `<p>${esc(message)}</p>`).join('')}${d.token ? `<button class="quiet tiny" data-diagnostic-token="${esc(detailKey)}" aria-expanded="${expanded}">${expanded ? 'Hide source details' : 'View source details'}</button>${expanded ? sourceDetails(d.token, d.code) : ''}` : ''}</div>`;
        })
        .join('')}</section>`;
    })
    .join('')}${
    preview.missing.length
      ? `<details class="diagnostics" data-disclosure="missing"><summary>${preview.missing.length} previously synced items outside this export</summary><p class="small">Review conflicts to confirm any renamed items.</p>${preview.missing
          .map(
            (m) =>
              `<div class="diagnostic">${esc(m.kind)} · ${esc(m.group)} / ${esc(m.path)}</div>`,
          )
          .join('')}</details>`
      : ''
  }${preview.diagnostics.some((d) => d.code === 'MISSING_FONT') ? '<button data-action="check-fonts">Check fonts again</button>' : ''}`;
}
function reportView() {
  if (!report) return '';
  return `<section class="sync-result">
  <p class="result-status" role="status">${esc(reportTitle(report))}</p>
  <dl class="report-grid">${(['created', 'updated', 'unchanged', 'skipped', 'failed'] as const).map((key) => `<div><dt>${key}</dt><dd>${report![key]}</dd></div>`).join('')}</dl>
  ${report.cancelled ? '<p>Completed changes are saved. Fetch a new preview to resume.</p>' : ''}
  ${reportHasIssues(report) ? '<p>To revert the last sync immediately, use Figma Undo before making other edits.</p>' : ''}
  ${report.diagnostics.length ? `<ul class="result-issues" aria-label="Sync diagnostics">${report.diagnostics.map((d) => `<li>${d.token ? `<strong>${esc(d.token)}</strong> ` : ''}<span class="${d.level === 'error' ? 'error-color' : 'muted'}">${esc(d.message)}</span></li>`).join('')}</ul>` : ''}
  <details class="result-details"><summary>Sync details</summary>
    <p>Revision ${esc(report.revision ?? 'Unknown revision')}${report.completedAt ? ' · ' + esc(new Date(report.completedAt).toLocaleString()) : ''}</p>
    ${report.groups?.length ? `<p>Collections: ${esc(report.groups.join(', '))}</p>` : ''}
    <p>${report.preserveMetadata === false ? 'Token descriptions were applied to synced outputs. Existing identities and node bindings are preserved.' : 'Existing identities and local descriptions are preserved.'}</p>
  </details>
  </section>`;
}
function missingTargets() {
  return [...(preview?.collections ?? []), ...(preview?.variables ?? [])].filter(
    (row) => row.action === 'conflicting' && row.missingTarget,
  );
}
function sendSelection() {
  const groups = collectionGroups();
  const themes = project?.themes ?? [];
  const selectedIds = new Set(
    themes
      .filter(
        (t) => isIncluded(settings.groups, t.group) && !settings.excludedThemeIds?.includes(t.id),
      )
      .map((t) => t.id),
  );
  return { groups, themes, selectedIds };
}
function sendBlocked() {
  return (
    demo ||
    !sendSelection().selectedIds.size ||
    busy() ||
    !preview?.canSync ||
    conflictCount(preview) > 0 ||
    (!settings.variables && !settings.styles)
  );
}
function sendLabel() {
  return phase === 'syncing'
    ? 'Sending…'
    : demo
      ? 'Preview only'
      : sample
        ? 'Apply sample to this file'
        : 'Send to Figma';
}
function sendFeedbackView() {
  return `<p class="small" role="status">${phase === 'previewing' ? 'Updating preview…' : preview ? `${changeCount(preview)} pending changes.` : 'Preview unavailable.'}</p><div class="send-review-actions"><button class="quiet tiny" data-action="issues"${preview?.diagnostics.length ? '' : ' style="visibility:hidden"'}${disabled()}>${omittedCount(preview) ? 'Review skipped values' : 'Review export'}</button><button class="quiet tiny error-color" data-action="conflicts"${conflictCount(preview) ? '' : ' style="visibility:hidden"'}${disabled()}>Resolve conflicts</button></div>`;
}
function updateSendDialog(modal: HTMLDialogElement) {
  const { themes, selectedIds } = sendSelection();
  for (const input of modal.querySelectorAll<HTMLInputElement>('.send-groups input')) {
    const options = input.dataset.sendAll
      ? themes
      : input.dataset.group !== undefined
        ? themes.filter((theme) => theme.group === input.dataset.group)
        : themes.filter((theme) => theme.id === input.dataset.sendTheme);
    const count = options.filter((theme) => selectedIds.has(theme.id)).length;
    input.checked = count > 0 && count === options.length;
    input.indeterminate = count > 0 && count < options.length;
    input.disabled = busy() && phase !== 'previewing';
  }
  const feedback = modal.querySelector<HTMLElement>('[data-send-feedback]')!;
  const markup = sendFeedbackView();
  if (feedback.innerHTML !== markup) feedback.innerHTML = markup;
  const errors = modal.querySelector<HTMLElement>('[data-send-error]')!;
  if (errors.innerHTML !== errorView()) errors.innerHTML = errorView();
  modal.querySelector<HTMLButtonElement>('[data-action="close-dialog"]')!.disabled = busy();
  const confirm = modal.querySelector<HTMLButtonElement>('[data-action="confirm-send"]')!;
  confirm.disabled = sendBlocked();
  confirm.textContent = sendLabel();
}
function sendDialogView() {
  if (!dialog) return '';
  if (phase === 'syncing')
    return `<dialog class="sync-dialog sync-progress-dialog" aria-labelledby="dialog-title"><header class="dialog-heading"><h2 id="dialog-title">Sending to Figma</h2></header><div class="dialog-body">${progressView()}<p class="small">Creating and updating your selected variables and styles.</p></div><footer class="dialog-footer"><button data-action="cancel">Stop sync</button></footer></dialog>`;
  if (dialog === 'branch')
    return `<dialog class="sync-dialog" aria-labelledby="dialog-title"><header class="dialog-heading"><h2 id="dialog-title">Switch branch</h2><button class="quiet icon-button" data-action="close-dialog" aria-label="Close branch switcher"${disabled()}>${icon('close')}</button></header><form id="branch-form"><div class="dialog-body"><label class="field"><span>Branch name</span><input id="branch-name" value="${esc(branchDraft)}" required autocapitalize="off" autocomplete="off" spellcheck="false"${disabled()}></label>${progressView()}${error ? `<div class="notice error" role="alert">${esc(error)}</div>` : ''}</div><footer class="dialog-footer">${busy() ? '<button type="button" data-action="cancel">Stop</button>' : '<button type="button" data-action="close-dialog">Cancel</button>'}<button type="submit" class="primary" data-action="switch-branch"${disabled()}>Switch branch</button></footer></form></dialog>`;
  if (dialog === 'issues' || dialog === 'conflicts') {
    const conflicts = [
      ...(preview?.collections ?? []),
      ...(preview?.variables ?? []),
      ...(preview?.styles ?? []),
    ].filter((row) => row.action === 'conflicting');
    const missing = missingTargets();
    const recovery = missing.length
      ? `<section class="change"><strong>Deleted from Figma</strong><p>${missing.length} previously synced items are missing. Stage them for recreation with new Figma IDs. Changes are applied when you send to Figma.</p><button data-action="recreate-missing"${disabled()}>Recreate ${missing.length} missing items</button></section>`
      : '';
    return `<dialog class="sync-dialog" aria-labelledby="dialog-title"><header class="dialog-heading"><h2 id="dialog-title">${dialog === 'issues' ? 'Export review' : 'Resolve conflicts'}</h2><button class="quiet icon-button" data-action="close-dialog" aria-label="Close details">${icon('close')}</button></header><div class="dialog-body" data-scroll="dialog">${dialog === 'issues' ? diagnosticsView() : recovery + conflicts.map((row) => `<details class="change"><summary>${esc(row.name)}</summary>${conflictControls(row)}${diffView(row)}</details>`).join('') || '<p>No unresolved conflicts.</p>'}</div></dialog>`;
  }
  if (dialog === 'report')
    return `<dialog class="sync-dialog result-dialog" aria-labelledby="dialog-title"><header class="dialog-heading"><h2 id="dialog-title">Last sync result</h2><button class="quiet icon-button" data-action="close-dialog" aria-label="Close result">${icon('close')}</button></header><div class="dialog-body" data-scroll="dialog">${reportView()}</div></dialog>`;
  const { groups, themes, selectedIds } = sendSelection();
  function selectionState(count: number, total: number) {
    return (
      checked(count > 0 && count === total) +
      (count > 0 && count < total ? ' data-mixed' : '') +
      disabled(busy() && phase !== 'previewing')
    );
  }
  const tree = groups
    .map((group) => {
      const options = themes.filter((t) => t.group === group);
      const count = options.filter((t) => selectedIds.has(t.id)).length;
      return `<div class="send-group"><label class="inclusion-row"><input type="checkbox" data-group="${esc(group)}"${selectionState(count, options.length)}><span>${esc(group)}</span></label>${options.map((t) => `<label class="inclusion-row send-option"><input type="checkbox" data-send-theme="${esc(t.id)}"${checked(selectedIds.has(t.id))}${disabled(busy() && phase !== 'previewing')}><span>${esc(t.name)}</span></label>`).join('')}</div>`;
    })
    .join('');
  return `<dialog class="sync-dialog" data-send-dialog aria-labelledby="dialog-title" aria-describedby="send-description"><header class="dialog-heading"><h2 id="dialog-title">${demo ? 'Export preview' : 'Send to Figma'}</h2><button class="quiet icon-button" data-action="close-dialog" aria-label="Close export options"${disabled()}>${icon('close')}</button></header><div class="dialog-body" data-scroll="dialog"><p id="send-description">Choose which themes to send to Figma.</p>${sample ? `<p class="small">${demo ? 'Browser preview only. Nothing will be written to Figma.' : 'Sample tokens will be written to this Figma file.'}</p>` : ''}<section class="send-groups" aria-label="Theme groups and options" data-scroll="send-options"><label class="inclusion-row send-group-heading"><input type="checkbox" data-send-all="all"${selectionState(selectedIds.size, themes.length)}><span>All ${groups.length} theme group${groups.length === 1 ? '' : 's'}, ${themes.length} option${themes.length === 1 ? '' : 's'}</span></label>${tree}</section><div data-send-error>${errorView()}</div><div class="send-feedback" data-send-feedback>${sendFeedbackView()}</div></div><footer class="dialog-footer"><button class="primary" data-action="confirm-send"${disabled(sendBlocked())}>${sendLabel()}</button></footer></dialog>`;
}
async function closeDialog() {
  if (dialog === 'branch') {
    dialog = undefined;
    error = '';
    recoveryField = '';
    phase = preview ? 'ready' : 'connected';
    render();
    focusAction('open-branch');
    return;
  }
  if ((dialog === 'issues' || dialog === 'conflicts') && settingsBeforeSend) {
    dialog = 'send';
    render();
    return;
  }
  const restore = dialog === 'send' ? settingsBeforeSend : undefined;
  dialog = undefined;
  settingsBeforeSend = undefined;
  if (restore && JSON.stringify(settings) !== JSON.stringify(restore)) {
    settings = restore;
    await refreshPreview();
  } else render();
  focusAction('send');
}
async function openSend(output?: 'variables' | 'styles') {
  settingsBeforeSend = structuredClone(settings);
  dialog = 'send';
  sendMenuOpen = false;
  if (
    settings.variables !== (output !== 'styles') ||
    settings.styles !== (output !== 'variables')
  ) {
    settings.variables = output !== 'styles';
    settings.styles = output !== 'variables';
    await refreshPreview();
  } else render();
}
function branchMenuView() {
  if (!branchMenu || !connection) return '';
  const { result, failed } = branchMenu;
  const active = connection.branch;
  const names = [...new Set([active, ...(result?.names ?? [])])];
  return `<div class="menu branch-menu" id="branch-options" aria-label="Repository branches" data-scroll="branches">${names.map((name) => `<button class="branch-option" data-action="choose-branch" data-branch="${esc(name)}"${name === active ? ' aria-current="true"' : ''} title="${esc(name)}"><span class="branch-check" aria-hidden="true">${name === active ? icon('check') : ''}</span><span class="branch-option-name">${esc(name)}</span>${name === result?.defaultBranch ? ' <span class="branch-default">Default</span>' : ''}</button>`).join('')}${failed ? '<p role="status">Could not load branches.</p><button data-action="manual-branch">Enter branch name…</button>' : !result ? '<p role="status">Loading branches…</p>' : ''}</div>`;
}
function mainView() {
  const groups = collectionGroups();
  if (scope && !groups.includes(scope)) scope = '';
  if (!scope && !browseAll)
    scope = groups.find((group) => isIncluded(settings.groups, group)) ?? groups[0] ?? '';
  const conflicts = conflictCount(preview);
  const issues = groupDiagnostics(preview?.diagnostics ?? []).length;
  const c = connection;
  return `<main class="main workspace companion-workspace"><section class="source-row"><span class="source-icon">${c && !sample ? providerLogo(c.provider) : icon('git')}</span><div class="source-text"><button class="source-name quiet" data-action="edit" title="Edit repository connection"${disabled()}><span>${esc(sample ? 'Sample tokens' : c?.name || c?.repository)}</span>${icon('chevron')}</button></div>${settingsMenu()}</section>
  ${tab !== 'variables' ? `<div class="secondary-heading"><button class="quiet tiny" data-tab="variables">← Variables</button><strong>Styles</strong></div>` : ''}${browserToolbar()}
  <div class="feedback">${dialog === 'branch' || phase === 'syncing' ? '' : progressView() + errorView()}${notice ? `<div class="notice info" role="status">${esc(notice)}</div>` : ''}</div>
  <section class="browser-content" aria-label="${tab === 'styles' ? 'Styles' : 'Variables'}" aria-busy="${busy()}">${tab === 'variables' ? variableView() : styleView()}</section>
  ${issues || conflicts ? `<div class="export-warnings">${conflicts ? `<button class="quiet error-color" data-action="conflicts">${conflicts} conflicts · Review</button>` : ''}${issues ? `<button class="quiet" data-action="issues">Review export <span class="count-pill">${issues}</span> ${icon('chevron')}</button>` : ''}</div>` : ''}
  </main><footer class="footer workspace-footer companion-footer"><div class="footer-row">${busy() ? `<button data-action="cancel"${disabled(phase === 'previewing')}>Stop</button>` : `<div class="source-actions"><button class="branch-button" data-action="${c && !sample ? 'open-branch' : 'edit'}" aria-label="${sample ? 'Connect repository' : c ? 'Switch branch' : 'Edit repository connection'}"${c && !sample ? ` aria-expanded="${!!branchMenu}"${branchMenu ? ' aria-controls="branch-options"' : ''}` : ''}>${icon('branch')}<span>${esc(sample ? 'Sample' : (c?.branch ?? 'main'))}</span>${icon('chevron')}</button><button class="icon-button" data-action="fetch" title="${sample ? 'Reload sample' : 'Fetch updates'}" aria-label="${sample ? 'Reload sample' : 'Fetch updates'}">${icon('refresh')}</button>${branchMenuView()}</div>`}<div class="send-actions"><button class="sync-button" data-action="send"${disabled(busy() || !project)}>${icon('arrow')}${demo ? 'Export preview' : 'Send to Figma'}</button><button class="icon-button" data-action="send-menu" aria-label="Choose output to send" aria-expanded="${sendMenuOpen}"${disabled(busy() || !project)}>${icon('chevron')}</button>${sendMenuOpen ? '<div class="menu send-menu"><button data-action="send-variables">Send variables only</button><button data-action="send-styles">Send styles only</button></div>' : ''}</div></div></footer>${sendDialogView()}`;
}
let renderedScreen = '';
const scrollMemory = new Map<string, { top: number; left: number }>();
const disclosureMemory = new Map<string, boolean>();
const focusAttributes = [
  'id',
  'name',
  'data-action',
  'data-tab',
  'data-branch',
  'data-browse-filter',
  'data-row',
  'data-open-token',
  'data-diagnostic-token',
  'data-value',
  'data-group',
  'data-choice',
  'data-skip',
  'data-repository',
  'data-setting',
  'data-send-all',
  'data-send-theme',
  'data-set',
  'data-style-theme',
  'data-parent',
  'data-candidate-search',
  'data-provider',
  'data-scroll',
];
let pendingFocus:
  | { attribute: string; value: string; start: number | null; end: number | null }
  | undefined;
function render() {
  // Keep the open dialog, focused checkbox and scroll containers mounted while
  // theme changes recalculate. Reopening a modal also resets browser focus.
  const sendDialog =
    dialog === 'send' && app.querySelector<HTMLDialogElement>('[data-send-dialog]');
  if (sendDialog && phase !== 'syncing' && !sendDialog.querySelector('[data-action="cancel"]')) {
    updateSendDialog(sendDialog);
    return;
  }
  selectMenus.beforeRender();
  valueInspector.beforeRender();
  const active = document.activeElement as HTMLInputElement | null;
  if (active && app.contains?.(active)) {
    const attribute = focusAttributes.find((name) => active.hasAttribute(name));
    if (attribute)
      pendingFocus = {
        attribute,
        value: active.getAttribute(attribute)!,
        start: active.selectionStart,
        end: active.selectionEnd,
      };
  }
  for (const element of app.querySelectorAll?.<HTMLElement>('[data-scroll]') ?? []) {
    scrollMemory.set(`${renderedScreen}:${element.dataset.scroll}`, {
      top: element.scrollTop,
      left: element.scrollLeft,
    });
  }
  for (const element of app.querySelectorAll?.<HTMLDetailsElement>('[data-disclosure]') ?? []) {
    disclosureMemory.set(`${renderedScreen}:${element.dataset.disclosure}`, element.open);
  }
  const content =
    view === 'connection' || (error && !connection && !sample)
      ? connectionView()
      : connection || sample
        ? mainView()
        : welcomeView();
  renderedScreen = view === 'main' && (connection || sample) ? `${view}:${tab}:${scope}` : view;
  app.innerHTML =
    topbar() +
    content +
    '<button class="window-resize" data-window-resize aria-label="Resize plugin window" title="Drag to resize. Arrow keys resize; Shift makes larger steps."></button>';
  const announcements = document.getElementById('announcements');
  const announcement =
    error ||
    (busy()
      ? statusLabel()
      : `${statusLabel()}.${preview ? ' ' + changeCount(preview) + ' pending changes.' : ''}${report ? ' Last result: ' + reportTitle(report) + '.' : ''}`);
  if (announcements && announcements.textContent !== announcement)
    announcements.textContent = announcement;
  const modal = app.querySelector<HTMLDialogElement>('dialog');
  if (modal) {
    for (const input of modal.querySelectorAll<HTMLInputElement>('[data-mixed]'))
      input.indeterminate = true;
    modal.showModal?.();
    modal.addEventListener('cancel', (event) => {
      event.preventDefault();
      if (!busy()) void closeDialog();
    });
  }
  selectMenus.mount();
  for (const element of app.querySelectorAll?.<HTMLElement>('[data-scroll]') ?? []) {
    const position = scrollMemory.get(`${renderedScreen}:${element.dataset.scroll}`);
    if (position) {
      element.scrollTop = position.top;
      element.scrollLeft = position.left;
    }
  }
  for (const element of app.querySelectorAll?.<HTMLDetailsElement>('[data-disclosure]') ?? []) {
    const open = disclosureMemory.get(`${renderedScreen}:${element.dataset.disclosure}`);
    if (open !== undefined) element.open = open;
  }
  if (pendingFocus) {
    const focus = pendingFocus;
    const replacement = [
      ...(app.querySelectorAll?.<HTMLInputElement>(`[${focus.attribute}]`) ?? []),
    ].find((element) => element.getAttribute(focus.attribute) === focus.value);
    if (replacement && !replacement.disabled) {
      replacement.focus({ preventScroll: true });
      if (
        focus.start !== null &&
        focus.start !== undefined &&
        ['text', 'search', 'password', 'url'].includes(replacement.type)
      )
        replacement.setSelectionRange(focus.start, focus.end);
      pendingFocus = undefined;
    } else if (!busy()) {
      if (['data-choice', 'data-skip', 'data-candidate-search'].includes(focus.attribute)) {
        app
          .querySelector<HTMLElement>('[data-choice], [data-skip], #change-filter')
          ?.focus({ preventScroll: true });
      } else if (focus.attribute === 'data-action' && focus.value === 'more') {
        app
          .querySelector<HTMLElement>('[data-scroll="table"], [data-scroll="changes"]')
          ?.focus({ preventScroll: true });
      }
      pendingFocus = undefined;
    }
  }
}
function resetBrowse() {
  browseAll = false;
  navigationHistory.length = 0;
  scope = '';
  search = '';
  searchOpen = false;
  browseFilter = 'all';
  tab = settings.variables ? 'variables' : 'styles';
  rowLimit = 60;
  expandedRows.clear();
  scrollMemory.clear();
  disclosureMemory.clear();
}
function focusAction(action: string) {
  app.querySelector<HTMLElement>(`[data-action="${action}"]`)?.focus();
}
function showError(cause: unknown) {
  let message = cause instanceof Error ? cause.message : safeError(cause);
  for (const token of [connection?.token, draft.token])
    if (token) message = message.split(token).join('[redacted]');
  const code = cause instanceof ProviderError ? cause.code : '';
  recoveryField = ['HTTP_401', 'HTTP_403'].includes(code)
    ? 'token'
    : ['PATH', 'NO_FILES'].includes(code)
      ? 'path'
      : code === 'HTTP_404'
        ? 'repository'
        : '';
  error = message;
  if (phase === 'previewing' || phase === 'syncing') preview = undefined;
  phase = 'error';
  render();
}
let previewRefresh: Promise<void> | undefined;
let previewRevision = 0;
let previewNeedsProject = false;
function refreshPreview(includeProject = false): Promise<void> {
  if (!project) return Promise.resolve();
  previewRevision++;
  previewNeedsProject ||= includeProject;
  phase = 'previewing';
  progress = { text: 'Resolving tokens and checking local mappings…', done: 0, total: 0 };
  render();
  // The plugin processes one preview at a time. Coalesce rapid selections and
  // never enable Send for a response that predates the latest selection.
  previewRefresh ??= (async () => {
    try {
      while (true) {
        const revision = previewRevision;
        const include = previewNeedsProject;
        previewNeedsProject = false;
        let result: Preview;
        try {
          result = await rpc('preview', { ...(include ? { project } : {}), settings, choices });
        } catch (cause) {
          if (revision !== previewRevision) continue;
          throw cause;
        }
        if (revision !== previewRevision) continue;
        preview = result;
        phase = 'ready';
        error = '';
        render();
        return;
      }
    } finally {
      previewRefresh = undefined;
    }
  })();
  return previewRefresh;
}
async function connectRepository(input: Connection) {
  const normalized = normalizeConnection(input);
  abort = new AbortController();
  phase = 'fetching';
  progress = { text: 'Checking repository access…', done: 0, total: 0 };
  notice = '';
  error = '';
  render();
  const candidate = repositoryClient(normalized);
  const snapshot = await candidate.fetch((text, done = 0, total = 0) => {
    progress = { text, done, total };
    updateProgress();
  }, abort.signal);
  const loadedProject = parseRepository(snapshot);
  await rpc('saveConnection', { connection: normalized });
  connection = normalized;
  client = candidate;
  sample = false;
  project = loadedProject;
  choices = {};
  preview = undefined;
  settings.groups = [];
  settings.excludedThemeIds = [];
  settings.sets = [];
  settings.styleThemes = [];
  resetBrowse();
  dialog = undefined;
  view = 'main';
  phase = 'connected';
  abort = undefined;
  await refreshPreview(true);
  render();
}
async function fetchTokens() {
  if (busy()) return;
  preview = undefined;
  error = '';
  notice = '';
  phase = 'fetching';
  progress = { text: 'Checking repository access…', done: 0, total: 0 };
  render();
  abort = new AbortController();
  try {
    if (sample)
      project = parseRepository({
        identity: 'blueprint:sample',
        revision: 'sample-v1',
        fetchedAt: new Date().toISOString(),
        files: {
          'tokens.json': JSON.stringify(
            demo && new URLSearchParams(location.search).get('demo') === 'stress'
              ? uiStressFixture()
              : fixture,
          ),
        },
        singleFile: 'tokens.json',
        layout: 'bundle',
      });
    else {
      if (!connection) throw new Error('Configure a repository first.');
      client ??= repositoryClient(connection);
      const snapshot = await client.fetch((text, done = 0, total = 0) => {
        progress = { text, done, total };
        updateProgress();
      }, abort.signal);
      project = parseRepository(snapshot);
    }
    choices = {};
    await refreshPreview(true);
  } catch (cause) {
    preview = undefined;
    showError(cause);
  } finally {
    abort = undefined;
  }
}
async function sync() {
  if (!preview?.canSync || conflictCount(preview) || busy()) return;
  const sent = preview;
  phase = 'syncing';
  error = '';
  notice = '';
  progress = { text: 'Checking fonts and preview freshness…', done: 0, total: 0 };
  render();
  try {
    report = await rpc('sync', { planId: sent.id });
    // Re-evaluate creation against the mappings saved by this send, including partial runs.
    for (const row of [...sent.collections, ...sent.variables, ...sent.styles]) {
      if (choices[row.key] === 'create') delete choices[row.key];
    }
    dialog = 'report';
    settingsBeforeSend = undefined;
    preview = undefined;
    await refreshPreview();
  } catch (cause) {
    preview = undefined;
    showError(cause);
  }
}
app.addEventListener('input', (event) => {
  const input = event.target as HTMLInputElement;
  if (input.name && (input.name === 'name' || input.name in draft))
    (draft as any)[input.name] = input.type === 'checkbox' ? input.checked : input.value;
  if (input.id === 'branch-name') branchDraft = input.value;
  if (input.id === 'repository-url') repositoryURL = input.value;
  if (input.id === 'token-search') {
    search = input.value;
    rowLimit = 60;
    for (const key of scrollMemory.keys()) if (key.startsWith('main:')) scrollMemory.delete(key);
    render();
  }
  if (input.dataset.candidateSearch) {
    const key = input.dataset.candidateSearch,
      row = [
        ...(preview?.collections ?? []),
        ...(preview?.variables ?? []),
        ...(preview?.styles ?? []),
      ].find((r) => r.key === key);
    const select = [...app.querySelectorAll<HTMLSelectElement>('[data-choice]')].find(
      (s) => s.dataset.choice === key,
    );
    if (select && row?.candidates)
      select.innerHTML =
        '<option value="">Choose a safe recovery…</option><option value="skip">Skip this item</option><option value="create">Create a new local target</option>' +
        candidateOptions(
          row.candidates
            .filter((c) => `${c.name} ${c.id}`.toLowerCase().includes(input.value.toLowerCase()))
            .slice(0, 100),
        );
    selectMenus.refresh();
  }
});
app.addEventListener('change', async (event) => {
  const input = event.target as HTMLInputElement;
  try {
    if (input.name && (input.name === 'name' || input.name in draft))
      (draft as any)[input.name] = input.type === 'checkbox' ? input.checked : input.value;
    if (
      project &&
      (input.dataset.sendAll || input.dataset.group || input.dataset.sendTheme !== undefined)
    ) {
      const { themes } = project;
      const selected = themes.filter((theme) => {
        const affected =
          input.dataset.sendAll ||
          input.dataset.group === theme.group ||
          input.dataset.sendTheme === theme.id;
        return affected
          ? input.checked
          : isIncluded(settings.groups, theme.group) &&
              !settings.excludedThemeIds?.includes(theme.id);
      });
      const groups = [...new Set(selected.map((t) => t.group))];
      settings.groups =
        groups.length === collectionGroups().length ? [] : groups.length ? groups : ['__none__'];
      const ids = new Set(selected.map((t) => t.id));
      settings.excludedThemeIds = themes
        .filter((t) => groups.includes(t.group) && !ids.has(t.id))
        .map((t) => t.id);
      await refreshPreview();
    }
    if (input.dataset.choice) {
      const collection = preview?.collections.find((c) => c.key === input.dataset.choice);
      if (input.value === 'skip' && collection && project)
        settings.groups = toggleList(
          settings.groups,
          [...new Set(project.themes.map((t) => t.group))],
          collection.name,
          false,
        );
      else choices[input.dataset.choice] = input.value;
      await refreshPreview();
    }
    if (input.id === 'collection-scope') {
      scope = input.value;
      browseAll = !scope;
      rowLimit = 60;
      render();
    }
  } catch (cause) {
    showError(cause);
  }
});
app.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!button) {
    if (branchMenu && !(event.target as HTMLElement).closest('.source-actions')) {
      closeBranchMenu();
      render();
    }
    if (
      (menuOpen || sendMenuOpen) &&
      !(event.target as HTMLElement).closest('.menu-anchor, .send-actions')
    ) {
      sendMenuOpen = false;
      menuOpen = false;
      render();
    }
    return;
  }
  if (button.disabled) return;
  if (button.dataset.value) {
    valueInspector.open(button, true);
    return;
  }
  if (
    busy() &&
    ![
      'cancel',
      'more',
      'conflicts',
      'issues',
      'report',
      'clear-search',
      'close-search',
      'search',
      'theme',
    ].includes(button.dataset.action ?? '') &&
    !button.dataset.row &&
    !button.dataset.tab &&
    !button.dataset.browseFilter
  )
    return;
  if (button.dataset.action !== 'menu') menuOpen = false;
  if (
    branchMenu &&
    !['open-branch', 'choose-branch', 'manual-branch'].includes(button.dataset.action ?? '')
  ) {
    closeBranchMenu();
    render();
  }
  try {
    if (button.dataset.openToken) {
      const target = [...(preview?.variables ?? []), ...(preview?.styles ?? [])].find(
        (row) => row.key === button.dataset.openToken,
      );
      if (!target) return;
      navigationHistory.push({
        tab,
        scope,
        search,
        browseAll,
        browseFilter,
        rowLimit,
        origin: button.dataset.originToken ?? '',
      });
      tab = 'values' in target ? 'variables' : 'styles';
      scope = target.group;
      browseAll = false;
      search = target.name;
      searchOpen = true;
      browseFilter = 'all';
      rowLimit = 60;
      expandedRows.add(target.key);
      render();
      const targetButton = [...(app.querySelectorAll<HTMLButtonElement>('[data-row]') ?? [])].find(
        (element) => element.dataset.row === target.key,
      );
      targetButton?.focus();
      targetButton?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (button.dataset.action === 'back-to-token') {
      const previous = navigationHistory.pop();
      if (!previous) return;
      ({ tab, scope, search, browseAll, browseFilter, rowLimit } = previous);
      searchOpen = !!search;
      render();
      const originButton = [...(app.querySelectorAll<HTMLButtonElement>('[data-row]') ?? [])].find(
        (element) => element.dataset.row === previous.origin,
      );
      originButton?.focus();
      originButton?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (button.dataset.diagnosticToken) {
      openDiagnosticDetails =
        openDiagnosticDetails === button.dataset.diagnosticToken
          ? ''
          : button.dataset.diagnosticToken;
      dialog = 'issues';
      render();
      return;
    }
    if (button.dataset.row) {
      if (expandedRows.has(button.dataset.row)) expandedRows.delete(button.dataset.row);
      else expandedRows.add(button.dataset.row);
      render();
      return;
    }
    if (button.dataset.provider) {
      const nextProvider = button.dataset.provider as Connection['provider'];
      if (nextProvider === draft.provider) return;
      if (nextProvider === 'gitlab') {
        draft.repository = [draft.owner, draft.repository].filter(Boolean).join('/');
        draft.owner = '';
      } else if (draft.repository.includes('/')) {
        const parts = draft.repository.split('/');
        draft.repository = parts.pop()!;
        draft.owner = parts.join('/');
      }
      draft.provider = nextProvider;
      draft.baseUrl = '';
      draft.token = '';
      render();
      return;
    }
    if (button.dataset.tab) {
      if (!['variables', 'styles'].includes(button.dataset.tab)) return;
      tab = button.dataset.tab;
      rowLimit = 60;
      render();
      return;
    }
    if (button.dataset.browseFilter) {
      browseFilter = button.dataset.browseFilter;
      rowLimit = 60;
      render();
      return;
    }
    if (button.dataset.skip) {
      const collection = preview?.collections.find((c) => c.key === button.dataset.skip);
      if (collection && project)
        settings.groups = toggleList(
          settings.groups,
          [...new Set(project.themes.map((t) => t.group))],
          collection.name,
          false,
        );
      else choices[button.dataset.skip] = 'skip';
      await refreshPreview();
      return;
    }
    if (button.dataset.repository) {
      choices[button.dataset.repository] = 'repository';
      await refreshPreview();
      return;
    }
    switch (button.dataset.action) {
      case 'send':
        await openSend();
        break;
      case 'send-variables':
      case 'send-styles':
        await openSend(button.dataset.action === 'send-variables' ? 'variables' : 'styles');
        break;
      case 'send-menu':
        sendMenuOpen = !sendMenuOpen;
        render();
        break;
      case 'close-dialog':
        await closeDialog();
        break;
      case 'confirm-send':
        if (!demo && dialog === 'send') await sync();
        break;

      case 'check-fonts':
        await refreshPreview();
        break;
      case 'theme':
        if (demo)
          document.documentElement.dataset.previewTheme =
            document.documentElement.dataset.previewTheme === 'dark' ? 'light' : 'dark';
        break;
      case 'menu':
        menuOpen = !menuOpen;
        render();
        break;
      case 'include':
        await openSend();
        break;
      case 'clear-search':
        search = '';
        searchOpen = true;
        rowLimit = 60;
        render();
        document.getElementById('token-search')?.focus();
        break;
      case 'search':
        searchOpen = true;
        render();
        document.getElementById('token-search')?.focus();
        break;
      case 'close-search':
        search = '';
        searchOpen = false;
        rowLimit = 60;
        render();
        focusAction('search');
        break;
      case 'report':
        dialog = 'report';
        render();
        break;
      case 'recreate-missing':
        for (const row of missingTargets()) choices[row.key] = 'create';
        await refreshPreview();
        break;
      case 'conflicts':
      case 'issues':
        dialog = button.dataset.action;
        openDiagnosticDetails = '';
        render();
        break;
      case 'recover-connection':
        if (view !== 'connection' && connection) {
          draft = { ...connection };
          if (draft.provider === 'gitlab') {
            draft.repository = [draft.owner, draft.repository].filter(Boolean).join('/');
            draft.owner = '';
          }
        }
        view = 'connection';
        render();
        app.querySelector<HTMLInputElement>(`input[name="${recoveryField}"]`)?.focus();
        break;
      case 'parse-url': {
        const parsed = parseRepositoryURL(repositoryURL, draft.provider, draft.baseUrl);
        draft = {
          ...draft,
          provider: parsed.provider,
          baseUrl: parsed.baseUrl,
          owner: parsed.provider === 'gitlab' ? '' : parsed.owner,
          repository:
            parsed.provider === 'gitlab'
              ? `${parsed.owner}/${parsed.repository}`
              : parsed.repository,
          branch: parsed.branch,
          path: parsed.path,
          token: '',
          remember: false,
        };
        repositoryURL = '';
        error = '';
        notice = parsed.fileURL
          ? 'Fields filled from the URL. Check branch and path if your branch name contains slashes. Access token cleared; connection not saved.'
          : 'Repository fields filled. Find its default branch or enter one manually. Access token cleared; connection not saved.';
        render();
        break;
      }
      case 'default-branch': {
        const candidate = repositoryClient({ ...draft, branch: draft.branch || 'main' });
        abort = new AbortController();
        phase = 'fetching';
        progress = { text: 'Finding default branch…', done: 0, total: 0 };
        error = '';
        notice = '';
        render();
        draft.branch = await candidate.defaultBranch(abort.signal);
        abort = undefined;
        phase = connection ? 'connected' : 'disconnected';
        notice = 'Default branch filled. Connection not saved.';
        render();
        break;
      }
      case 'open-branch': {
        if (!connection || sample) break;
        if (branchMenu) {
          closeBranchMenu();
          render();
          break;
        }
        sendMenuOpen = false;
        const menu: BranchMenu = { request: new AbortController() };
        branchMenu = menu;
        render();
        try {
          client ??= repositoryClient(connection);
          menu.result = await client.listBranches(menu.request.signal);
        } catch {
          menu.failed = true;
        }
        if (branchMenu === menu) render();
        break;
      }
      case 'choose-branch': {
        if (!connection || !branchMenu || !button.dataset.branch) break;
        const branch = button.dataset.branch;
        closeBranchMenu();
        if (branch !== connection.branch) await connectRepository({ ...connection, branch });
        else render();
        focusAction('open-branch');
        break;
      }
      case 'manual-branch':
        if (!connection) break;
        closeBranchMenu();
        branchDraft = connection.branch;
        error = '';
        notice = '';
        dialog = 'branch';
        render();
        app.querySelector<HTMLInputElement>('#branch-name')?.select();
        break;
      case 'switch-branch':
        event.preventDefault();
        if (!connection || dialog !== 'branch') break;
        if (branchDraft.trim() === connection.branch) {
          await closeDialog();
          break;
        }
        await connectRepository({ ...connection, branch: branchDraft });
        focusAction('open-branch');
        break;
      case 'connect':
        await connectRepository(draft);
        break;
      case 'test': {
        const testClient = repositoryClient(normalizeConnection(draft));
        abort = new AbortController();
        phase = 'fetching';
        progress = { text: 'Checking repository access…', done: 0, total: 0 };
        notice = '';
        error = '';
        render();
        const tested = await testClient.fetch((text, done = 0, total = 0) => {
          progress = { text, done, total };
          updateProgress();
        }, abort.signal);
        parseRepository(tested);
        abort = undefined;
        notice = 'Connection verified. Repository, branch and token path are readable.';
        phase = connection ? 'connected' : 'disconnected';
        render();
        break;
      }
      case 'sample':
        sample = true;
        connection = undefined;
        settings = structuredClone(defaultSettings);
        resetBrowse();
        view = 'main';
        phase = 'connected';
        await fetchTokens();
        break;
      case 'fetch':
        await fetchTokens();
        break;
      case 'edit':
        draft = connection ? { ...connection } : blankConnection();
        if (draft.provider === 'gitlab') {
          draft.repository = [draft.owner, draft.repository].filter(Boolean).join('/');
          draft.owner = '';
        }
        view = 'connection';
        error = '';
        notice = '';
        render();
        break;
      case 'back':
        view = 'main';
        error = '';
        notice = '';
        render();
        focusAction('menu');
        break;
      case 'disconnect':
        await rpc('disconnect');
        view = 'main';
        connection = undefined;
        client = undefined;
        sample = false;
        project = undefined;
        preview = undefined;
        report = undefined;
        draft = blankConnection();
        resetBrowse();
        phase = 'disconnected';
        error = '';
        notice = '';
        render();
        break;
      case 'cancel':
        if (abort) abort.abort();
        if (phase === 'syncing') await rpc('cancel');
        break;
      case 'more':
        rowLimit += 60;
        render();
        break;
    }
  } catch (cause) {
    if (phase === 'fetching') abort = undefined;
    if (button.dataset.action === 'connect' && view === 'connection') {
      showError(cause);
      error = 'Connection not saved. ' + error;
      render();
    } else showError(cause);
  }
});
const windowResizer = createWindowResizer(
  app,
  () => {
    const bounds = document.body?.getBoundingClientRect();
    return bounds ? { width: bounds.width, height: bounds.height } : windowSize;
  },
  async (size, persist) => {
    windowSize = await rpc('resize', { ...size, persist });
  },
  showError,
);
app.addEventListener('keydown', (event) => {
  if (windowResizer.keydown(event)) return;
  if (valueInspector.keydown(event)) return;
  if (dialog) return;
  if (event.key === 'Escape' && branchMenu) {
    closeBranchMenu();
    render();
    focusAction('open-branch');
  } else if (event.key === 'Escape' && (menuOpen || sendMenuOpen)) {
    sendMenuOpen = false;
    const action = menuOpen ? 'menu' : 'send-menu';
    menuOpen = false;
    render();
    focusAction(action);
  } else if (event.key === 'Escape' && (searchOpen || search)) {
    search = '';
    searchOpen = false;
    rowLimit = 60;
    render();
    focusAction('search');
  }
});
app.addEventListener('submit', (event) => event.preventDefault());
window.addEventListener('pagehide', () => {
  closeBranchMenu();
  abort?.abort();
});

// The standalone browser preview uses the real parser/planner with an in-memory document.
// It never invokes a Figma write or pretends to validate a live provider.
let demoProject: TokenProject | undefined, demoPlan: import('../core/model').SyncPlan | undefined;
let demoState: import('../core/model').DocumentState = {
  identity: 'demo',
  collections: [],
  variables: [],
  styles: [],
};
async function demoRPC(type: string, data: Record<string, unknown>) {
  if (type === 'init') return { settings: defaultSettings, collections: [] };
  if (type === 'resize') {
    document.body.style.setProperty('--preview-window-width', `${data.width}px`);
    document.body.style.setProperty('--preview-window-height', `${data.height}px`);
    document.documentElement.dataset.resized = 'true';
    return { width: data.width, height: data.height };
  }
  if (type === 'preview') {
    if (data.project) demoProject = data.project as TokenProject;
    const { buildDesired } = await import('../core/desired');
    const { planSync, emptyRegistry } = await import('../sync/planner');
    demoPlan = planSync(
      await buildDesired(demoProject!, data.settings as Settings),
      demoState,
      emptyRegistry('demo'),
      data.choices as Record<string, string>,
    );
    return previewPayload(demoPlan);
  }
  if (type === 'sync')
    throw new Error(
      'This is an interface preview. Import manifest.json in Figma to sync native variables and styles.',
    );
  return true;
}
async function init() {
  try {
    const data = await rpc('init');
    windowSize = savedWindowSize(data.windowSize);
    settings = structuredClone(defaultSettings);
    if (data.connection) {
      connection = data.connection;
      draft = { ...connection! };
      phase = 'connected';
    }
    if (demo && new URLSearchParams(location.search).has('demo')) {
      sample = true;
      phase = 'connected';
      await fetchTokens();
    } else render();
  } catch (cause) {
    showError(cause);
  }
}
void init();
