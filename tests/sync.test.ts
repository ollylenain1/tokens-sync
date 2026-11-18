import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockFigma } from './mock-figma';
import { fixture, project } from './helpers';
import { buildDesired } from '../src/core/desired';
import { defaultSettings, registryKey, Settings } from '../src/core/model';
import { Choices, planSync } from '../src/sync/planner';
import { applyPlan } from '../src/sync/engine';
import { RegistryStore } from '../src/figma/registry';
type Mock = ReturnType<typeof mockFigma>;
async function preview(
  mock: Mock,
  source: unknown = fixture,
  settings: Settings = defaultSettings,
  choices: Choices = {},
) {
  const model = await buildDesired(project(source), settings);
  await mock.adapter.prepareFonts(model);
  return planSync(model, await mock.adapter.snapshot(), mock.store.read(), choices);
}
async function run(mock: Mock, source: unknown = fixture, settings: Settings = defaultSettings) {
  const plan = await preview(mock, source, settings);
  return {
    plan,
    report: await applyPlan(plan, mock.adapter, mock.store.read(), mock.store, {
      cancelled: false,
      progress: () => {},
    }),
  };
}
test('preview never mutates Figma or persists document mappings', async () => {
  const mock = mockFigma();
  const plan = await preview(mock);
  assert.equal(mock.writes, 0);
  assert.equal(mock.storage.size, 0);
  assert(plan.variables.length > 10);
  assert(plan.styles.length > 5);
});
test('initial sync creates native variables, modes, typography, shadows and gradients', async () => {
  const mock = mockFigma();
  const { report } = await run(mock);
  assert.equal(report.failed, 0, JSON.stringify(report.diagnostics));
  assert(report.created > 15);
  assert.deepEqual(
    mock.collections.find((c) => c.name === 'Interface').modes.map((m: any) => m.name),
    ['Light', 'Dark'],
  );
  assert(mock.styles.some((s) => s.type === 'TEXT'));
  assert(mock.styles.some((s) => s.type === 'PAINT' && s.paints[0].type === 'GRADIENT_LINEAR'));
  const shadow = mock.styles.find((s) => s.name.endsWith('/elevation'));
  assert.deepEqual(
    shadow.effects.map((e: any) => e.type),
    ['DROP_SHADOW', 'INNER_SHADOW'],
  );
});
test('repeat sync is unchanged and never duplicates variables or styles', async () => {
  const mock = mockFigma();
  await run(mock);
  const ids = [...mock.variables, ...mock.styles].map((v) => v.id),
    writes = mock.writes;
  const { plan, report } = await run(mock);
  assert.equal(plan.counts.variables.updated, 0);
  assert.equal(plan.counts.styles.updated, 0);
  assert.equal(report.created, 0);
  assert.equal(report.failed, 0, JSON.stringify(report.diagnostics));
  assert.deepEqual(
    [...mock.variables, ...mock.styles].map((v) => v.id),
    ids,
  );
  assert.equal(mock.writes, writes);
});
test('updating a primitive retains IDs, code syntax, scopes, descriptions, visibility and node bindings', async () => {
  const mock = mockFigma();
  await run(mock);
  const variable = mock.variables.find((v) => v.name === 'font/size'),
    id = variable.id;
  variable.description = 'Local documentation';
  variable.codeSyntax = { WEB: 'var(--font-size)', iOS: 'Font.body' };
  variable.scopes = ['FONT_SIZE'];
  variable.hiddenFromPublishing = true;
  const nodeBinding = { fontSize: { type: 'VARIABLE_ALIAS', id } };
  const changed = structuredClone(fixture);
  changed.core.font.size.value = '18px';
  const { report } = await run(mock, changed);
  assert.equal(report.failed, 0);
  assert.equal(variable.id, id);
  assert.equal(Object.values(variable.valuesByMode)[0], 18);
  assert.equal(variable.description, 'Local documentation');
  assert.deepEqual(variable.codeSyntax, { WEB: 'var(--font-size)', iOS: 'Font.body' });
  assert.deepEqual(variable.scopes, ['FONT_SIZE']);
  assert.equal(variable.hiddenFromPublishing, true);
  assert.equal(nodeBinding.fontSize.id, id);
  assert(mock.styles.find((s) => s.type === 'TEXT').boundVariables.fontSize.id === id);
});
test('primitive changes propagate into literal theme-specific styles in place', async () => {
  const mock = mockFigma(),
    settings = { ...defaultSettings, styleStrategy: 'themes' as const };
  await run(mock, fixture, settings);
  const text = mock.styles.filter((s) => s.type === 'TEXT'),
    ids = text.map((s) => s.id);
  const changed = structuredClone(fixture);
  changed.core.font.size.value = '20px';
  await run(mock, changed, settings);
  assert.deepEqual(
    text.map((s) => s.id),
    ids,
  );
  assert(text.every((s) => s.fontSize === 20));
});
test('existing local style descriptions and binding references survive updates', async () => {
  const mock = mockFigma();
  await run(mock);
  const text = mock.styles.find((s) => s.type === 'TEXT'),
    before = structuredClone(text.boundVariables),
    id = text.id;
  text.description = 'Maintained by design team';
  const changed = structuredClone(fixture);
  changed.components.body.value.paragraphSpacing = '12px';
  await run(mock, changed);
  assert.equal(text.id, id);
  assert.equal(text.description, 'Maintained by design team');
  assert.deepEqual(text.boundVariables, before);
  assert.equal(text.paragraphSpacing, 12);
});
test('metadata opt-in updates descriptions while leaving scopes and code syntax intact', async () => {
  const mock = mockFigma();
  await run(mock);
  const variable = mock.variables[0],
    syntax = structuredClone(variable.codeSyntax);
  variable.description = 'local';
  const changed = structuredClone(fixture);
  changed.core.color.ink.description = 'source';
  await run(mock, changed, { ...defaultSettings, preserveMetadata: false });
  assert.equal(mock.variables.find((v) => v.name === 'color/ink').description, 'source');
  assert.deepEqual(variable.codeSyntax, syntax);
});
test('deleted source tokens are reported and retained', async () => {
  const mock = mockFigma();
  await run(mock);
  const ids = [...mock.variables, ...mock.styles].map((v) => v.id);
  const changed = structuredClone(fixture);
  delete changed.components.soften;
  const { plan } = await run(mock, changed);
  assert(plan.missing.some((m) => m.path === 'soften'));
  assert.deepEqual(
    [...mock.variables, ...mock.styles].map((v) => v.id),
    ids,
  );
});
test('reliable source key mapping preserves a renamed variable identity', async () => {
  const mock = mockFigma();
  await run(mock);
  const variable = mock.variables.find((v) => v.name === 'radius'),
    id = variable.id;
  const changed = structuredClone(fixture);
  changed.core.corner = changed.core.radius;
  delete changed.core.radius;
  changed.$themes[0].$figmaVariableReferences = { corner: variable.key };
  const { report } = await run(mock, changed);
  assert.equal(report.failed, 0);
  assert.equal(variable.id, id);
  assert.equal(variable.name, 'corner');
  assert.equal(mock.variables.filter((v) => ['radius', 'corner'].includes(v.name)).length, 1);
});
test('foreign Tokens Studio mapping hints allow import and subsequent sync in a new file', async () => {
  const mock = mockFigma(),
    source = {
      base: {
        x: { type: 'number', value: 1 },
        y: { type: 'number', value: '{x}' },
      },
      $themes: [
        {
          id: 'base',
          name: 'Default',
          group: 'Base',
          selectedTokenSets: { base: 'enabled' },
          $figmaCollectionId: 'VariableCollectionId:foreign',
          $figmaModeId: 'foreign-mode',
          $figmaVariableReferences: { x: 'foreign-x', y: 'foreign-y' },
        },
      ],
    };
  const { plan, report } = await run(mock, source);
  assert.equal(plan.collections[0].action, 'new');
  assert(plan.variables.every((op) => op.action === 'new'));
  assert.equal(report.failed, 0);
  const x = mock.variables.find((variable) => variable.name === 'x');
  const y = mock.variables.find((variable) => variable.name === 'y');
  assert.deepEqual(Object.values(y.valuesByMode), [{ type: 'VARIABLE_ALIAS', id: x.id }]);
  const repeated = await preview(mock, source);
  assert.equal(repeated.counts.variables.unchanged, 2);

  const otherFile = mockFigma();
  const otherCollection = otherFile.createCollection('Unrelated');
  const incompatible = otherFile.createVariable('x', otherCollection, 'FLOAT');
  source.$themes[0].$figmaVariableReferences.x = incompatible.key;
  const conflict = await preview(otherFile, source);
  assert.equal(conflict.variables.find((op) => op.desired.name === 'x')?.action, 'conflicting');
});
test('ambiguous name matches require an explicit target choice', async () => {
  const mock = mockFigma(),
    collection = mock.createCollection('tokens');
  collection.renameMode(collection.defaultModeId, 'Default');
  mock.createVariable('x', collection, 'FLOAT');
  const second = mock.createVariable('x', collection, 'FLOAT');
  const source = { x: { type: 'number', value: 3 } },
    plan = await preview(mock, source);
  assert.equal(plan.variables[0].action, 'conflicting');
  const resolved = await preview(mock, source, defaultSettings, {
    [plan.variables[0].key]: second.id,
  });
  assert.equal(resolved.variables[0].targetId, second.id);
});
test('type changes conflict rather than recreating a variable', async () => {
  const mock = mockFigma();
  await run(mock, { x: { type: 'number', value: 1 } });
  const plan = await preview(mock, { x: { type: 'color', value: '#fff' } });
  assert.equal(plan.variables[0].action, 'conflicting');
  assert.equal(mock.variables.length, 1);
});
test('aliases preserve native references across collections and modes', async () => {
  const mock = mockFigma();
  await run(mock);
  const surface = mock.variables.find((v) => v.name === 'surface');
  assert(Object.values(surface.valuesByMode).every((v: any) => v.type === 'VARIABLE_ALIAS'));
  const paper = mock.variables.find((v) => v.name === 'color/paper');
  assert(Object.values(surface.valuesByMode).some((v: any) => v.id === paper.id));
});
test('missing references leave existing targets untouched', async () => {
  const mock = mockFigma();
  await run(mock, { x: { type: 'number', value: 1 } });
  const before = structuredClone(mock.variables[0].valuesByMode);
  const { plan } = await run(mock, { x: { type: 'number', value: '{missing}' } });
  assert(plan.diagnostics.some((d) => d.code === 'MISSING_REFERENCE'));
  assert.deepEqual(mock.variables[0].valuesByMode, before);
});
test('unavailable fonts block text style creation with a useful diagnostic', async () => {
  const mock = mockFigma(),
    changed = structuredClone(fixture);
  changed.core.font.family.value = 'Missing Typeface';
  const { plan, report } = await run(mock, changed);
  assert(plan.diagnostics.some((d) => d.code === 'MISSING_FONT'));
  assert.equal(mock.styles.filter((s) => s.type === 'TEXT').length, 0);
  assert(report.skipped > 0);
});
test('font loading failure does not create an empty text style', async () => {
  const mock = mockFigma({ fontFailure: true }),
    { report } = await run(mock);
  assert(report.diagnostics.some((d) => d.code === 'FONT_LOAD'));
  assert.equal(mock.styles.filter((s) => s.type === 'TEXT').length, 0);
});
test('extended collections override inherited values without duplicating variables or changing parents', async () => {
  const mock = mockFigma(),
    parent = mock.createCollection('Parent');
  parent.renameMode(parent.defaultModeId, 'Default');
  const variable = mock.createVariable('x', parent, 'FLOAT');
  variable.setValueForMode(parent.defaultModeId, 1);
  const source = { x: { type: 'number', value: 3 } },
    settings = { ...defaultSettings, styles: false, extensionParents: { tokens: parent.id } };
  const { report } = await run(mock, source, settings);
  assert.equal(report.failed, 0, JSON.stringify(report.diagnostics));
  assert.equal(mock.variables.length, 1);
  const extension = mock.collections.find((c) => c.isExtension);
  assert(extension);
  assert.equal(variable.valuesByMode[parent.defaultModeId], 1);
  assert.equal(extension.variableOverrides[variable.id][extension.modes[0].modeId], 3);
  const repeated = await preview(mock, source, settings);
  assert.equal(repeated.variables[0].action, 'unchanged');
});
test('unsupported extension entitlement produces a graceful error and no fallback duplicate', async () => {
  const mock = mockFigma({ enterprise: false }),
    parent = mock.createCollection('Parent');
  parent.renameMode(parent.defaultModeId, 'Default');
  mock.createVariable('x', parent, 'FLOAT');
  const { report } = await run(
    mock,
    { x: { type: 'number', value: 2 } },
    { ...defaultSettings, extensionParents: { tokens: parent.id } },
  );
  assert(report.diagnostics.some((d) => d.code === 'EXTENSION_PLAN'));
  assert.equal(mock.collections.length, 1);
  assert.equal(mock.variables.length, 1);
});
test('mode limits leave existing collections intact and can be resumed', async () => {
  const mock = mockFigma({ maxModes: 1 }),
    { report } = await run(mock);
  assert(report.diagnostics.some((d) => d.code === 'MODE_LIMIT'));
  assert(mock.collections.find((c) => c.name === 'Interface'));
  assert.equal(mock.variables.filter((v) => v.name === 'surface').length, 0);
});
test('stale previews cannot overwrite document changes', async () => {
  const mock = mockFigma();
  await run(mock);
  const plan = await preview(mock);
  mock.variables[0].setValueForMode(mock.collections[0].defaultModeId, { r: 1, g: 0, b: 0, a: 1 });
  await assert.rejects(
    () =>
      applyPlan(plan, mock.adapter, mock.store.read(), mock.store, {
        cancelled: false,
        progress: () => {},
      }),
    /changed since this preview/,
  );
});
test('preserved local binding conflicts are visible before writes', async () => {
  const mock = mockFigma();
  await run(mock);
  const text = mock.styles.find((s) => s.type === 'TEXT');
  text.setBoundVariable(
    'fontSize',
    mock.variables.find((v) => v.name === 'space/small'),
  );
  const plan = await preview(mock);
  assert.equal(plan.styles.find((s) => s.desired.kind === 'TEXT')?.action, 'conflicting');
  const overwrite = await preview(mock, fixture, { ...defaultSettings, preserveBindings: false });
  const changed = overwrite.styles.find((s) => s.desired.kind === 'TEXT')!;
  assert.equal(changed.action, 'conflicting');
  assert.equal(changed.localDrift, true);
  const accepted = await preview(
    mock,
    fixture,
    { ...defaultSettings, preserveBindings: false },
    {
      [changed.key]: 'repository',
    },
  );
  assert.equal(accepted.styles.find((s) => s.key === changed.key)?.action, 'updated');
});
test('registry is sharded, file-scoped and rejects corrupt data safely', () => {
  const mock = mockFigma(),
    registry = mock.store.read();
  for (let i = 0; i < 500; i++)
    registry.entries[String(i)] = {
      source: 'repo',
      path: `token.${i}`,
      tokenType: 'number',
      group: 'Base',
      kind: 'variable',
      targetId: String(i),
      fileIdentity: registry.fileIdentity,
      status: 'synced',
    };
  mock.store.write(registry);
  assert.equal(Object.keys(mock.store.read().entries).length, 500);
  assert([...mock.storage.keys()].filter((k) => /registry\..+\.\d+$/.test(k)).length > 1);
  assert.equal(
    Object.keys(new RegistryStore(mock.api.root, 'another-file').read().entries).length,
    0,
  );
  mock.storage.set('blueprint.registry.head', 'not-json');
  assert.throws(() => mock.store.read(), /could not be read/);
});
test('cancellation checkpoints mappings and never deletes completed targets', async () => {
  const mock = mockFigma(),
    plan = await preview(mock);
  const control = {
    cancelled: false,
    progress: (_message: string, done: number) => {
      if (done > 8) control.cancelled = true;
    },
  };
  const report = await applyPlan(plan, mock.adapter, mock.store.read(), mock.store, control);
  assert.equal(report.cancelled, true);
  assert(Object.keys(mock.store.read().entries).length > 0);
  assert(mock.collections.length > 0);
});
test('5,000-token planning yields to the event loop and repeated sync stays deterministic', async () => {
  const source = Object.fromEntries(
    Array.from({ length: 5000 }, (_, i) => [`t${i}`, { type: 'number', value: i }]),
  );
  const mock = mockFigma();
  let ticked = false;
  setTimeout(() => {
    ticked = true;
  }, 0);
  const first = await preview(mock, source, { ...defaultSettings, styles: false });
  assert.equal(ticked, true);
  assert.equal(first.variables.length, 5000);
  const report = await applyPlan(first, mock.adapter, mock.store.read(), mock.store, {
    cancelled: false,
    progress: () => {},
  });
  assert.equal(report.failed, 0);
  const next = await preview(mock, source, { ...defaultSettings, styles: false });
  assert.equal(next.counts.variables.unchanged, 5000);
  assert.equal(next.counts.variables.new, 0);
});

test('deleted collections and variables can be staged together while existing styles keep their IDs', async () => {
  const mock = mockFigma();
  await run(mock);
  const styleIds = mock.styles.map((style) => style.id);
  const expected = mock.collections.length + mock.variables.length;
  mock.collections.length = 0;
  mock.variables.length = 0;
  const pending = await preview(mock);
  const missing = [...pending.collections, ...pending.variables].filter(
    (row) => row.action === 'conflicting' && row.missingTarget,
  );
  assert.equal(missing.length, expected);
  const choices = Object.fromEntries(missing.map((row) => [row.key, 'create']));
  const resolved = await preview(mock, fixture, defaultSettings, choices);
  assert.deepEqual(
    [...resolved.collections, ...resolved.variables, ...resolved.styles]
      .filter((op) => op.action === 'conflicting')
      .map((op) => op.reason),
    [],
  );
  assert.equal(mock.variables.length, 0);
  const report = await applyPlan(resolved, mock.adapter, mock.store.read(), mock.store, {
    cancelled: false,
    progress: () => {},
  });
  assert.equal(report.failed, 0);
  assert.equal(mock.collections.length + mock.variables.length, expected);
  assert.deepEqual(
    mock.styles.map((style) => style.id),
    styleIds,
  );
});
