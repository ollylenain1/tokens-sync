import { Dict, StyleData, SyncError, Token, VariableType, record } from './model';
import { color, isGradient, metric, nonnegative, numeric, opacity } from './values';
import { exactReference } from './resolver';
export interface CompositeResult {
  kind: 'TEXT' | 'EFFECT' | 'PAINT';
  data: StyleData;
  references: { field: string; path: string; type: VariableType }[];
  warnings: string[];
}
const weightNames: Record<string, string> = {
  '100': 'Thin',
  '200': 'Extra Light',
  '300': 'Light',
  '400': 'Regular',
  '500': 'Medium',
  '600': 'Semi Bold',
  '700': 'Bold',
  '800': 'Extra Bold',
  '900': 'Black',
};
export function fontStyle(weight: unknown, style?: unknown): string {
  if (weight === undefined)
    throw new SyncError('FONT', 'Typography requires fontWeight or fontStyle.');
  const name = weightNames[String(weight)] ?? String(weight);
  if (style === undefined || style === 'normal') return name;
  if (String(style).toLowerCase() === 'italic')
    return name === 'Regular' ? 'Italic' : `${name} Italic`;
  // An explicit native font style name is allowed; availability is verified by the adapter.
  return String(style);
}
function rejectUnknown(value: Dict, allowed: string[], context: string) {
  const extras = Object.keys(value).filter((k) => !allowed.includes(k));
  if (extras.length)
    throw new SyncError(
      'COMPOSITE_PROPERTY',
      `${context} properties are unsupported: ${extras.join(', ')}. The entire style is skipped to avoid a partial conversion.`,
    );
}
function ref(result: CompositeResult, field: string, raw: unknown, type: VariableType) {
  const path = exactReference(raw);
  if (path) result.references.push({ field, path, type });
}
export function typography(
  value: unknown,
  raw: unknown,
  token: Token,
  root: number,
): CompositeResult {
  if (!record(value))
    throw new SyncError('TYPOGRAPHY', 'Typography must resolve to a composite object.');
  rejectUnknown(
    value,
    [
      'fontFamily',
      'fontWeight',
      'fontStyle',
      'fontSize',
      'lineHeight',
      'letterSpacing',
      'paragraphSpacing',
      'paragraphIndent',
      'textCase',
      'textDecoration',
    ],
    'Typography',
  );
  if (
    typeof value.fontFamily !== 'string' ||
    !value.fontFamily.trim() ||
    value.fontFamily.includes(',')
  )
    throw new SyncError(
      'FONT',
      'Use one explicit font family. Font fallback lists are not supported.',
    );
  const size = numeric(value.fontSize, root);
  if (size <= 0) throw new SyncError('FONT_SIZE', 'Font size must be greater than zero.');
  const cases: Record<string, string> = {
    none: 'ORIGINAL',
    original: 'ORIGINAL',
    uppercase: 'UPPER',
    lowercase: 'LOWER',
    capitalize: 'TITLE',
    'small-caps': 'SMALL_CAPS',
    'small-caps-forced': 'SMALL_CAPS_FORCED',
  };
  const decorations: Record<string, string> = {
    none: 'NONE',
    underline: 'UNDERLINE',
    'line-through': 'STRIKETHROUGH',
    strikethrough: 'STRIKETHROUGH',
  };
  const textCase = cases[String(value.textCase ?? 'none').toLowerCase()],
    textDecoration = decorations[String(value.textDecoration ?? 'none').toLowerCase()];
  if (!textCase || !textDecoration)
    throw new SyncError('TEXT_FORMAT', 'Unsupported textCase or textDecoration value.');
  const lineHeight = metric(value.lineHeight, root, true, token.dtcg);
  if ('value' in lineHeight) nonnegative(lineHeight.value);
  const result: CompositeResult = {
    kind: 'TEXT',
    data: {
      fontName: {
        family: value.fontFamily,
        style: fontStyle(value.fontWeight ?? value.fontStyle, value.fontStyle),
      },
      fontSize: size,
      lineHeight,
      letterSpacing: metric(value.letterSpacing, root),
      paragraphSpacing: nonnegative(numeric(value.paragraphSpacing ?? 0, root)),
      paragraphIndent: numeric(value.paragraphIndent ?? 0, root),
      textCase,
      textDecoration,
    },
    references: [],
    warnings: [],
  };
  if (record(raw)) {
    ref(result, 'fontName.family', raw.fontFamily, 'STRING');
    if (typeof value.fontWeight === 'string' && !/^\d+$/.test(value.fontWeight) && !value.fontStyle)
      ref(result, 'fontName.style', raw.fontWeight, 'STRING');
    // Numeric weights need installed-font matching, so retain the explicit style selection.
    for (const field of ['fontSize', 'paragraphSpacing', 'paragraphIndent'])
      ref(result, field, raw[field], 'FLOAT');
    for (const field of ['lineHeight', 'letterSpacing'])
      if (record(result.data[field]) && result.data[field].unit === 'PIXELS')
        ref(result, `${field}.value`, raw[field], 'FLOAT');
  }
  return result;
}
export function effects(value: unknown, raw: unknown, token: Token, root: number): CompositeResult {
  const result: CompositeResult = {
    kind: 'EFFECT',
    data: { effects: [] },
    references: [],
    warnings: [],
  };
  if (['blur', 'layerblur', 'backgroundblur'].includes(token.type.toLowerCase())) {
    if (record(value)) rejectUnknown(value, ['radius', 'type'], 'Blur');
    const kind = record(value) ? (value.type ?? token.type) : token.type;
    if (
      ![
        'blur',
        'layerBlur',
        'backgroundBlur',
        'LAYER_BLUR',
        'BACKGROUND_BLUR',
        'layerblur',
        'backgroundblur',
      ].includes(String(kind))
    )
      throw new SyncError('BLUR', 'Unsupported blur type.');
    const effect = {
      type: /background/i.test(String(kind)) ? 'BACKGROUND_BLUR' : 'LAYER_BLUR',
      radius: nonnegative(numeric(record(value) ? value.radius : value, root)),
      visible: true,
      blurType: 'NORMAL',
    };
    result.data.effects = [effect];
    ref(result, 'effects.0.radius', record(raw) ? raw.radius : token.value, 'FLOAT');
    return result;
  }
  const layers = Array.isArray(value) ? value : [value],
    rawLayers = Array.isArray(raw) ? raw : [raw];
  if (!layers.length)
    throw new SyncError('SHADOW', 'A shadow token must contain at least one shadow.');
  result.data.effects = layers.map((layer, i) => {
    if (!record(layer)) throw new SyncError('SHADOW', 'Each shadow must be a composite object.');
    rejectUnknown(
      layer,
      ['x', 'y', 'blur', 'spread', 'color', 'type', 'opacity', 'offsetX', 'offsetY', 'inset'],
      'Shadow',
    );
    const kind =
      layer.type ??
      (layer.inset === true || token.type.toLowerCase() === 'innershadow'
        ? 'innerShadow'
        : 'dropShadow');
    if (!['dropShadow', 'innerShadow', 'DROP_SHADOW', 'INNER_SHADOW'].includes(String(kind)))
      throw new SyncError('SHADOW_TYPE', 'Unsupported shadow type.');
    const rgba = color(layer.color);
    if (layer.opacity !== undefined) rgba.a *= opacity(layer.opacity);
    const x = layer.x ?? layer.offsetX,
      y = layer.y ?? layer.offsetY;
    if (x === undefined || y === undefined || layer.blur === undefined)
      throw new SyncError('SHADOW', 'Shadow requires x/offsetX, y/offsetY, blur and color.');
    const original = rawLayers[i];
    if (record(original)) {
      const fields: [string, unknown, VariableType][] = [
        ['offset.x', original.x ?? original.offsetX, 'FLOAT'],
        ['offset.y', original.y ?? original.offsetY, 'FLOAT'],
        ['radius', original.blur, 'FLOAT'],
        ['spread', original.spread, 'FLOAT'],
      ];
      if (layer.opacity === undefined || opacity(layer.opacity) === 1)
        fields.push(['color', original.color, 'COLOR']);
      else if (exactReference(original.color))
        result.warnings.push(
          'Shadow opacity multiplies color alpha; this color reference is resolved to a literal.',
        );
      for (const [field, v, type] of fields) ref(result, `effects.${i}.${field}`, v, type);
    }
    return {
      type: /inner/i.test(String(kind)) ? 'INNER_SHADOW' : 'DROP_SHADOW',
      color: rgba,
      offset: { x: numeric(x, root), y: numeric(y, root) },
      radius: nonnegative(numeric(layer.blur, root)),
      spread: numeric(layer.spread ?? 0, root),
      visible: true,
      blendMode: 'NORMAL',
      ...(/inner/i.test(String(kind)) ? {} : { showShadowBehindNode: true }),
    };
  });
  return result;
}
function splitComma(input: string): string[] {
  let depth = 0,
    start = 0;
  const parts: string[] = [];
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '(') depth++;
    if (input[i] === ')') depth--;
    if (input[i] === ',' && depth === 0) {
      parts.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(input.slice(start).trim());
  return parts;
}
export function paints(value: unknown, raw: unknown, token: Token): CompositeResult {
  const result: CompositeResult = { kind: 'PAINT', data: {}, references: [], warnings: [] };
  if (token.type.toLowerCase() === 'color' && !isGradient(value)) {
    const rgba = color(value);
    result.data.paints = [
      { type: 'SOLID', color: { r: rgba.r, g: rgba.g, b: rgba.b }, opacity: rgba.a },
    ];
    ref(result, 'paints.0.color', token.value, 'COLOR');
    return result;
  }
  let kind = 'GRADIENT_LINEAR',
    angle = 90,
    stops: { color: unknown; position: number; raw?: unknown }[];
  if (Array.isArray(value)) {
    stops = value.map((stop, i) => {
      if (!record(stop) || typeof stop.position !== 'number')
        throw new SyncError('GRADIENT', 'DTCG gradient stops require color and numeric position.');
      rejectUnknown(stop, ['color', 'position'], 'Gradient stop');
      const original = Array.isArray(raw) ? raw[i] : undefined;
      return {
        color: stop.color,
        position: stop.position,
        raw: record(original) ? original.color : undefined,
      };
    });
    result.warnings.push(
      'DTCG gradient stops contain no geometry. Exported as a horizontal linear gradient (90°).',
    );
  } else if (typeof value === 'string') {
    const match = /^(linear-gradient|radial-gradient)\((.*)\)$/i.exec(value.trim());
    if (!match)
      throw new SyncError(
        'GRADIENT',
        'Only explicit CSS linear gradients, centered radial gradients and DTCG stop arrays are supported.',
      );
    const parts = splitComma(match[2]);
    const rawMatch =
      typeof raw === 'string'
        ? /^(?:linear-gradient|radial-gradient)\((.*)\)$/i.exec(raw.trim())
        : undefined;
    const originalParts = rawMatch ? splitComma(rawMatch[1]) : [];
    if (match[1].toLowerCase() === 'linear-gradient') {
      if (!/^-?(?:\d*\.)?\d+deg$/.test(parts[0]))
        throw new SyncError(
          'GRADIENT_GEOMETRY',
          'Linear gradients require an explicit angle in degrees.',
        );
      angle = parseFloat(parts.shift()!);
      originalParts.shift();
    } else {
      if (!['circle', 'ellipse', 'circle at center', 'ellipse at center'].includes(parts[0]))
        throw new SyncError(
          'GRADIENT_GEOMETRY',
          'Radial gradients require circle or ellipse at center; explicit sizes and positions are unsupported.',
        );
      if (parts[0].startsWith('circle'))
        result.warnings.push(
          'Radial circle geometry is normalized to the style bounds; non-square consumers render an ellipse.',
        );
      kind = 'GRADIENT_RADIAL';
      parts.shift();
      originalParts.shift();
    }
    stops = parts.map((part, i) => {
      const stop = /^(.*?)\s+(-?(?:\d*\.)?\d+)%$/.exec(part);
      if (!stop)
        throw new SyncError(
          'GRADIENT_STOP',
          'Every gradient stop needs one explicit percentage position.',
        );
      return {
        color: stop[1],
        position: Number(stop[2]) / 100,
        raw: /^(.*?)\s+[-\d.]+%$/.exec(originalParts[i] ?? '')?.[1],
      };
    });
  } else throw new SyncError('GRADIENT', 'Unsupported gradient structure.');
  if (
    stops.length < 2 ||
    stops.some(
      (s, i) =>
        !Number.isFinite(s.position) ||
        s.position < 0 ||
        s.position > 1 ||
        (i > 0 && s.position < stops[i - 1].position),
    )
  )
    throw new SyncError(
      'GRADIENT_STOP',
      'Gradient positions must be ordered from 0 to 1 with at least two stops.',
    );
  const theta = (angle * Math.PI) / 180,
    dx = Math.sin(theta),
    dy = -Math.cos(theta);
  // CSS angle on a normalized square: project onto its enclosing gradient line.
  const length = Math.abs(dx) + Math.abs(dy);
  const transform =
    kind === 'GRADIENT_RADIAL'
      ? [
          [1, 0, 0],
          [0, 1, 0],
        ]
      : [
          [dx / length, dy / length, 0.5 - (dx + dy) / (2 * length)],
          [-dy / length, dx / length, 0.5 - (dx - dy) / (2 * length)],
        ];
  result.data.paints = [
    {
      type: kind,
      gradientTransform: transform,
      gradientStops: stops.map((s, i) => {
        ref(result, `paints.0.gradientStops.${i}.color`, s.raw, 'COLOR');
        return { position: s.position, color: color(s.color) };
      }),
      opacity: 1,
    },
  ];
  return result;
}
export function composite(
  token: Token,
  value: unknown,
  raw: unknown,
  root: number,
): CompositeResult | undefined {
  const type = token.type.toLowerCase();
  if (type === 'typography') return typography(value, raw, token, root);
  if (['boxshadow', 'shadow', 'innershadow', 'blur', 'layerblur', 'backgroundblur'].includes(type))
    return effects(value, raw, token, root);
  if (type === 'color' || type === 'gradient') return paints(value, raw, token);
  return undefined;
}
