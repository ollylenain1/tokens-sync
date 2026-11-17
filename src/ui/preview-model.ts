import {
  Action,
  Diagnostic,
  Literal,
  Operation,
  SyncPlan,
  ValueSpec,
  PropertyChange,
  record,
} from '../core/model';

export interface PreviewRow {
  key: string;
  name: string;
  group: string;
  type: string;
  action: Action;
  reason?: string;
  missingTarget?: boolean;
  candidates?: { id: string; name: string }[];
  targetId?: string;
  localDrift?: boolean;
  changes?: PropertyChange[];
}
export interface CollectionRow extends PreviewRow {
  modes: { key: string; name: string }[];
  parentId?: string;
}
export interface VariableRow extends PreviewRow {
  path: string;
  description?: string;
  values: Record<string, ValueSpec>;
}
export interface StyleRow extends PreviewRow {
  path: string;
  description?: string;
  theme: string;
  summary: string;
  data?: Record<string, unknown>;
  swatch?: Literal;
  bindings: { field: string; variable: string }[];
}
export interface Preview {
  id: string;
  counts: SyncPlan['counts'];
  diagnostics: Diagnostic[];
  missing: { path: string; kind: string; group: string }[];
  collections: CollectionRow[];
  variables: VariableRow[];
  styles: StyleRow[];
  canSync: boolean;
}

function operation<T extends { name: string }>(op: Operation<T>) {
  return {
    key: op.key,
    name: op.desired.name,
    action: op.action,
    reason: op.reason,
    missingTarget: op.missingTarget,
    candidates: op.candidates?.map((candidate) => ({ ...candidate })),
    targetId: op.targetId,
    localDrift: op.localDrift,
    changes: op.changes ? (JSON.parse(JSON.stringify(op.changes)) as PropertyChange[]) : [],
  };
}

function stylePresentation(style: SyncPlan['styles'][number]['desired']) {
  const data = style.data;
  if (style.kind === 'TEXT') {
    const font = record(data.fontName) ? data.fontName : {};
    return { summary: `${font.family ?? 'Text'} ${font.style ?? ''} · ${data.fontSize ?? '—'} px` };
  }
  if (style.kind === 'EFFECT') {
    const effects = Array.isArray(data.effects) ? data.effects.filter(record) : [];
    return {
      summary: effects
        .map(
          (effect) =>
            `${String(effect.type).toLowerCase().replace(/_/g, ' ')} · ${effect.radius ?? 0} px`,
        )
        .join(' / '),
    };
  }
  const paints = Array.isArray(data.paints) ? data.paints.filter(record) : [];
  const paint = paints[0];
  if (paint?.type === 'SOLID' && record(paint.color)) {
    const { r, g, b } = paint.color;
    if ([r, g, b].every((channel) => typeof channel === 'number')) {
      const swatch = {
        r: r as number,
        g: g as number,
        b: b as number,
        a: typeof paint.opacity === 'number' ? paint.opacity : 1,
      };
      return { summary: formatLiteral(swatch), swatch };
    }
  }
  return {
    summary:
      paints
        .map(
          (paint) =>
            `${String(paint.type).toLowerCase().replace(/_/g, ' ')}${Array.isArray(paint.gradientStops) ? ` · ${paint.gradientStops.length} stops` : ''}`,
        )
        .join(' / ') || 'Paint',
  };
}

/** One presentation boundary for the live bridge and the standalone preview. */
export function previewPayload(plan: SyncPlan): Preview {
  return {
    id: plan.id,
    counts: { variables: { ...plan.counts.variables }, styles: { ...plan.counts.styles } },
    diagnostics: plan.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    missing: plan.missing.map(({ path, kind, group }) => ({ path, kind, group })),
    collections: plan.collections.map((op) => ({
      ...operation(op),
      group: op.desired.name,
      type: 'COLLECTION',
      modes: op.desired.modes.map(({ key, name }) => ({ key, name })),
      parentId: op.desired.parentId,
    })),
    variables: plan.variables.map((op) => ({
      ...operation(op),
      group: op.desired.group,
      type: op.desired.type,
      path: op.desired.path,
      description: op.desired.description,
      values: Object.fromEntries(
        Object.entries(op.desired.values).map(([mode, value]) => [
          mode,
          {
            literal: typeof value.literal === 'object' ? { ...value.literal } : value.literal,
            ...(value.alias ? { alias: value.alias } : {}),
          },
        ]),
      ),
    })),
    styles: plan.styles.map((op) => ({
      ...operation(op),
      group: op.desired.group,
      type: op.desired.kind,
      path: op.desired.path,
      description: op.desired.description,
      theme:
        op.desired.theme === 'linked'
          ? 'Linked'
          : (plan.model.collections
              .find((collection) => collection.name === op.desired.group)
              ?.modes.find((mode) => mode.key === op.desired.theme)?.name ?? op.desired.theme),
      ...stylePresentation(op.desired),
      data: JSON.parse(JSON.stringify(op.desired.data)) as Record<string, unknown>,
      bindings: op.desired.bindings.map((binding) => ({ ...binding })),
    })),
    canSync:
      plan.variables.some(
        (op) => ['new', 'updated'].includes(op.action) && plan.model.settings.variables,
      ) ||
      plan.styles.some((op) => ['new', 'updated'].includes(op.action)) ||
      plan.collections.some(
        (op) => ['new', 'updated'].includes(op.action) && plan.model.settings.variables,
      ),
  };
}

export function formatLiteral(value: Literal): string {
  if (typeof value === 'object') {
    const hex = (channel: number) =>
      Math.round(Math.min(1, Math.max(0, channel)) * 255)
        .toString(16)
        .padStart(2, '0');
    return `#${hex(value.r)}${hex(value.g)}${hex(value.b)}${value.a < 1 ? hex(value.a) : ''}`;
  }
  return String(value);
}

export function isIncluded(groups: string[], group: string): boolean {
  return !groups.length || groups.includes(group);
}

export function visibleRows<T extends PreviewRow>(
  rows: T[],
  scope: string,
  search: string,
  action = 'all',
): T[] {
  const query = search.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (!scope || row.group === scope) &&
      (action === 'all' ||
        (action === 'changed'
          ? ['new', 'updated', 'conflicting'].includes(row.action)
          : row.action === action)) &&
      `${row.name} ${row.group} ${'path' in row ? row.path : ''}`.toLowerCase().includes(query),
  );
}

export function toggleList(
  current: string[],
  all: string[],
  item: string,
  active: boolean,
): string[] {
  const result = new Set(current.length ? current.filter((value) => value !== '__none__') : all);
  if (active) result.add(item);
  else result.delete(item);
  return result.size ? [...result] : ['__none__'];
}

export function conflictCount(preview?: Preview): number {
  return preview
    ? [...preview.collections, ...preview.variables, ...preview.styles].filter(
        (row) => row.action === 'conflicting',
      ).length
    : 0;
}

export function changeCount(preview?: Preview): number {
  return preview
    ? [...preview.collections, ...preview.variables, ...preview.styles].filter(
        (row) => row.action === 'new' || row.action === 'updated',
      ).length
    : 0;
}
