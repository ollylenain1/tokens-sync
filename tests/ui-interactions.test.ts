import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { buildDesired } from '../src/core/desired';
import { TokenProject, SyncReport } from '../src/core/model';
import { emptyRegistry, planSync } from '../src/sync/planner';
import { previewPayload } from '../src/ui/preview-model';

const compiled = build({
  entryPoints: ['src/ui/app.ts'],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
});

async function openUI(
  conflicts = false,
  syncReport?: SyncReport,
  providerFetch?: typeof fetch,
  invalidToken = false,
) {
  const root = { dataset: {} as Record<string, string> };
  const windowHandlers = new Map<string, (event: any) => void>();
  const handlers = new Map<string, (event: any) => Promise<void>>();
  const requests: any[] = [];
  const fetchSignals: AbortSignal[] = [];
  let source: TokenProject | undefined;
  let hold = false;
  let fail = false;
  let release: (() => void) | undefined;
  const app = {
    innerHTML: '',
    addEventListener: (event: string, handler: (event: any) => Promise<void>) =>
      handlers.set(event, handler),
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const parent = {
    postMessage: async ({ pluginMessage }: any) => {
      const message = structuredClone(pluginMessage);
      requests.push(message);
      try {
        let result: unknown = { settings: {}, collections: [] };
        if (message.type === 'preview') {
          source = message.project ?? source;
          if (invalidToken && message.project)
            source!.sets.core.push({
              path: 'invalid-color',
              type: 'color',
              value: 'not-a-color',
              set: 'core',
              dtcg: false,
            });
          if (hold)
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          if (fail) throw new Error('Preview failed');
          const plan = planSync(
            await buildDesired(source!, message.settings),
            { identity: 'ui', collections: [], variables: [], styles: [] },
            emptyRegistry('ui'),
            message.choices,
          );
          if (conflicts) {
            const collection = plan.collections.find((row) => row.desired.name === 'Foundations')!;
            collection.action = 'conflicting';
            collection.reason = 'Two compatible local collections';
          }
          result = previewPayload(plan);
        }
        if (message.type === 'resize') result = { width: message.width, height: message.height };
        if (message.type === 'sync') {
          if (!syncReport) throw new Error('No Figma writes in this UI harness');
          result = syncReport;
        }
        queueMicrotask(() =>
          windowHandlers.get('message')!({
            data: { pluginMessage: { id: message.id, ok: true, result } },
          }),
        );
      } catch (error) {
        queueMicrotask(() =>
          windowHandlers.get('message')!({
            data: { pluginMessage: { id: message.id, ok: false, error: (error as Error).message } },
          }),
        );
      }
    },
  };
  runInNewContext((await compiled).outputFiles[0].text, {
    window: {
      parent,
      addEventListener: (event: string, handler: (event: any) => void) =>
        windowHandlers.set(event, handler),
    },
    parent,
    document: {
      documentElement: root,
      getElementById: (id: string) => (id === 'app' ? app : null),
    },
    structuredClone,
    setTimeout,
    clearTimeout,
    AbortController,
    URL,
    fetch:
      providerFetch ??
      ((_url: string, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          fetchSignals.push(options.signal);
          options.signal.addEventListener('abort', () => reject(new Error('Request stopped')));
        })),
  });
  await new Promise(setImmediate);
  const click = async (dataset: Record<string, string>) => {
    const button = { dataset, disabled: false };
    await handlers.get('click')!({ target: { closest: () => button } });
  };
  const change = async (input: Record<string, unknown>) =>
    handlers.get('change')!({ target: { dataset: {}, ...input } });
  const search = async (value: string) =>
    handlers.get('input')!({ target: { id: 'token-search', value, dataset: {} } });
  await click({ action: 'sample' });
  return {
    root,
    windowHandlers,
    app,
    requests,
    fetchSignals,
    click,
    change,
    search,
    resizeKey: async (key: string) => {
      await handlers.get('keydown')!({
        target: { closest: () => ({}) },
        key,
        preventDefault: () => {},
      });
      await new Promise(setImmediate);
    },
    hold: () => {
      hold = true;
    },
    fail: () => {
      fail = true;
    },
    release: () => {
      hold = false;
      release?.();
    },
  };
}

test('compiled UI changes browsing scope without changing export selection or invoking preview/sync', async () => {
  const ui = await openUI();
  const requestCount = ui.requests.length;
  await ui.change({ id: 'collection-scope', value: 'Interface' });
  await ui.click({ action: 'search' });
  await ui.search('surface');
  await ui.click({ browseFilter: 'changed' });
  assert.equal(ui.requests.length, requestCount);
  assert.match(ui.app.innerHTML, /Planned variables in Interface/);
  assert.match(ui.app.innerHTML, /#ffffff/);
  assert.doesNotMatch(ui.app.innerHTML, /data-row="[^\"]*outline/);
  await ui.change({ dataset: { group: 'Foundations' }, checked: false });
  const request = ui.requests.at(-1);
  assert.equal(request.type, 'preview');
  assert.deepEqual(request.settings.groups, ['Interface']);
  assert.match(ui.app.innerHTML, /value="surface"/);
  assert.match(ui.app.innerHTML, /Planned variables in Interface/);
  const afterInclusion = ui.requests.length;
  await ui.click({ action: 'close-search' });
  await ui.click({ browseFilter: 'all' });
  assert.doesNotMatch(ui.app.innerHTML, /id="token-search"/);
  assert.match(ui.app.innerHTML, /data-row="[^\"]*outline/);
  assert.equal(ui.requests.length, afterInclusion);
});

test('compiled UI prevents syncing while preview is pending, after its failure, and with all groups excluded', async () => {
  const ui = await openUI();
  ui.hold();
  const pending = ui.change({ dataset: { group: 'Foundations' }, checked: false });
  await ui.click({ action: 'send' });
  await ui.click({ action: 'confirm-send' });
  assert.equal(ui.requests.filter((request) => request.type === 'sync').length, 0);
  ui.release();
  await pending;
  await ui.change({ dataset: { group: 'Interface' }, checked: false });
  await ui.click({ action: 'send' });
  await ui.click({ action: 'confirm-send' });
  assert.equal(ui.requests.filter((request) => request.type === 'sync').length, 0);
  ui.fail();
  await ui.change({ dataset: { group: 'Interface' }, checked: true });
  await ui.click({ action: 'send' });
  await ui.click({ action: 'confirm-send' });
  assert.equal(ui.requests.filter((request) => request.type === 'sync').length, 0);
  assert.match(ui.app.innerHTML, /Preview failed/);
});

test('conflict shortcut reveals collection conflicts even when search and browsing scope hide them', async () => {
  const ui = await openUI(true);
  await ui.change({ id: 'collection-scope', value: 'Interface' });
  await ui.search('surface');
  await ui.click({ action: 'send' });
  await ui.click({ action: 'confirm-send' });
  assert.equal(ui.requests.filter((request) => request.type === 'sync').length, 0);
  await ui.click({ action: 'conflicts' });
  assert.match(ui.app.innerHTML, /Two compatible local collections/);
  assert.match(ui.app.innerHTML, /<dialog[^>]*aria-labelledby="dialog-title"/);
  assert.match(ui.app.innerHTML, /Resolve conflicts/);
  assert.match(ui.app.innerHTML, /value="surface"/);
});

test('export confirmation sends only its current plan ID and closing restores previous choices', async () => {
  const ui = await openUI();
  await ui.click({ action: 'send' });
  await ui.change({ dataset: { sendOutput: 'variables' }, type: 'checkbox', checked: false });
  assert.equal(ui.requests.at(-1).settings.variables, false);
  assert.equal(ui.requests.filter((r) => r.type === 'sync').length, 0);
  await ui.click({ action: 'close-dialog' });
  await ui.change({ dataset: { group: 'Foundations' }, checked: false });
  assert.equal(ui.requests.at(-1).settings.variables, true);
  await ui.click({ action: 'send' });
  await ui.click({ action: 'confirm-send' });
  const request = ui.requests.find((message) => message.type === 'sync');
  assert.equal(typeof request.planId, 'string');
  assert(request.planId.length > 0);
  assert.deepEqual(Object.keys(request).sort(), ['id', 'planId', 'type']);
});

test('connection testing exposes an enabled Stop action and aborts its provider request', async () => {
  const ui = await openUI();
  await ui.click({ action: 'edit' });
  await ui.change({ name: 'owner', type: 'text', value: 'team' });
  await ui.change({ name: 'repository', type: 'text', value: 'design-tokens' });
  const pending = ui.click({ action: 'test' });
  await new Promise(setImmediate);
  assert.equal(ui.fetchSignals.length, 1);
  assert.match(ui.app.innerHTML, /data-action="cancel">Stop/);
  await ui.click({ action: 'cancel' });
  await pending;
  assert.equal(ui.fetchSignals[0].aborted, true);
});

test('pointer rerenders retain pointer modality and keyboard navigation restores focus indicators', async () => {
  const ui = await openUI();
  ui.windowHandlers.get('keydown')!({ key: 'Tab' });
  assert.equal(ui.root.dataset.inputModality, 'keyboard');
  ui.windowHandlers.get('pointerdown')!({});
  await ui.click({ action: 'include' });
  assert.equal(ui.root.dataset.inputModality, 'pointer');
  ui.windowHandlers.get('keydown')!({ key: 'Shift' });
  assert.equal(ui.root.dataset.inputModality, 'pointer');
  ui.windowHandlers.get('keydown')!({ key: 'Tab' });
  assert.equal(ui.root.dataset.inputModality, 'keyboard');
});

test('sample mode identifies its file writes and does not display a fictitious branch', async () => {
  const ui = await openUI();
  assert.match(
    ui.app.innerHTML,
    /Sample tokens · Applying these changes writes to this Figma file/,
  );
  await ui.click({ action: 'send' });
  assert.match(ui.app.innerHTML, /Apply sample to this file/);
  assert.match(ui.app.innerHTML, /Connect repository/);
  assert.doesNotMatch(ui.app.innerHTML, /<span>main<\/span>/);
});

test('table-first UI moves export choices into a dialog and removes review, automation and downloads', async () => {
  const ui = await openUI();
  assert.match(ui.app.innerHTML, /Planned variables in Foundations/);
  assert.doesNotMatch(ui.app.innerHTML, /class="tabs"|data-action="include"|data-tab="changes"/);
  await ui.click({ action: 'menu' });
  assert.match(ui.app.innerHTML, /data-tab="styles"/);
  assert.doesNotMatch(
    ui.app.innerHTML,
    /Watch repository|Advanced settings|Review all changes|download/,
  );
  await ui.click({ action: 'send-menu' });
  assert.match(ui.app.innerHTML, /Send variables only/);
  assert.match(ui.app.innerHTML, /Send styles only/);
  await ui.click({ action: 'send-styles' });
  assert.equal(ui.requests.at(-1).settings.variables, false);
  assert.equal(ui.requests.at(-1).settings.styles, true);
  assert.equal(ui.requests.filter((r) => r.type === 'sync').length, 0);
  assert.match(ui.app.innerHTML, /2 of 2 collections selected/);
  await ui.click({ action: 'close-dialog' });
  assert.equal(ui.requests.at(-1).settings.variables, true);
  assert.equal(ui.requests.at(-1).settings.styles, true);
});

test('a partial sync report remains available after fetch and does not claim full success', async () => {
  const ui = await openUI(false, {
    created: 1,
    updated: 0,
    unchanged: 0,
    skipped: 1,
    failed: 0,
    cancelled: false,
    revision: 'old-revision',
    completedAt: '2026-11-14T10:00:00Z',
    preserveMetadata: false,
    diagnostics: [{ level: 'error', code: 'COLOR', token: 'invalid', message: 'Invalid color' }],
  });
  await ui.click({ action: 'send' });
  await ui.click({ action: 'confirm-send' });
  assert.match(ui.app.innerHTML, /Synced with 1 skipped item/);
  assert.doesNotMatch(ui.app.innerHTML, />Sync complete/);
  await ui.click({ action: 'fetch' });
  await ui.click({ action: 'report' });
  assert.match(ui.app.innerHTML, /old-revision/);
  assert.match(ui.app.innerHTML, /Token descriptions were applied/);
  assert.doesNotMatch(ui.app.innerHTML, /Download last sync report/);
  assert.match(ui.app.innerHTML, /Last sync result/);
});

test('cancelled sync retains result and description policy through fetch until retry replaces it', async () => {
  const result: SyncReport = {
    created: 2,
    updated: 1,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    cancelled: true,
    revision: 'cancelled-revision',
    completedAt: '2026-11-15T10:00:00Z',
    preserveMetadata: false,
    groups: ['Foundations'],
    diagnostics: [],
  };
  const ui = await openUI(false, result);
  await ui.click({ action: 'send' });
  await ui.click({ action: 'confirm-send' });
  assert.match(ui.app.innerHTML, /Sync stopped/);
  await ui.click({ action: 'report' });
  assert.match(ui.app.innerHTML, /Fetch a new preview to resume/);
  assert.match(ui.app.innerHTML, /Token descriptions were applied to synced outputs/);
  assert.match(ui.app.innerHTML, /use Figma Undo before making other edits/);
  await ui.click({ action: 'fetch' });
  await ui.click({ action: 'report' });
  assert.match(ui.app.innerHTML, /cancelled-revision/);
  assert.match(ui.app.innerHTML, /Collections: Foundations/);
  assert.doesNotMatch(ui.app.innerHTML, /Download last sync report/);
  Object.assign(result, { cancelled: false, revision: 'retry-revision', preserveMetadata: true });
  await ui.click({ action: 'send' });
  await ui.click({ action: 'confirm-send' });
  assert.match(ui.app.innerHTML, /Sync complete/);
  await ui.click({ action: 'report' });
  assert.match(ui.app.innerHTML, /retry-revision/);
  assert.doesNotMatch(ui.app.innerHTML, /cancelled-revision/);
  assert.match(ui.app.innerHTML, /local descriptions are preserved/);
});

test('global browsing finds other collections and opening a result preserves sync scope and return context', async () => {
  const ui = await openUI();
  const requests = ui.requests.length;
  await ui.change({ id: 'collection-scope', value: '' });
  await ui.search('surface');
  assert.match(ui.app.innerHTML, /Results across all collections/);
  assert.match(ui.app.innerHTML, /Interface · variables/);
  const key = /data-open-token="([^"]+)"/
    .exec(ui.app.innerHTML)![1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
  await ui.click({ openToken: key });
  assert.match(ui.app.innerHTML, /Planned variables in Interface/);
  assert.match(ui.app.innerHTML, /Back to previous token/);
  assert.match(ui.app.innerHTML, /Current Figma/);
  await ui.click({ action: 'back-to-token' });
  assert.match(ui.app.innerHTML, /Results across all collections/);
  assert.match(ui.app.innerHTML, /value="surface"/);
  assert.equal(ui.requests.length, requests);
});

test('alias navigation opens its target and returns to the originating collection', async () => {
  const ui = await openUI();
  await ui.change({ id: 'collection-scope', value: 'Interface' });
  const key = /data-row="([^"]*surface[^"]*)"/
    .exec(ui.app.innerHTML)![1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
  await ui.click({ row: key });
  const target = /data-open-token="([^"]+)" data-origin-token/
    .exec(ui.app.innerHTML)![1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
  await ui.click({ openToken: target, originToken: key });
  assert.match(ui.app.innerHTML, /Planned variables in Foundations/);
  await ui.click({ action: 'back-to-token' });
  assert.match(ui.app.innerHTML, /Planned variables in Interface/);
  assert.match(ui.app.innerHTML, /data-origin-token/);
});

test('window size changes preserve the current collection, search and expanded row without another preview', async () => {
  const ui = await openUI();
  await ui.change({ id: 'collection-scope', value: 'Interface' });
  await ui.search('surface');
  const key = /data-row="([^"]*surface[^"]*)"/
    .exec(ui.app.innerHTML)![1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
  await ui.click({ row: key });
  const previewRequests = ui.requests.filter((request) => request.type === 'preview').length;
  await ui.resizeKey('ArrowRight');
  assert.equal(ui.requests[ui.requests.length - 1].type, 'resize');
  assert.equal(ui.requests.at(-1).width, 450);
  assert.equal(ui.requests.at(-1).height, 720);
  assert.equal(ui.requests.at(-1).persist, true);
  assert.match(ui.app.innerHTML, /Planned variables in Interface/);
  assert.match(ui.app.innerHTML, /value="surface"/);
  assert.match(ui.app.innerHTML, /Current Figma/);
  assert.equal(ui.requests.filter((request) => request.type === 'preview').length, previewRequests);
  await ui.resizeKey('ArrowLeft');
  assert.equal(ui.requests.at(-1).width, 440);
  await ui.click({ action: 'menu' });
  assert.doesNotMatch(ui.app.innerHTML, /Window:|data-action="resize"/);
  assert.match(ui.app.innerHTML, /Resize plugin window/);
});

test('a bad token path keeps the connection draft and never saves an unverified connection', async () => {
  const ui = await openUI(false, undefined, async (url) => {
    if (String(url).includes('/commits/'))
      return new Response(JSON.stringify({ sha: 'a'.repeat(40) }));
    return new Response('{}', { status: 404 });
  });
  await ui.click({ action: 'edit' });
  for (const [name, value] of Object.entries({
    owner: 'team',
    repository: 'tokens',
    branch: 'main',
    path: 'missing.json',
  }))
    await ui.change({ name, value });
  await ui.click({ action: 'connect' });
  assert.match(ui.app.innerHTML, /Connection not saved/);
  assert.match(ui.app.innerHTML, /value="missing.json"/);
  assert.match(ui.app.innerHTML, /Edit token path/);
  assert.equal(
    ui.requests.some((request) => request.type === 'saveConnection'),
    false,
  );
});

test('omitted diagnostic tokens show conversion reasons instead of a misleading empty search', async () => {
  const ui = await openUI(false, undefined, undefined, true);
  await ui.click({ diagnosticToken: 'invalid-color' });
  assert.match(ui.app.innerHTML, /No output is planned for this token/);
  assert.match(ui.app.innerHTML, /Source token details/);
  assert.match(ui.app.innerHTML, /Export warnings/);
  assert.doesNotMatch(ui.app.innerHTML, /No matching changes/);
});

test('partial composite diagnostics expose source definitions without changing export scope', async () => {
  const ui = await openUI();
  const count = ui.requests.length;
  await ui.click({ diagnosticToken: 'outline' });
  assert.match(ui.app.innerHTML, /Some output exists for this token/);
  assert.match(ui.app.innerHTML, /Source definitions/);
  assert.match(ui.app.innerHTML, /PARTIAL_COMPOSITE/);
  assert.equal(ui.requests.length, count);
});
