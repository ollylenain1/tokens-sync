import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../src/core/model';
import { buildDesired } from '../src/core/desired';
import { emptyRegistry, planSync } from '../src/sync/planner';
import { previewPayload } from '../src/ui/preview-model';
import {
  omittedCount,
  previewStatus,
  reportHasIssues,
  reportTitle,
  syncNotification,
} from '../src/ui/sync-status';
import { fixture, project } from './helpers';

test('conversion omissions cannot appear as an unqualified successful or up-to-date result', async () => {
  const source = structuredClone(fixture);
  source.core.invalid = { type: 'color', value: 'invalid-color' };
  const plan = planSync(
    await buildDesired(project(source), defaultSettings),
    { identity: 'test', collections: [], variables: [], styles: [] },
    emptyRegistry('test'),
  );
  const preview = previewPayload(plan);
  assert.equal(omittedCount(preview), 1);
  assert.equal(previewStatus(preview), 'Needs attention');
  preview.canSync = false;
  assert.equal(previewStatus(preview), 'Needs attention');
  const report = {
    created: 1,
    updated: 0,
    unchanged: 0,
    skipped: 1,
    failed: 0,
    cancelled: false,
    diagnostics: plan.diagnostics,
  };
  assert(reportHasIssues(report));
  assert.equal(reportTitle(report), 'Synced with 1 skipped item');
  assert.equal(syncNotification(report), 'Synced with 1 skipped item · 1 created');
  assert.equal(syncNotification({ ...report, cancelled: true }), 'Sync stopped · 1 created');
  assert.equal(
    syncNotification({ ...report, failed: 2 }),
    'Sync finished with 2 failed items · 1 created',
  );
});

test('status follows the current plan when settings introduce work after a successful sync', async () => {
  const plan = planSync(
    await buildDesired(project(), defaultSettings),
    { identity: 'test', collections: [], variables: [], styles: [] },
    emptyRegistry('test'),
  );
  const preview = previewPayload(plan);
  assert.equal(previewStatus(preview), 'Ready to sync');
  preview.canSync = false;
  assert.equal(previewStatus(preview), 'Up to date');
  preview.collections[0].action = 'conflicting';
  assert.equal(previewStatus(preview), 'Needs review');
});
