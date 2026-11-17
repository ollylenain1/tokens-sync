import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockFigma } from './mock-figma';
import { fixture, project } from './helpers';
import { buildDesired } from '../src/core/desired';
import { defaultSettings, Settings } from '../src/core/model';
import { Choices, planSync } from '../src/sync/planner';
import { applyPlan } from '../src/sync/engine';

async function prepare(
  mock: ReturnType<typeof mockFigma>,
  input = fixture,
  choices: Choices = {},
  settings: Settings = defaultSettings,
) {
  const model = await buildDesired(project(input), settings);
  await mock.adapter.prepareFonts(model);
  return planSync(model, await mock.adapter.snapshot(), mock.store.read(), choices);
}
async function apply(
  mock: ReturnType<typeof mockFigma>,
  plan: Awaited<ReturnType<typeof prepare>>,
) {
  return applyPlan(plan, mock.adapter, mock.store.read(), mock.store, {
    cancelled: false,
    progress: () => {},
  });
}

test('local variable divergence blocks automatic eligibility and requires explicit replacement', async () => {
  const mock = mockFigma();
  await apply(mock, await prepare(mock));
  const variable = mock.variables.find((v) => v.name === 'font/size');
  const mode = Object.keys(variable.valuesByMode)[0];
  variable.setValueForMode(mode, 99);
  const source = structuredClone(fixture);
  source.core.space.small.value = '10px';
  const plan = await prepare(mock, source);
  const op = plan.variables.find((v) => v.targetId === variable.id)!;
  assert.equal(op.action, 'conflicting');
  assert.equal(op.localDrift, true);
  assert(plan.styles.some((s) => s.desired.path === 'body' && s.action === 'conflicting'));
  const skipped = await prepare(mock, source, { [op.key]: 'skip' });
  await apply(mock, skipped);
  assert.equal(variable.valuesByMode[mode], 99);
  const replacement = await prepare(mock, source, { [op.key]: 'repository' });
  assert.equal(replacement.variables.find((v) => v.key === op.key)?.action, 'updated');
  await apply(mock, replacement);
  assert.equal(variable.valuesByMode[mode], 16);
  assert.equal(
    (await prepare(mock, source)).variables.find((v) => v.key === op.key)?.action,
    'unchanged',
  );
});

test('source-only changes and convergence with local edits do not produce false conflicts', async () => {
  const mock = mockFigma();
  await apply(mock, await prepare(mock));
  const source = structuredClone(fixture);
  source.core.font.size.value = '18px';
  let plan = await prepare(mock, source);
  assert.equal(plan.variables.find((v) => v.desired.path === 'font.size')?.action, 'updated');
  const variable = mock.variables.find((v) => v.name === 'font/size');
  variable.setValueForMode(Object.keys(variable.valuesByMode)[0], 18);
  plan = await prepare(mock, source);
  assert.equal(plan.variables.find((v) => v.desired.path === 'font.size')?.action, 'unchanged');
});

test('local style properties require review and explicit replacement retains style identity', async () => {
  const mock = mockFigma();
  const settings = { ...defaultSettings, styleStrategy: 'themes' as const };
  await apply(mock, await prepare(mock, fixture, {}, settings));
  const style = mock.styles.find((s) => s.type === 'TEXT');
  style.fontSize = 99;
  const plan = await prepare(mock, fixture, {}, settings);
  const op = plan.styles.find((s) => s.targetId === style.id)!;
  assert.equal(op.action, 'conflicting');
  assert(op.localDrift);
  const accepted = await prepare(mock, fixture, { [op.key]: 'repository' }, settings);
  assert.equal(accepted.styles.find((s) => s.key === op.key)?.action, 'updated');
  await apply(mock, accepted);
  assert.equal(style.fontSize, 16);
  assert.equal(
    (await prepare(mock, fixture, {}, settings)).styles.find((s) => s.key === op.key)?.action,
    'unchanged',
  );
});

test('font recovery rechecks availability in the same adapter session', async () => {
  const mock = mockFigma();
  const original = mock.api.listAvailableFontsAsync;
  let available = false,
    calls = 0;
  mock.api.listAvailableFontsAsync = async () => {
    calls++;
    return available ? original() : [];
  };
  assert((await prepare(mock)).diagnostics.some((d) => d.code === 'MISSING_FONT'));
  available = true;
  assert(!(await prepare(mock)).diagnostics.some((d) => d.code === 'MISSING_FONT'));
  assert.equal(calls, 2);
});

test('review evidence distinguishes per-mode aliases even when resolved colors match', async () => {
  const mock = mockFigma();
  const source = structuredClone(fixture);
  source.core.color.ink.value = '#ffffff';
  await apply(mock, await prepare(mock, source));
  source['themes/light'].surface.value = '{color.ink}';
  const plan = await prepare(mock, source);
  const surface = plan.variables.find((v) => v.desired.path === 'surface')!;
  const light = surface.changes!.find((change) => change.field === 'Light')!;
  const dark = surface.changes!.find((change) => change.field === 'Dark')!;
  assert.equal(light.kind, 'binding');
  assert.equal(light.changed, true);
  assert.equal(dark.changed, false);
  assert.notDeepEqual(light.before, light.after);
  assert.equal((light.before as { name: string }).name, 'color/paper');
  assert.equal((light.after as { name: string }).name, 'color/ink');
});

test('review evidence includes value changes and name changes without mutating the snapshot', async () => {
  const mock = mockFigma();
  await apply(mock, await prepare(mock));
  const variable = mock.variables.find((v) => v.name === 'font/size');
  variable.name = 'local/font-size';
  const source = structuredClone(fixture);
  source.core.font.size.value = '18px';
  const plan = await prepare(mock, source);
  const op = plan.variables.find((v) => v.targetId === variable.id)!;
  assert.deepEqual(
    op.changes!.find((c) => c.field === 'Default'),
    {
      field: 'Default',
      kind: 'value',
      before: 16,
      after: 18,
      changed: true,
    },
  );
  assert.equal(op.changes!.find((c) => c.kind === 'name')?.before, 'local/font-size');
  assert.equal(variable.name, 'local/font-size');
});

test('native font axis defaults do not cause repeated text-style updates or false removals', async () => {
  const mock = mockFigma();
  await apply(mock, await prepare(mock));
  const text = mock.styles.find((style) => style.type === 'TEXT')! as any;
  text.fontName = { ...text.fontName, variationSettings: { slnt: 0, wght: 400 } };
  const next = await prepare(mock);
  const operation = next.styles.find((op) => op.desired.kind === 'TEXT')!;
  assert.equal(operation.action, 'unchanged');
  assert.equal(
    operation.changes?.some((change) => change.field.startsWith('fontName.variationSettings')),
    false,
  );
  text.fontName = { ...text.fontName, style: 'Bold' };
  delete text.boundVariables.fontStyle;
  const changed = await prepare(mock);
  assert.notEqual(changed.styles.find((op) => op.desired.kind === 'TEXT')!.action, 'unchanged');
});
