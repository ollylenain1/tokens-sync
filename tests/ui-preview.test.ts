import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDesired } from '../src/core/desired';
import { defaultSettings, Settings } from '../src/core/model';
import { planSync, emptyRegistry } from '../src/sync/planner';
import {
  conflictCount,
  formatLiteral,
  isIncluded,
  previewPayload,
  toggleList,
  visibleRows,
} from '../src/ui/preview-model';
import { project } from './helpers';

async function makePlan(settings: Settings = defaultSettings) {
  return planSync(
    await buildDesired(project(), settings),
    { identity: 'test', collections: [], variables: [], styles: [] },
    emptyRegistry('test'),
  );
}

test('shared preview preserves ordered modes, color alpha, scalar values and alias identities', async () => {
  const plan = await makePlan();
  const original = JSON.stringify(plan);
  const preview = previewPayload(plan);
  const collection = preview.collections.find((row) => row.name === 'Interface')!;
  assert.deepEqual(collection.modes, [
    { key: 'light', name: 'Light' },
    { key: 'dark', name: 'Dark' },
  ]);
  const surface = preview.variables.find((row) => row.path === 'surface')!;
  assert.equal(formatLiteral(surface.values.light.literal), '#ffffff');
  assert.equal(formatLiteral(surface.values.dark.literal), '#182230');
  assert.equal(
    preview.variables.find((row) => row.key === surface.values.light.alias)?.path,
    'color.paper',
  );
  assert.equal(
    preview.variables.find((row) => row.path === 'space.medium')?.values.core.literal,
    16,
  );
  assert.equal(preview.variables.find((row) => row.path === 'enabled')?.values.core.literal, true);
  assert.equal(
    formatLiteral(
      preview.variables.find((row) => row.path === 'shadowColor')!.values.light.literal,
    ),
    '#18223024',
  );
  preview.collections[0].modes[0].name = 'Changed by UI';
  surface.values.light.literal = '#000000';
  assert.equal(JSON.stringify(plan), original, 'Presentation state must not mutate a sync plan');
  assert(!('model' in preview));
  assert(!('documentStamp' in preview));
  assert.equal(formatLiteral(0.000001), '0.000001');
});

test('style summaries distinguish linked output from theme-specific output without mode columns', async () => {
  const preview = previewPayload(await makePlan());
  const text = preview.styles.find((row) => row.path === 'body')!;
  assert.equal(text.theme, 'Linked');
  assert.equal(text.summary, 'Inter Regular · 16 px');
  assert(text.bindings.length > 0);
  assert(!('values' in text));
  assert.equal(
    preview.styles.find((row) => row.path === 'hero')?.summary,
    'gradient linear · 2 stops',
  );
  assert.equal(
    preview.styles.find((row) => row.path === 'shadowColor' && row.theme === 'Light')?.summary,
    '#18223024',
  );
  const themed = previewPayload(await makePlan({ ...defaultSettings, styleStrategy: 'themes' }));
  assert.deepEqual(
    themed.styles.filter((row) => row.path === 'body').map((row) => row.theme),
    ['Light', 'Dark'],
  );
});

test('collection browsing and search are independent of export inclusion, including exclude-all', async () => {
  const preview = previewPayload(await makePlan());
  const selection: string[] = [];
  assert(
    visibleRows(preview.variables, 'Interface', 'SURFACE').every(
      (row) => row.group === 'Interface',
    ),
  );
  assert.equal(visibleRows(preview.variables, 'Interface', 'SURFACE').length, 1);
  assert.equal(visibleRows(preview.variables, 'Foundations', 'surface').length, 0);
  assert.deepEqual(selection, []);
  assert(isIncluded(selection, 'Foundations'));
  const interfaceOnly = toggleList(selection, ['Foundations', 'Interface'], 'Foundations', false);
  assert.deepEqual(interfaceOnly, ['Interface']);
  const none = toggleList(interfaceOnly, ['Foundations', 'Interface'], 'Interface', false);
  assert(!isIncluded(none, 'Foundations'));
  assert(!isIncluded(none, 'Interface'));
  const excluded = previewPayload(await makePlan({ ...defaultSettings, groups: none }));
  assert.equal(excluded.variables.length, 0);
  assert.equal(excluded.styles.length, 0);
  assert.equal(excluded.canSync, false);
});

test('conflict totals and filtering include collection conflicts outside the current browsing scope', async () => {
  const plan = await makePlan();
  plan.collections[0].action = 'conflicting';
  plan.collections[0].reason = 'Two local collections have this name.';
  const preview = previewPayload(plan);
  assert.equal(conflictCount(preview), 1);
  assert.equal(visibleRows(preview.collections, 'Interface', '', 'conflicting').length, 0);
  assert.equal(visibleRows(preview.collections, '', '', 'conflicting').length, 1);
});

test('Changes filter includes new, updated and conflicting output within scope and search', async () => {
  const preview = previewPayload(await makePlan());
  const rows = preview.variables.filter((row) => row.group === 'Foundations');
  rows[0].action = 'unchanged';
  rows[1].action = 'skipped';
  rows[2].action = 'updated';
  rows[3].action = 'conflicting';
  const changes = visibleRows(preview.variables, 'Foundations', '', 'changed');
  assert.equal(changes.length, rows.length - 2);
  assert(changes.some((row) => row.action === 'new'));
  assert(changes.some((row) => row.action === 'updated'));
  assert(changes.some((row) => row.action === 'conflicting'));
  assert(changes.every((row) => row.group === 'Foundations'));
  assert.deepEqual(visibleRows(preview.variables, 'Foundations', rows[2].name, 'changed'), [
    rows[2],
  ]);
  assert.equal(visibleRows(preview.variables, 'Foundations', '', 'all').length, rows.length);
});
