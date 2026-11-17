import { record } from '../core/model';

const number = (value: unknown, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
function color(value: unknown, opacity = 1) {
  if (!record(value)) return undefined;
  if (![value.r, value.g, value.b].every((v) => typeof v === 'number' && Number.isFinite(v)))
    return undefined;
  const channel = (v: unknown) => Math.round(Math.max(0, Math.min(1, number(v))) * 255);
  const alpha = Math.max(0, Math.min(1, number(value.a, 1) * opacity));
  return `rgba(${channel(value.r)},${channel(value.g)},${channel(value.b)},${alpha})`;
}

/** CSS is assembled exclusively from validated numbers and fixed keywords. */
export function styleSpecimen(
  kind: string,
  data: Record<string, unknown>,
): { css: string; label: string } | undefined {
  if (kind === 'PAINT' && Array.isArray(data.paints)) {
    const layers = data.paints.filter(record).filter((paint) => paint.visible !== false);
    const gradients: string[] = [];
    for (const paint of layers) {
      const opacity = number(paint.opacity, 1);
      if (paint.type === 'SOLID') {
        const fill = color(paint.color, opacity);
        if (!fill) return undefined;
        gradients.push(`linear-gradient(${fill},${fill})`);
      } else if (
        ['GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR'].includes(String(paint.type)) &&
        Array.isArray(paint.gradientStops)
      ) {
        const stops = paint.gradientStops.filter(record).map((stop) => {
          const fill = color(stop.color, opacity);
          return fill ? `${fill} ${Math.max(0, Math.min(1, number(stop.position))) * 100}%` : '';
        });
        if (stops.length < 2 || stops.some((stop) => !stop)) return undefined;
        const gradient =
          paint.type === 'GRADIENT_LINEAR'
            ? 'linear-gradient(90deg,'
            : paint.type === 'GRADIENT_RADIAL'
              ? 'radial-gradient(ellipse at center,'
              : 'conic-gradient(from 0deg,';
        gradients.push(gradient + stops.join(',') + ')');
      } else return undefined;
    }
    if (gradients.length)
      return {
        css: 'background:' + gradients.reverse().join(','),
        label: 'Approximate paint preview · geometry and blending may differ from Figma',
      };
  }
  if (kind === 'EFFECT' && Array.isArray(data.effects)) {
    const shadows: string[] = [];
    const effects = data.effects.filter(record).filter((effect) => effect.visible !== false);
    for (const effect of effects) {
      if (!['DROP_SHADOW', 'INNER_SHADOW'].includes(String(effect.type))) return undefined;
      const fill = color(effect.color);
      if (!fill) return undefined;
      const offset = record(effect.offset) ? effect.offset : {};
      shadows.push(
        `${effect.type === 'INNER_SHADOW' ? 'inset ' : ''}${number(offset.x)}px ${number(offset.y)}px ${Math.max(0, number(effect.radius))}px ${number(effect.spread)}px ${fill}`,
      );
    }
    if (shadows.length)
      return {
        css: 'box-shadow:' + shadows.join(','),
        label: 'Approximate shadow preview · inspect all layers below',
      };
  }
  return undefined;
}
