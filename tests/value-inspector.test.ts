import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDesired } from '../src/core/desired';
import { defaultSettings } from '../src/core/model';
import { emptyRegistry, planSync } from '../src/sync/planner';
import { previewPayload } from '../src/ui/preview-model';
import { createValueInspector, inspectValue, inspectorPosition } from '../src/ui/value-inspector';
import { project } from './helpers';

async function makePreview() {
  return previewPayload(
    planSync(
      await buildDesired(project(), defaultSettings),
      { identity: 'inspector', collections: [], variables: [], styles: [] },
      emptyRegistry('inspector'),
    ),
  );
}

test('value inspector pairs each ordered mode with its own alias and resolved value', async () => {
  const preview = await makePreview();
  const original = JSON.stringify(preview);
  const surface = preview.variables.find((row) => row.path === 'surface')!;
  const inspection = inspectValue(preview, surface.key)!;
  assert.deepEqual(
    inspection.pages.map((page) => [page.key, page.label]),
    [
      ['light', 'Light'],
      ['dark', 'Dark'],
    ],
  );
  assert.equal(inspection.pages[0].aliases[0].name, 'color/paper');
  assert.equal(inspection.pages[1].aliases[0].name, 'color/ink');
  assert.equal(inspection.pages[0].aliases[0].group, 'Foundations');
  assert.deepEqual(inspection.pages[0].value, surface.values.light.literal);
  assert.deepEqual(inspection.pages[1].value, surface.values.dark.literal);
  assert.equal(JSON.stringify(preview), original);
  delete surface.values.dark;
  assert.equal(inspectValue(preview, surface.key)!.pages[1].value, undefined);
  assert.deepEqual(inspectValue(preview, surface.key)!.pages[1].aliases, []);
  assert.equal(inspectValue(undefined, surface.key), undefined);
  assert.equal(inspectValue(preview, 'missing'), undefined);
});

test('single-mode scalars and styles retain real values and context without invented modes', async () => {
  const preview = await makePreview();
  const scalar = preview.variables.find((row) => row.path === 'enabled')!;
  for (const value of [false, 0, '']) {
    scalar.values.core.literal = value;
    const pages = inspectValue(preview, scalar.key)!.pages;
    assert.equal(pages.length, 1);
    assert.equal(pages[0].value, value);
    assert.deepEqual(pages[0].aliases, []);
  }
  const text = preview.styles.find((row) => row.path === 'body')!;
  const style = inspectValue(preview, text.key)!;
  assert.equal(style.pages.length, 1);
  assert.equal(style.pages[0].label, 'Linked');
  assert.equal(style.pages[0].summary, 'Inter Regular · 16 px');
  assert(style.pages[0].aliases.length > 0);
});

test('inspector anchors to the opposite left corner of the visible list', () => {
  const bounds = { left: 460, top: 24, right: 820, bottom: 644 };
  assert.deepEqual(
    inspectorPosition({ left: 640, right: 800, top: 250, bottom: 284 }, bounds, 280, 140),
    { left: 468, top: 496 },
  );
  assert.deepEqual(
    inspectorPosition({ left: 640, right: 800, top: 600, bottom: 634 }, bounds, 280, 140),
    { left: 468, top: 32 },
  );
  assert.deepEqual(
    inspectorPosition({ left: 480, right: 620, top: 100, bottom: 134 }, bounds, 280, 140),
    { left: 468, top: 496 },
    'Different rows in the upper half share one fixed position',
  );
  const position = inspectorPosition(
    { left: 430, right: 600, top: 27, bottom: 61 },
    bounds,
    280,
    600,
  );
  assert.equal(position.left, 468);
  assert(position.top >= bounds.top + 8);
  assert(position.top + 600 <= bounds.bottom - 8);
});

test('passing the pointer across values cancels inspection, while dwell and keyboard focus open it', async () => {
  const handlers = new Map<string, (event: any) => void>();
  const app = {
    addEventListener: (name: string, handler: (event: any) => void) => handlers.set(name, handler),
  };
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener() {} } as unknown as Window & typeof globalThis;
  let reads = 0;
  // No preview is returned: this isolates hover intent from DOM rendering, which is
  // exercised in the browser. The callback is reached only when inspection opens.
  const inspector = createValueInspector(app as unknown as HTMLElement, () => {
    reads++;
    return undefined;
  });
  const trigger = {
    dataset: { value: JSON.stringify(['variable', 'light']) },
    isConnected: true,
    contains: () => false,
    closest: () => trigger,
  };
  const event = { target: trigger, relatedTarget: null, pointerType: 'mouse' };
  const dwell = () => new Promise((resolve) => setTimeout(resolve, 220));
  try {
    handlers.get('pointerover')!(event);
    assert.equal(reads, 0, 'Opening should wait for hover intent');
    handlers.get('pointerout')!(event);
    await dwell();
    assert.equal(reads, 0, 'A passing pointer must not open a card');
    handlers.get('pointerover')!(event);
    await dwell();
    assert.equal(reads, 1);
    handlers.get('pointerover')!({ ...event, pointerType: 'touch' });
    await dwell();
    assert.equal(reads, 1, 'Touch should use click instead of synthetic hover');
    handlers.get('focusin')!(event);
    assert.equal(reads, 2, 'Keyboard focus opens immediately');
    handlers.get('pointerover')!(event);
    inspector.beforeRender();
    await dwell();
    assert.equal(reads, 2, 'Rerendering cancels any pending hover');
  } finally {
    inspector.close();
    globalThis.window = previousWindow;
  }
});
