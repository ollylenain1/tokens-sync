import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRepository } from '../src/core/parser';
import { TokenResolver } from '../src/core/resolver';
import { buildDesired } from '../src/core/desired';
import { defaultSettings, Token } from '../src/core/model';
import { color, numeric, primitive } from '../src/core/values';
import { effects, paints, typography } from '../src/core/composites';
import { fixture, project } from './helpers';
const tok = (type: string, value: unknown, dtcg = false): Token => ({
  path: 'test',
  type,
  value,
  dtcg,
  set: 'base',
});
test('parses legacy bundle, theme groups, modes and ordered token sets', () => {
  const p = project();
  assert.deepEqual(p.order, ['core', 'themes/light', 'themes/dark', 'components']);
  assert.equal(p.themes[1].group, 'Interface');
  assert.equal(p.themes[2].name, 'Dark');
});
test('source sets resolve without exporting; disabled sets cannot leak values', () => {
  const p = project(),
    r = new TokenResolver(p, p.themes[1], defaultSettings);
  assert.equal(r.resolve('surface'), '#ffffff');
  assert.equal(r.exported.has('color.paper'), false);
  assert.equal(r.resolve('shadowColor'), '#18223024');
});
test('later enabled sets override earlier definitions', () => {
  const p = project({
    a: { x: { type: 'number', value: 1 } },
    b: { x: { type: 'number', value: 2 } },
    $themes: [{ id: 't', name: 'T', selectedTokenSets: { a: 'enabled', b: 'enabled' } }],
    $metadata: { tokenSetOrder: ['b', 'a'] },
  });
  assert.equal(new TokenResolver(p, p.themes[0], defaultSettings).resolve('x'), 1);
});
test('multi-file nested sets match bundle layout without restructuring', () => {
  const files: Record<string, string> = {};
  for (const [key, value] of Object.entries(fixture))
    files[key.startsWith('$') ? `${key}.json` : `${key}.json`] = JSON.stringify(value);
  const p = parseRepository({
    identity: 'repo',
    revision: 'abc',
    fetchedAt: '',
    files,
    layout: 'auto',
  });
  assert.deepEqual(p.themes, project().themes);
  assert.deepEqual(p.order, project().order);
});
test('DTCG inherited group type, dimension objects and composites parse', async () => {
  const p = project(JSON.parse(readFileSync('fixtures/dtcg/tokens.json', 'utf8')));
  assert.equal(p.sets.tokens[0].type, 'color');
  const model = await buildDesired(p, defaultSettings);
  assert.equal(
    model.variables.find((v) => v.path === 'space.base')?.values['set:tokens'].literal,
    16,
  );
  assert.deepEqual(model.styles.find((s) => s.path === 'heading')?.data.lineHeight, {
    unit: 'PERCENT',
    value: 125,
  });
});
test('invalid JSON fails without echoing source content', () => {
  assert.throws(
    () =>
      parseRepository({
        identity: '',
        revision: '',
        fetchedAt: '',
        files: { 'bad.json': 'SECRET invalid JSON' },
        layout: 'auto',
      }),
    (e) => e instanceof Error && !e.message.includes('SECRET') && e.message.includes('bad.json'),
  );
});
test('missing references and circular composites are actionable', () => {
  const p = project({
    a: { type: 'number', value: '{b}' },
    b: { type: 'number', value: '{a}' },
    missing: { type: 'typography', value: { fontSize: '{nope}' } },
  });
  const r = new TokenResolver(p, p.themes[0], defaultSettings);
  assert.throws(() => r.resolve('a'), /Circular reference/);
  assert.throws(() => r.resolve('missing'), /Missing reference/);
});
test('unsupported DTCG extends and color modifiers never silently export', async () => {
  const p = project({
    group: { $extends: '{other}', x: { $type: 'number', $value: 1 } },
    color: {
      type: 'color',
      value: '#fff',
      $extensions: { 'studio.tokens': { modify: { type: 'darken' } } },
    },
  });
  const m = await buildDesired(p, defaultSettings);
  assert.equal(m.variables.length, 0);
  assert(m.diagnostics.some((d) => d.code === 'DTCG_REFERENCE'));
  assert(m.diagnostics.some((d) => d.code === 'COLOR_MODIFIER'));
});
test('numeric conversion handles rem and safe dimensional arithmetic', () => {
  assert.equal(numeric('1rem + 8px', 16), 24);
  assert.equal(numeric('(8px * 2) / 4'), 4);
  assert.equal(numeric('-2px'), -2);
  for (const x of ['calc(100% - 2px)', '2px * 3px', '1 / 0', '1em', '1px + 2', 'Infinity'])
    assert.throws(() => numeric(x));
});
test('color parser supports alpha, CSS functions and rejects out-of-gamut structured colors', () => {
  assert.deepEqual(color('#ffffff80'), { r: 1, g: 1, b: 1, a: 128 / 255 });
  assert.equal(color('rgba(255, 0, 0, 0.5)').a, 0.5);
  assert.throws(() => color({ colorSpace: 'display-p3', components: [1, 0, 0] }), /sRGB/);
});
test('primitive opacity and type validation are strict', () => {
  assert.equal(primitive(tok('opacity', '50%'), '50%', 16)?.literal, 0.5);
  assert.throws(() => primitive(tok('boolean', 'false'), 'false', 16), /Boolean/);
  assert.throws(() => primitive(tok('number', '2px'), '2px', 16), /unitless/);
});
test('typography converts all supported properties without silently accepting extras', () => {
  const raw = {
    fontFamily: 'Inter',
    fontWeight: 700,
    fontSize: '2rem',
    lineHeight: '150%',
    letterSpacing: '2%',
    paragraphSpacing: 8,
    paragraphIndent: 2,
    textCase: 'uppercase',
    textDecoration: 'underline',
  };
  const result = typography(raw, raw, tok('typography', raw), 16);
  assert.deepEqual(result.data.fontName, { family: 'Inter', style: 'Bold' });
  assert.equal(result.data.fontSize, 32);
  assert.equal(result.data.textCase, 'UPPER');
  assert.throws(
    () => typography({ ...raw, fontStretch: 'condensed' }, raw, tok('typography', raw), 16),
    /fontStretch/,
  );
});
test('multiple shadows preserve order, inner type, spread and alpha', () => {
  const layers = [
    { x: 1, y: 2, blur: 4, spread: -1, color: '#00000080', opacity: 0.5 },
    { x: 0, y: 1, blur: 2, color: '#fff', type: 'innerShadow' },
  ];
  const result = effects(layers, layers, tok('boxShadow', layers), 16).data.effects as any[];
  assert.deepEqual(
    result.map((e) => e.type),
    ['DROP_SHADOW', 'INNER_SHADOW'],
  );
  assert.equal(result[0].spread, -1);
  assert.equal(result[0].color.a, 64 / 255);
});
test('DTCG shadows use offset fields and structured dimensions', () => {
  const shadow = {
    offsetX: { value: 1, unit: 'rem' },
    offsetY: 2,
    blur: 4,
    color: '#000',
    inset: true,
  };
  const result = effects(shadow, shadow, tok('shadow', shadow, true), 16).data.effects as any[];
  assert.equal(result[0].offset.x, 16);
  assert.equal(result[0].type, 'INNER_SHADOW');
});
test('layer/background blur is explicit and validated', () => {
  assert.equal(
    (effects(12, 12, tok('backgroundBlur', 12), 16).data.effects as any[])[0].type,
    'BACKGROUND_BLUR',
  );
  assert.throws(() => effects(-1, -1, tok('blur', -1), 16), /negative/);
});
test('linear gradient stops, references and horizontal transform are correct', () => {
  const value = 'linear-gradient(90deg, #000 0%, rgba(255,255,255,0.5) 100%)';
  const result = paints(value, 'linear-gradient(90deg, {ink} 0%, #fff 100%)', tok('color', value));
  const paint = (result.data.paints as any[])[0];
  assert.equal(paint.type, 'GRADIENT_LINEAR');
  assert.equal(paint.gradientStops[1].color.a, 0.5);
  assert(Math.abs(paint.gradientTransform[0][0] - 1) < 1e-8);
  assert.equal(result.references[0].path, 'ink');
});
test('radial subset works; unsupported gradient geometry fails explicitly', () => {
  assert.equal(
    (
      paints('radial-gradient(ellipse at center, #000 0%, #fff 100%)', '', tok('color', '')).data
        .paints as any[]
    )[0].type,
    'GRADIENT_RADIAL',
  );
  for (const value of [
    'linear-gradient(to right, #fff, #000)',
    'repeating-linear-gradient(90deg, #fff 0%, #000 100%)',
    'radial-gradient(circle at 20% 20%, #fff 0%, #000 100%)',
  ])
    assert.throws(() => paints(value, value, tok('color', value)));
});
test('model builds aliases across groups, binds styles and uses one shared linked style', async () => {
  const model = await buildDesired(project(), defaultSettings);
  const surface = model.variables.find((v) => v.path === 'surface')!;
  assert(surface.values.light.alias?.includes('Foundations'));
  assert(surface.values.dark.alias?.includes('color.ink'));
  const body = model.styles.filter((s) => s.path === 'body');
  assert.equal(body.length, 1);
  assert.equal(body[0].theme, 'linked');
  assert(body[0].bindings.some((b) => b.field === 'fontSize'));
});
test('theme-specific styles use separate names and resolved literals', async () => {
  const model = await buildDesired(project(), { ...defaultSettings, styleStrategy: 'themes' });
  const elevation = model.styles.filter((s) => s.path === 'elevation');
  assert.equal(elevation.length, 2);
  assert.notEqual(elevation[0].name, elevation[1].name);
  assert(elevation.every((s) => !s.bindings.length));
});
test('unbound theme differences force separate literal styles', async () => {
  const data = structuredClone(fixture);
  data['themes/light'].headingCase = { type: 'textCase', value: 'uppercase' };
  data['themes/dark'].headingCase = { type: 'textCase', value: 'lowercase' };
  data.components.body.value.textCase = '{headingCase}';
  const model = await buildDesired(project(data), defaultSettings);
  assert.equal(model.styles.filter((s) => s.path === 'body').length, 2);
  assert(model.styles.filter((s) => s.path === 'body').every((s) => s.bindings.length === 0));
});
test('border and multi-value radius use disclosed scalar output, composition is unsupported', async () => {
  const model = await buildDesired(
    project({
      border: { type: 'border', value: { color: '#fff', width: '1px', style: 'solid' } },
      corners: { type: 'borderRadius', value: '4px 8px' },
      layout: { type: 'composition', value: { padding: 4 } },
    }),
    defaultSettings,
  );
  assert.equal(model.variables.length, 7);
  assert(model.diagnostics.some((d) => d.code === 'PARTIAL_COMPOSITE'));
  assert(model.diagnostics.some((d) => d.code === 'UNSUPPORTED' && d.token === 'layout'));
});
