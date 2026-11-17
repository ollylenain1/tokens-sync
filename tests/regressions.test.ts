import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockFigma } from './mock-figma';
import { fixture, project } from './helpers';
import { buildDesired } from '../src/core/desired';
import { defaultSettings, Settings, SyncPlan } from '../src/core/model';
import { planSync } from '../src/sync/planner';
import { applyPlan } from '../src/sync/engine';
async function setup(source: unknown = fixture, settings: Settings = defaultSettings) {
  const mock = mockFigma();
  async function preview(
    input: unknown = source,
    config = settings,
    choices: Record<string, string> = {},
  ) {
    const model = await buildDesired(project(input), config);
    await mock.adapter.prepareFonts(model);
    return planSync(model, await mock.adapter.snapshot(), mock.store.read(), choices);
  }
  async function sync(plan?: SyncPlan) {
    return applyPlan(plan ?? (await preview()), mock.adapter, mock.store.read(), mock.store, {
      cancelled: false,
      progress: () => {},
    });
  }
  return { mock, preview, sync };
}
test('same-valued potential variable rename requires confirmation and can retain the target', async () => {
  const context = await setup({ old: { type: 'number', value: 12 } });
  await context.sync();
  const id = context.mock.variables[0].id;
  const source = { renamed: { type: 'number', value: 12 } },
    candidate = await context.preview(source);
  assert.equal(candidate.variables[0].action, 'conflicting');
  assert.match(candidate.variables[0].reason!, /renamed/);
  const confirmed = await context.preview(source, defaultSettings, {
    [candidate.variables[0].key]: id,
  });
  await context.sync(confirmed);
  assert.equal(context.mock.variables.length, 1);
  assert.equal(context.mock.variables[0].id, id);
  assert.equal(context.mock.variables[0].name, 'renamed');
});
test('style-only theme export works in an empty file without creating variables or collections', async () => {
  const config = { ...defaultSettings, variables: false, styleStrategy: 'themes' as const },
    context = await setup(fixture, config);
  const plan = await context.preview();
  assert.equal(plan.variables.length, 0);
  assert.equal(plan.collections.length, 0);
  const report = await context.sync(plan);
  assert.equal(report.failed, 0);
  assert(context.mock.styles.length > 0);
  assert.equal(context.mock.variables.length, 0);
  assert.equal(context.mock.collections.length, 0);
});
test('styles-only linked export rejects stale bound variables', async () => {
  const context = await setup();
  await context.sync();
  const changed = structuredClone(fixture);
  changed.core.font.size.value = '19px';
  const plan = await context.preview(changed, { ...defaultSettings, variables: false });
  assert.equal(plan.variables.find((v) => v.desired.path === 'font.size')?.action, 'conflicting');
  assert.equal(plan.styles.find((s) => s.desired.kind === 'TEXT')?.action, 'conflicting');
});
test('explicit skip works even when the original conflict has invalid/missing mode data', async () => {
  const source = {
    a: { x: { type: 'number', value: 1 } },
    b: {},
    $themes: [
      { id: 'a', name: 'A', group: 'Group', selectedTokenSets: { a: 'enabled' } },
      { id: 'b', name: 'B', group: 'Group', selectedTokenSets: { b: 'enabled' } },
    ],
  };
  const context = await setup(source),
    first = await context.preview();
  assert.equal(first.variables[0].action, 'conflicting');
  const skipped = await context.preview(source, defaultSettings, {
    [first.variables[0].key]: 'skip',
  });
  assert.equal(skipped.variables[0].action, 'skipped');
});
test('two groups cannot be mapped to the same base collection', async () => {
  const context = await setup();
  const collection = context.mock.createCollection('Shared');
  const first = await context.preview(),
    choices = Object.fromEntries(first.collections.map((c) => [c.key, collection.id]));
  const plan = await context.preview(fixture, defaultSettings, choices);
  assert(plan.collections.every((c) => c.action === 'conflicting'));
});
test('mode-specific alias directions do not produce a false union-cycle error', async () => {
  const source = {
    light: { a: { type: 'number', value: '{b}' }, b: { type: 'number', value: 1 } },
    dark: { a: { type: 'number', value: 2 }, b: { type: 'number', value: '{a}' } },
    $themes: [
      { id: 'l', name: 'Light', group: 'Base', selectedTokenSets: { light: 'enabled' } },
      { id: 'd', name: 'Dark', group: 'Base', selectedTokenSets: { dark: 'enabled' } },
    ],
  };
  const context = await setup(source),
    report = await context.sync();
  assert.equal(report.failed, 0, JSON.stringify(report.diagnostics));
  assert.equal(context.mock.variables.length, 2);
});
test('removing a bound effect property requires review instead of silently dropping a local binding', async () => {
  const context = await setup();
  await context.sync();
  const effect = context.mock.styles.find((s) => s.name.endsWith('/elevation'));
  effect.effects[1].boundVariables = {
    color: {
      type: 'VARIABLE_ALIAS',
      id: context.mock.variables.find((v) => v.name === 'color/ink').id,
    },
  };
  const changed = structuredClone(fixture);
  changed.components.elevation.value.pop();
  const plan = await context.preview(changed);
  assert.equal(plan.styles.find((s) => s.desired.path === 'elevation')?.action, 'conflicting');
});
test('style key mappings update native styles without duplicating them', async () => {
  const config = { ...defaultSettings, styleStrategy: 'themes' as const },
    context = await setup(fixture, config);
  await context.sync();
  const changed = structuredClone(fixture),
    style = context.mock.styles.find((s) => s.type === 'TEXT' && s.name.includes('/Light/')),
    id = style.id;
  changed.components.heading = changed.components.body;
  delete changed.components.body;
  changed.$themes[1].$figmaStyleReferences = { heading: style.key };
  const plan = await context.preview(changed, config),
    op = plan.styles.find((s) => s.desired.path === 'heading' && s.desired.theme === 'light')!;
  assert.equal(op.targetId, id);
  await context.sync(plan);
  assert.equal(style.id, id);
  assert(style.name.endsWith('/heading'));
});
test('unknown and invalid tokens are counted as skipped in the completion report', async () => {
  const context = await setup({
    valid: { type: 'number', value: 1 },
    invalid: { type: 'dimension', value: '1vw' },
    asset: { type: 'asset', value: 'image.svg' },
  });
  const report = await context.sync();
  assert.equal(report.skipped, 2);
  assert.equal(report.created, 1);
});
test('names containing Figma hierarchy collisions block both writes', async () => {
  const context = await setup({
    'a.b': { type: 'number', value: 1 },
    'a/b': { type: 'number', value: 2 },
  });
  const plan = await context.preview();
  assert(plan.variables.every((v) => v.action === 'conflicting'));
});
