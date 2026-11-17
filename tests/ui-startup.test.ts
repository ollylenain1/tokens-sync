import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const ui = build({
  entryPoints: ['src/ui/app.ts'],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
});

async function openUI(source: 'parent' | 'relay' | 'null', respond = true, failure = false) {
  const listeners = new Map<string, ((event: any) => void)[]>();
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const app = {
    innerHTML: 'Opening Blueprint…',
    addEventListener: () => {},
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const parent = {
    postMessage: ({ pluginMessage }: any) => {
      if (!respond) return;
      queueMicrotask(() => {
        for (const listener of listeners.get('message') ?? []) {
          listener({
            source: source === 'parent' ? parent : source === 'null' ? null : {},
            data: {
              pluginMessage: {
                id: pluginMessage.id,
                ok: !failure,
                result: { collections: [], settings: {} },
                error: 'Figma document access is unavailable.',
              },
            },
          });
        }
      });
    },
  };
  runInNewContext((await ui).outputFiles[0].text, {
    window: {
      parent,
      addEventListener: (type: string, handler: (event: any) => void) => {
        listeners.set(type, [...(listeners.get(type) ?? []), handler]);
      },
    },
    parent,
    document: { getElementById: () => app },
    structuredClone,
    setTimeout: (callback: () => void) => {
      timers.set(++nextTimer, callback);
      return nextTimer;
    },
    clearTimeout: (id: number) => timers.delete(id),
  });
  await new Promise(setImmediate);
  return { app, timers };
}

test('compiled UI opens onboarding when Figma relays a reply without the parent Window source', async () => {
  for (const source of ['parent', 'relay', 'null'] as const) {
    const { app, timers } = await openUI(source);
    assert.match(app.innerHTML, /Connect repository/, `Startup did not finish for ${source}`);
    assert.doesNotMatch(app.innerHTML, /Opening Blueprint/);
    assert.equal(timers.size, 0, 'Successful startup must clear its timeout');
  }
});

test('compiled UI shows an actionable error if the Figma startup handshake never replies', async () => {
  const { app, timers } = await openUI('parent', false);
  assert.equal(timers.size, 1, 'Startup must have a bounded wait');
  for (const callback of [...timers.values()]) callback();
  await new Promise(setImmediate);
  assert.doesNotMatch(app.innerHTML, /Opening Blueprint/);
  assert.match(app.innerHTML, /Figma did not respond/);
  assert.match(app.innerHTML, /development console/i);
});

test('compiled UI renders host startup errors instead of leaving the loading screen', async () => {
  const { app, timers } = await openUI('null', true, true);
  assert.match(app.innerHTML, /Figma document access is unavailable/);
  assert.equal(timers.size, 0);
});
