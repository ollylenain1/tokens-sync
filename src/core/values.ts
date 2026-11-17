import Color from 'colorjs.io';
import { Literal, SyncError, Token, VariableType, record } from './model';

export function numeric(input: unknown, root = 16, unitless = false): number {
  if (record(input)) {
    if (typeof input.value !== 'number' || !['px', 'rem'].includes(String(input.unit)))
      throw new SyncError('UNIT', 'Only px and rem dimension objects are supported.');
    if (unitless) throw new SyncError('UNIT', 'This token requires a unitless number.');
    return finite(input.value * (input.unit === 'rem' ? root : 1));
  }
  if (typeof input === 'number') return finite(input);
  if (typeof input !== 'string' || input.length > 1000)
    throw new SyncError('NUMBER', 'Expected a finite number, px or rem dimension.');
  const text = input.trim();
  const matches = text.match(/(?:\d*\.?\d+(?:e[+-]?\d+)?)(?:px|rem)?|[()+*/-]/gi) ?? [];
  if (!matches.length || matches.join('') !== text.replace(/\s/g, ''))
    throw new SyncError(
      'UNIT',
      'Unsupported number or unit. Use numbers, px, rem, or simple arithmetic. Percentages require a property-specific context.',
    );
  let pos = 0;
  type Quantity = { value: number; dimension: boolean };
  function atom(depth: number): Quantity {
    if (depth > 30) throw new SyncError('MATH', 'Arithmetic nesting is too deep.');
    const part = matches[pos++];
    if (part === '+' || part === '-') {
      const x = atom(depth + 1);
      return { ...x, value: x.value * (part === '-' ? -1 : 1) };
    }
    if (part === '(') {
      const x = sum(depth + 1);
      if (matches[pos++] !== ')') throw new SyncError('MATH', 'Unbalanced arithmetic expression.');
      return x;
    }
    if (!part || !/^\d*\.?\d/.test(part))
      throw new SyncError('MATH', 'Invalid arithmetic expression.');
    const unit = /rem$|px$/.exec(part)?.[0];
    return { value: parseFloat(part) * (unit === 'rem' ? root : 1), dimension: !!unit };
  }
  function product(depth: number): Quantity {
    let x = atom(depth);
    while (matches[pos] === '*' || matches[pos] === '/') {
      const op = matches[pos++],
        y = atom(depth);
      if (op === '*' && x.dimension && y.dimension)
        throw new SyncError('MATH', 'Multiplying two dimensions cannot produce a Figma float.');
      if (op === '/' && (!y.value || (!x.dimension && y.dimension)))
        throw new SyncError('MATH', 'Invalid dimensional division or division by zero.');
      x = {
        value: op === '*' ? x.value * y.value : x.value / y.value,
        dimension: op === '*' ? x.dimension || y.dimension : x.dimension && !y.dimension,
      };
    }
    return x;
  }
  function sum(depth: number): Quantity {
    let x = product(depth);
    while (matches[pos] === '+' || matches[pos] === '-') {
      const op = matches[pos++],
        y = product(depth);
      if (x.dimension !== y.dimension)
        throw new SyncError('MATH', 'Addition/subtraction requires matching units.');
      x = { value: op === '+' ? x.value + y.value : x.value - y.value, dimension: x.dimension };
    }
    return x;
  }
  const result = sum(0);
  if (pos !== matches.length || (unitless && result.dimension))
    throw new SyncError('NUMBER', 'Expected a complete unitless numeric expression.');
  return finite(result.value);
}
export function finite(value: number): number {
  if (!Number.isFinite(value)) throw new SyncError('NUMBER', 'Values must be finite numbers.');
  return Object.is(value, -0) ? 0 : value;
}
export function nonnegative(value: number): number {
  if (value < 0) throw new SyncError('RANGE', 'This property cannot be negative.');
  return value;
}
export function opacity(value: unknown): number {
  const n =
    typeof value === 'string' && value.trim().endsWith('%')
      ? numeric(value.trim().slice(0, -1), 16, true) / 100
      : numeric(value, 16, true);
  if (n < 0 || n > 1)
    throw new SyncError('OPACITY', 'Opacity must be between 0 and 1, or 0% and 100%.');
  return n;
}
export function color(value: unknown): { r: number; g: number; b: number; a: number } {
  let components: number[], alpha: number;
  if (record(value)) {
    if (
      value.colorSpace !== 'srgb' ||
      !Array.isArray(value.components) ||
      value.components.length !== 3 ||
      value.components.some((n) => typeof n !== 'number')
    )
      throw new SyncError(
        'COLOR_SPACE',
        'Structured DTCG colors currently require three numeric sRGB components.',
      );
    components = value.components as number[];
    alpha = value.alpha === undefined ? 1 : opacity(value.alpha);
  } else {
    if (typeof value !== 'string')
      throw new SyncError('COLOR', 'Expected a CSS color or structured sRGB color.');
    try {
      const parsed = new Color(value).to('srgb');
      components = parsed.coords.map(Number);
      alpha = Number(parsed.alpha);
    } catch {
      throw new SyncError(
        'COLOR',
        'Unsupported color syntax. Gradients are exported as paint styles.',
      );
    }
  }
  if (components.some((n) => !Number.isFinite(n) || n < -0.000001 || n > 1.000001))
    throw new SyncError(
      'COLOR_GAMUT',
      'Color is outside the supported sRGB gamut; convert it explicitly before export.',
    );
  const [r, g, b] = components.map((n) => Math.max(0, Math.min(1, n)));
  return { r, g, b, a: opacity(alpha) };
}
export const isGradient = (v: unknown) => typeof v === 'string' && /gradient\s*\(/i.test(v);
export function primitive(
  token: Token,
  value: unknown,
  root: number,
): { type: VariableType; literal: Literal } | undefined {
  const type = token.type.toLowerCase();
  if (type === 'color')
    return isGradient(value) ? undefined : { type: 'COLOR', literal: color(value) };
  if (['string', 'text', 'fontfamily', 'fontweight', 'textcase', 'textdecoration'].includes(type)) {
    if (
      type === 'fontweight' &&
      (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)))
    )
      return { type: 'FLOAT', literal: numeric(value, root, true) };
    if (typeof value !== 'string')
      throw new SyncError(
        'STRING',
        'Expected one string. Font fallback arrays cannot be represented by a Figma string variable.',
      );
    return { type: 'STRING', literal: value };
  }
  if (type === 'boolean') {
    if (typeof value !== 'boolean')
      throw new SyncError('BOOLEAN', 'Boolean token values must be true or false.');
    return { type: 'BOOLEAN', literal: value };
  }
  if (type === 'opacity') return { type: 'FLOAT', literal: opacity(value) };
  if (
    [
      'number',
      'dimension',
      'spacing',
      'sizing',
      'borderradius',
      'borderwidth',
      'fontsize',
      'lineheight',
      'letterspacing',
      'paragraphspacing',
      'paragraphindent',
    ].includes(type)
  )
    return { type: 'FLOAT', literal: numeric(value, root, type === 'number') };
  return undefined;
}
export function metric(
  value: unknown,
  root: number,
  automatic = false,
  multiplier = false,
): { unit: 'AUTO' } | { unit: 'PIXELS' | 'PERCENT'; value: number } {
  if (automatic && (value === 'auto' || value === 'normal' || value === undefined))
    return { unit: 'AUTO' };
  if (typeof value === 'string' && value.trim().endsWith('%'))
    return { unit: 'PERCENT', value: numeric(value.trim().slice(0, -1), root, true) };
  if (multiplier && typeof value === 'number') return { unit: 'PERCENT', value: value * 100 };
  return { unit: 'PIXELS', value: numeric(value ?? 0, root) };
}
