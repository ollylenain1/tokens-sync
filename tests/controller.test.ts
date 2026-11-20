import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { mockFigma } from './mock-figma';
import { project } from './helpers';
import { defaultSettings } from '../src/core/model';

async function controller() {
  const mock = mockFigma(),
    local = new Map<string, unknown>(),
    messages: any[] = [];
  const api: any = mock.api;
  api.showUI = () => {};
  const notifications: { message: string; options: any }[] = [];
  api.notify = (message: string, options: any) => notifications.push({ message, options });
  const sizes: number[][] = [];
  api.ui = {
    postMessage: (message: unknown) => messages.push(message),
    resize: (width: number, height: number) => sizes.push([width, height]),
  };
  api.clientStorage = {
    getAsync: async (key: string) => local.get(key),
    setAsync: async (key: string, value: unknown) => {
      local.set(key, value);
    },
    deleteAsync: async (key: string) => {
      local.delete(key);
    },
  };
  const compiled = await build({
    entryPoints: ['src/plugin.ts'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2017',
  });
  runInNewContext(compiled.outputFiles[0].text, {
    figma: api,
    __html__: '<html></html>',
    setTimeout,
    clearTimeout,
  });
  let id = 0;
  async function send(type: string, data: Record<string, unknown> = {}) {
    const request = ++id;
    await api.ui.onmessage({ type, id: request, ...data });
    return messages.find((m) => m.id === request);
  }
  return { ...mock, local, messages, send, sizes, notifications };
}
test('bundled controller completes preview → sync → unchanged preview through its real message bridge', async () => {
  const c = await controller();
  assert.equal((await c.send('init')).ok, true);
  const first = await c.send('preview', {
    project: project(),
    settings: defaultSettings,
    choices: {},
  });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert(first.result.canSync);
  assert.equal(c.collections.length, 0);
  const result = await c.send('sync', { planId: first.result.id });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.result.failed, 0);
  assert.match(c.notifications[0].message, /Sync complete.*created/);
  const progress = c.messages.filter((message) => message.type === 'progress');
  assert.equal(progress[0].total, 0);
  assert.equal(progress.at(-1).done, progress.at(-1).total);
  assert.equal(progress.at(-1).text, 'Finished sending to Figma');
  const next = await c.send('preview', { settings: defaultSettings });
  assert.equal(next.ok, true);
  assert.equal(next.result.canSync, false);
  assert.equal(next.result.counts.variables.updated, 0);
  assert.equal(next.result.counts.styles.updated, 0);
  const stale = await c.send('sync', { planId: first.result.id });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'STALE_PREVIEW');
  assert.equal(c.notifications.at(-1)?.options.error, true);
});
test('credential storage is opt-in, separated from config, and removed on disconnect', async () => {
  const c = await controller();
  const config = {
    provider: 'github',
    baseUrl: 'https://api.github.com',
    owner: 'team',
    repository: 'tokens',
    branch: 'main',
    path: 'tokens',
    layout: 'auto',
    token: 'test-credential-do-not-log',
    remember: true,
  };
  assert.equal((await c.send('saveConnection', { connection: config })).ok, true);
  assert.equal(c.local.get('blueprint.credential'), config.token);
  assert.equal('token' in (c.local.get('blueprint.connection') as object), false);
  assert.equal((await c.send('init')).result.connection.token, config.token);
  await c.send('saveConnection', { connection: { ...config, remember: false } });
  assert.equal(c.local.has('blueprint.credential'), false);
  assert.equal((await c.send('init')).result.connection.token, '');
  assert.equal(c.storage.size, 0);
  await c.send('disconnect');
  assert.equal(c.local.has('blueprint.connection'), false);
  assert.equal(c.local.has('blueprint.credential'), false);
});

test('window sizing persists, restores and rejects arbitrary dimensions without invalidating a plan', async () => {
  const c = await controller();
  await c.send('init');
  assert.deepEqual(c.sizes.pop(), [440, 720]);
  const plan = await c.send('preview', {
    project: project(),
    settings: defaultSettings,
    choices: {},
  });
  assert.equal((await c.send('resize', { width: 715, height: 815, persist: true })).ok, true);
  assert.deepEqual(c.sizes.pop(), [715, 815]);
  assert.deepEqual(structuredClone(c.local.get('blueprint.windowSize')), {
    width: 715,
    height: 815,
  });
  assert.deepEqual(structuredClone((await c.send('init')).result.windowSize), {
    width: 715,
    height: 815,
  });
  assert.deepEqual(c.sizes.pop(), [715, 815]);
  assert.equal((await c.send('resize', { size: 'enormous' })).ok, false);
  assert.equal(c.sizes.length, 0);
  assert.equal((await c.send('resize', { width: Infinity, height: 700 })).ok, false);
  await c.send('resize', { width: 9999, height: 10 });
  assert.deepEqual(c.sizes.pop(), [1200, 400]);
  assert.deepEqual(structuredClone(c.local.get('blueprint.windowSize')), {
    width: 715,
    height: 815,
  });
  c.local.set('blueprint.windowSize', 'wide');
  await c.send('init');
  assert.deepEqual(c.sizes.pop(), [620, 720]);
  assert.equal((await c.send('sync', { planId: plan.result.id })).ok, true);
});
