import { test } from 'node:test';
import assert from 'node:assert/strict';
import { styleSpecimen } from '../src/ui/style-specimen';
import { buildDesired } from '../src/core/desired';
import { defaultSettings } from '../src/core/model';
import { emptyRegistry, planSync } from '../src/sync/planner';
import { previewPayload } from '../src/ui/preview-model';
import { project } from './helpers';

test('gradient specimens retain stop colors, alpha and positions without accepting injected CSS', () => {
  const result = styleSpecimen('PAINT', {
    paints: [
      {
        type: 'GRADIENT_LINEAR',
        opacity: 0.5,
        gradientStops: [
          { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
          { position: 0.75, color: { r: 0, g: 0, b: 1, a: 0.5 } },
        ],
      },
    ],
  });
  assert.equal(
    result?.css,
    'background:linear-gradient(90deg,rgba(255,0,0,0.5) 0%,rgba(0,0,255,0.25) 75%)',
  );
  assert.match(result!.label, /Approximate/);
  assert.equal(
    styleSpecimen('PAINT', {
      paints: [{ type: 'SOLID', color: { r: 'url(example.com)', g: 0, b: 0 } }],
    }),
    undefined,
  );
});

test('shadow specimens include all visible layers and decline unsupported blur approximations', () => {
  const shadow = {
    type: 'DROP_SHADOW',
    offset: { x: 2, y: 4 },
    radius: 8,
    spread: 1,
    color: { r: 0, g: 0, b: 0, a: 0.2 },
  };
  const result = styleSpecimen('EFFECT', {
    effects: [shadow, { ...shadow, type: 'INNER_SHADOW' }, { ...shadow, visible: false }],
  });
  assert.equal(
    result?.css,
    'box-shadow:2px 4px 8px 1px rgba(0,0,0,0.2),inset 2px 4px 8px 1px rgba(0,0,0,0.2)',
  );
  assert.equal(
    styleSpecimen('EFFECT', { effects: [shadow, { type: 'LAYER_BLUR', radius: 4 }] }),
    undefined,
  );
});

test('style inspection includes full typography, gradient and effect properties without sharing mutable source data', async () => {
  const plan = planSync(
    await buildDesired(project(), defaultSettings),
    { identity: 'test', collections: [], variables: [], styles: [] },
    emptyRegistry('test'),
  );
  const preview = previewPayload(plan);
  const text = preview.styles.find((row) => row.type === 'TEXT')!;
  assert(text.data?.lineHeight);
  assert(text.data?.letterSpacing);
  assert(text.changes?.some((change) => change.field.includes('lineHeight')));
  const gradient = preview.styles.find((row) =>
    JSON.stringify(row.data).includes('gradientStops'),
  )!;
  assert(styleSpecimen(gradient.type, gradient.data!));
  const shadow = preview.styles.find((row) => JSON.stringify(row.data).includes('DROP_SHADOW'))!;
  assert(styleSpecimen(shadow.type, shadow.data!));
  text.data!.fontSize = 999;
  assert.notEqual(plan.styles.find((op) => op.key === text.key)!.desired.data.fontSize, 999);
});
