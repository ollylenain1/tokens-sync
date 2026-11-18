import {
  CollectionState,
  DesiredModel,
  DocumentState,
  Operation,
  DesiredCollection,
  DesiredVariable,
  DesiredStyle,
  PropertyChange,
  Registry,
  equal,
  keyOf,
  registryKey,
  record,
} from '../core/model';
import { getAt } from '../core/desired';

/** Capture review evidence while the planner still has the exact current snapshot. */
export function describeChanges(
  model: DesiredModel,
  state: DocumentState,
  registry: Registry,
  collections: Operation<DesiredCollection>[],
  variables: Operation<DesiredVariable>[],
  styles: Operation<DesiredStyle>[],
) {
  const currentVariables = new Map(state.variables.map((v) => [v.id, v]));
  const desiredVariables = new Map(variables.map((op) => [op.key, op]));
  const collectionOps = new Map(collections.map((op) => [op.desired.name, op]));
  const alias = (id: string) => ({
    type: 'VARIABLE_ALIAS',
    id,
    name:
      currentVariables.get(id)?.name ??
      variables.find((v) => v.targetId === id)?.desired.name ??
      id,
  });
  const present = (value: unknown): unknown =>
    record(value) && value.type === 'VARIABLE_ALIAS' && typeof value.id === 'string'
      ? { ...alias(value.id), ...(typeof value.name === 'string' ? { name: value.name } : {}) }
      : value;
  const desiredAlias = (key: string) => {
    const target = desiredVariables.get(key);
    return target?.targetId
      ? alias(target.targetId)
      : { type: 'VARIABLE_ALIAS', id: `pending:${key}`, name: target?.desired.name ?? key };
  };
  function change(
    field: string,
    kind: PropertyChange['kind'],
    before: unknown,
    after: unknown,
  ): PropertyChange {
    return {
      field,
      kind,
      before: present(before),
      after: present(after),
      changed: !equal(before, after),
    };
  }
  function metadata(
    op: Operation<{ name: string; description?: string }>,
    current?: { name: string; description?: string },
  ) {
    const changes = [change('Name', 'name', current?.name, op.desired.name)];
    if (!model.settings.preserveMetadata || !current)
      changes.push(
        change('Description', 'description', current?.description, op.desired.description ?? ''),
      );
    return changes;
  }
  function modeFor(
    group: string,
    mode: DesiredCollection['modes'][number],
    current?: CollectionState,
  ) {
    const id = registry.modes[registryKey(model.identity, keyOf('mode', group, mode.key))];
    return current?.modes.find(
      (m) => m.modeId === id || m.modeId === mode.sourceId || m.name === mode.name,
    );
  }
  for (const op of collections) {
    const current = state.collections.find((c) => c.id === op.targetId);
    op.changes = [change('Name', 'name', current?.name, op.desired.figmaName ?? op.desired.name)];
    for (const mode of op.desired.modes)
      op.changes.push(
        change(
          `Mode · ${mode.name}`,
          'mode',
          modeFor(op.desired.name, mode, current)?.name,
          mode.name,
        ),
      );
  }
  for (const op of variables) {
    const current = currentVariables.get(op.targetId ?? '');
    const collection = collectionOps.get(op.desired.group);
    const currentCollection = state.collections.find((c) => c.id === collection?.targetId);
    op.changes = metadata(op, current);
    for (const [key, spec] of Object.entries(op.desired.values)) {
      const mode = collection?.desired.modes.find((m) => m.key === key);
      const targetMode = mode && modeFor(op.desired.group, mode, currentCollection);
      const before = targetMode ? current?.values[targetMode.modeId] : undefined;
      const after = spec.alias ? desiredAlias(spec.alias) : spec.literal;
      // Present both aliases with names before comparing; identity remains part of the comparison.
      op.changes.push(
        change(
          mode?.name ?? key,
          spec.alias || (record(before) && before.type === 'VARIABLE_ALIAS') ? 'binding' : 'value',
          present(before),
          after,
        ),
      );
    }
  }
  function leaves(value: unknown, prefix = ''): string[] {
    if (
      record(value) &&
      typeof value.r === 'number' &&
      typeof value.g === 'number' &&
      typeof value.b === 'number'
    )
      return [prefix];
    if (record(value) || Array.isArray(value)) {
      const entries = Object.entries(value);
      return entries.length
        ? entries.flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key))
        : [prefix];
    }
    return [prefix];
  }
  for (const op of styles) {
    const current = state.styles.find((s) => s.id === op.targetId);
    op.changes = metadata(op, current);
    const bindings: Record<string, unknown> = Object.fromEntries(
      op.desired.bindings.map((b) => [b.field, desiredAlias(b.variable)]),
    );
    if (model.settings.preserveBindings && current)
      for (const [field, id] of Object.entries(current.bindings))
        if (!bindings[field]) bindings[field] = alias(id);
    const proposedData =
      op.desired.kind === 'TEXT' ? { ...current?.data, ...op.desired.data } : op.desired.data;
    const fields = new Set([
      ...leaves(current?.data ?? {}),
      ...leaves(proposedData),
      ...Object.keys(bindings),
      ...Object.keys(current?.bindings ?? {}),
    ]);
    for (const field of fields) {
      if (!field) continue;
      if (
        op.desired.kind === 'TEXT' &&
        field.startsWith('fontName.') &&
        record(op.desired.data.fontName) &&
        !(field.split('.')[1] in op.desired.data.fontName)
      )
        continue;
      const before = current?.bindings[field]
        ? alias(current.bindings[field])
        : getAt(current?.data, field);
      const after = bindings[field] ?? getAt(proposedData, field);
      op.changes.push(
        change(
          field,
          bindings[field] || current?.bindings[field] ? 'binding' : 'value',
          before,
          after,
        ),
      );
    }
  }
}
