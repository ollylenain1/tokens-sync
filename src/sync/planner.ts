import {
  Action,
  CollectionState,
  DesiredCollection,
  DesiredModel,
  DesiredStyle,
  DesiredVariable,
  DocumentState,
  Mapping,
  Operation,
  Registry,
  StyleState,
  SyncPlan,
  VariableState,
  equal,
  keyOf,
  record,
  registryKey,
  stable,
  variableKey,
} from '../core/model';
import { getAt, setAt } from '../core/desired';
import { describeChanges } from './changes';
export type Choices = Record<string, string>;
const blankCounts = (): Record<Action, number> => ({
  new: 0,
  updated: 0,
  unchanged: 0,
  conflicting: 0,
  skipped: 0,
});
export const documentStamp = (state: DocumentState) => stable(state);
export const emptyRegistry = (identity: string): Registry => ({
  version: 1,
  fileIdentity: identity,
  entries: {},
  modes: {},
});
export function mappingFor(
  registry: Registry,
  model: DesiredModel,
  key: string,
): Mapping | undefined {
  const mapping = registry.entries[registryKey(model.identity, key)];
  return mapping?.fileIdentity === registry.fileIdentity ? mapping : undefined;
}
function target<T extends { id: string; key?: string; name: string }>(
  desired: { key: string; name: string; sourceIds: string[] },
  pool: T[],
  mapping: Mapping | undefined,
  choice: string | undefined,
  localTargets: T[] = pool,
): { target?: T; action?: Action; reason?: string; candidates?: { id: string; name: string }[] } {
  // Explicit value replacement retains the normal identity resolution rules.
  if (choice === 'repository') choice = undefined;
  const candidates = () => pool.map((v) => ({ id: v.id, name: v.name }));
  if (choice === 'skip') return { action: 'skipped', reason: 'Excluded by the designer.' };
  if (choice === 'create') {
    if (mapping && pool.some((p) => p.id === mapping.targetId))
      return {
        action: 'conflicting',
        reason: 'A live registry mapping exists. Select its target to preserve identity.',
        candidates: candidates(),
      };
    if (pool.some((p) => p.name === desired.name))
      return {
        action: 'conflicting',
        reason:
          'A target with this name already exists. Select the intended target instead of creating a duplicate.',
        candidates: candidates(),
      };
    return {};
  }
  if (choice) {
    const selected = pool.find((p) => p.id === choice);
    return selected
      ? { target: selected }
      : {
          action: 'conflicting',
          reason: 'The selected target is no longer available or compatible.',
          candidates: candidates(),
        };
  }
  if (mapping) {
    const existing = pool.find((p) => p.id === mapping.targetId);
    return existing
      ? { target: existing }
      : {
          action: 'conflicting',
          reason:
            'The registry target is missing or incompatible. Select a replacement, create a new target, or skip.',
          candidates: candidates(),
        };
  }
  // Tokens Studio IDs and keys can refer to objects in a different Figma file.
  const localHints = desired.sourceIds.length
    ? localTargets.filter((p) => desired.sourceIds.some((id) => p.id === id || p.key === id))
    : [];
  if (localHints.length) {
    const found = localHints.filter((p) => pool.includes(p));
    if (
      localHints.length === 1 &&
      found.length === 1 &&
      desired.sourceIds.every((id) => found[0].id === id || found[0].key === id)
    ) {
      if (found[0].name !== desired.name && !desired.sourceIds.includes(found[0].key ?? ''))
        return {
          action: 'conflicting',
          reason:
            'An ID hint resolves to a differently named object. Confirm the target before treating this as a rename.',
          candidates: candidates(),
        };
      return { target: found[0] };
    }
    return {
      action: 'conflicting',
      reason:
        found.length === 0
          ? 'A Tokens Studio mapping points to an incompatible local target. Select a compatible target, create a new one, or skip.'
          : 'Source themes disagree about the mapped target. Select one target explicitly.',
      candidates: candidates(),
    };
  }
  const named = pool.filter((v) => v.name === desired.name);
  if (named.length > 1)
    return {
      action: 'conflicting',
      reason: 'More than one local target matches this name. Select the intended target.',
      candidates: named.map((v) => ({ id: v.id, name: v.name })),
    };
  return { target: named[0] };
}
export function materializedStyle(
  style: DesiredStyle,
  ids: Map<string, string>,
  current?: StyleState,
  preserve = true,
  replacedBindings?: Record<string, string>,
): { data: Record<string, unknown>; bindings: Record<string, string>; conflict?: string } {
  const data = JSON.parse(JSON.stringify(style.data));
  const bindings: Record<string, string> = {};
  for (const binding of style.bindings)
    bindings[binding.field] = ids.get(binding.variable) ?? `pending:${binding.variable}`;
  if (preserve && current)
    for (const [field, id] of Object.entries(current.bindings)) {
      if (/^(effects|paints)\./.test(field) && getAt(data, field) === undefined)
        return {
          data,
          bindings,
          conflict: `A local binding on ${field} would lose its target property. Review the effect/paint structure or explicitly disable binding preservation.`,
        };
      if (bindings[field] && replacedBindings?.[field] === id) continue;
      if (bindings[field] && bindings[field] !== id)
        return {
          data,
          bindings,
          conflict: `A local binding on ${field} points to another variable. Disable “Preserve local bindings” to replace it, or skip this style.`,
        };
      bindings[field] = id;
    }
  return { data, bindings };
}
export function styleMatches(
  style: DesiredStyle,
  current: StyleState,
  ids: Map<string, string>,
  preserve: boolean,
): boolean {
  const desired = materializedStyle(style, ids, current, preserve);
  if (desired.conflict || !equal(desired.bindings, current.bindings)) return false;
  const actual: Record<string, unknown> = {};
  for (const key of Object.keys(style.data))
    actual[key] = JSON.parse(JSON.stringify(current.data[key] ?? null));
  // Figma may enrich FontName with native variable-font axis defaults.
  // Compare only font metadata explicitly supplied by this export.
  if (style.kind === 'TEXT' && record(style.data.fontName) && record(actual.fontName)) {
    const actualFont = actual.fontName;
    actual.fontName = Object.fromEntries(
      Object.keys(style.data.fontName).map((key) => [key, actualFont[key]]),
    );
  }
  for (const field of Object.keys(desired.bindings)) {
    setAt(actual, field, '__bound__');
    setAt(desired.data, field, '__bound__');
  }
  return equal(actual, desired.data);
}
export function planSync(
  model: DesiredModel,
  state: DocumentState,
  registry: Registry,
  choices: Choices = {},
): SyncPlan {
  const diagnostics = [...model.diagnostics];
  const byGroup = new Map<string, Operation<DesiredCollection>>();
  const sourceGroups = new Map(model.collections.map((c) => [c.name, c]));
  const visiting = new Set<string>();
  const cyclic = new Set<string>();
  const ordered: DesiredCollection[] = [];
  function visit(collection: DesiredCollection) {
    if (visiting.has(collection.name)) {
      for (const name of visiting) cyclic.add(name);
      return;
    }
    if (sourceGroups.get(collection.name) !== collection) return;
    visiting.add(collection.name);
    const parent = collection.parentGroup && sourceGroups.get(collection.parentGroup);
    if (parent) visit(parent);
    visiting.delete(collection.name);
    sourceGroups.delete(collection.name);
    ordered.push(collection);
  }
  for (const collection of model.collections) visit(collection);
  const collectionModes = new Map<string, CollectionState['modes'][number]>();
  const collections: Operation<DesiredCollection>[] = ordered.map((source) => {
    const parentOp = source.parentGroup ? byGroup.get(source.parentGroup) : undefined;
    const mappedParent = source.parentGroup
      ? mappingFor(registry, model, keyOf('collection', source.parentGroup))?.targetId
      : undefined;
    const parent = state.collections.find(
      (c) =>
        c.id === (parentOp?.targetId ?? mappedParent ?? source.parentId) ||
        (!parentOp && !mappedParent && c.key === source.parentId),
    );
    const desired = { ...source, parentId: parent?.id ?? source.parentId };
    const mapping = mappingFor(registry, model, desired.key);
    const name = desired.figmaName ?? desired.name;
    const pool = parent
      ? state.collections.filter((c) => !c.isExtension || c.parentId === parent.id)
      : state.collections;
    const match = target(
      { ...desired, name },
      pool,
      mapping,
      choices[desired.key],
      state.collections,
    );
    const op: Operation<DesiredCollection> = {
      key: desired.key,
      desired,
      action: match.action ?? (match.target ? 'unchanged' : 'new'),
      targetId: match.target?.id,
      reason: match.reason,
      missingTarget:
        !!mapping &&
        !choices[desired.key] &&
        !state.collections.some((item) => item.id === mapping.targetId) &&
        !pool.some((item) => item.name === name),
      candidates: match.candidates,
    };
    byGroup.set(desired.name, op);
    if (op.action === 'skipped') return op;
    const current = match.target;
    const extending = !!desired.parentId || !!desired.parentGroup || current?.isExtension;
    if (
      cyclic.has(desired.name) ||
      desired.extensionError ||
      (parentOp && ['conflicting', 'skipped'].includes(parentOp.action))
    ) {
      op.action = 'conflicting';
      op.reason =
        desired.extensionError ??
        (cyclic.has(desired.name)
          ? 'Extended collections cannot form a parent cycle.'
          : 'Resolve the parent collection before syncing this extension.');
    } else if (
      extending &&
      (desired.parentId || desired.parentGroup) &&
      !parentOp &&
      (!parent || (!current && !parent.canExtend))
    ) {
      op.action = 'conflicting';
      op.reason =
        'The parent collection is unavailable. Include its theme group or open the Figma file that contains the parent.';
    } else if (
      current &&
      (desired.parentId || desired.parentGroup) &&
      (!parent || current.parentId !== parent.id)
    ) {
      op.action = 'conflicting';
      op.reason =
        'An existing collection cannot be reparented. Select an extension of the intended parent.';
    }
    if (new Set(desired.modes.map((m) => m.name)).size !== desired.modes.length) {
      op.action = 'conflicting';
      op.reason = 'Two themes in this group have the same mode name.';
    }
    if (
      desired.sourceIds.length > 1 &&
      !choices[desired.key] &&
      !mapping &&
      state.collections.some((item) =>
        desired.sourceIds.some((id) => item.id === id || item.key === id),
      )
    ) {
      op.action = 'conflicting';
      op.reason =
        'Themes in this group reference different collections. Choose the correct collection explicitly.';
      op.candidates = state.collections.map((c) => ({ id: c.id, name: c.name }));
    }
    const inheritedModes = new Set<string>();
    for (const mode of desired.modes) {
      const mapped =
        registry.modes[registryKey(model.identity, keyOf('mode', desired.name, mode.key))];
      const parentMode = mode.parentMode ?? mode;
      const parentModeMapping = desired.parentGroup
        ? registry.modes[
            registryKey(model.identity, keyOf('mode', desired.parentGroup, parentMode.key))
          ]
        : undefined;
      const parentModes =
        parent?.modes.filter(
          (m) =>
            m.modeId === parentModeMapping ||
            m.modeId === mode.parentMode?.sourceId ||
            m.name === parentMode.name,
        ) ?? [];
      const plannedMode = parentOp?.desired.modes.some((m) =>
        mode.parentMode ? m.key === parentMode.key : m.name === mode.name,
      );
      const parentModeId = parentModes.length === 1 ? parentModes[0].modeId : undefined;
      const matches =
        current?.modes.filter((m) =>
          parentModeId && mode.parentMode
            ? m.parentModeId === parentModeId
            : m.modeId === mapped || m.modeId === mode.sourceId || m.name === mode.name,
        ) ?? [];
      const inheritedMode =
        parentModeId ?? (mode.parentMode && plannedMode ? parentMode.key : undefined);
      if (inheritedMode && inheritedModes.has(inheritedMode)) {
        op.action = 'conflicting';
        op.reason = 'Two extended themes reference the same parent mode.';
      }
      if (inheritedMode) inheritedModes.add(inheritedMode);
      if (matches.length > 1 || parentModes.length > 1) {
        op.action = 'conflicting';
        op.reason = `Ambiguous mode mapping for ${mode.name}. Resolve duplicate or conflicting mode names in Figma.`;
      } else if (
        extending &&
        !(current
          ? matches.length || (plannedMode && !parentModeId)
          : plannedMode || parentModeId) &&
        op.action !== 'conflicting'
      ) {
        op.action = 'conflicting';
        op.reason = `No inherited parent mode found for ${mode.name}. Include its parent theme or check the mode mapping.`;
      }
      if (matches.length === 1) collectionModes.set(keyOf(desired.name, mode.key), matches[0]);
      if (
        current &&
        op.action === 'unchanged' &&
        (!matches.length || (matches[0].name !== mode.name && (!extending || !!mode.parentMode)))
      )
        op.action = 'updated';
    }
    if (current && current.name !== name && op.action === 'unchanged') op.action = 'updated';
    if (
      diagnostics.some(
        (d) => d.code === 'MISSING_SET' && desired.modes.some((m) => m.key === d.theme),
      )
    ) {
      op.action = 'conflicting';
      op.reason =
        'A theme references a missing token set. Repair the repository before syncing this collection.';
    }
    return op;
  });
  const collectionTargets = new Map<string, Operation<DesiredCollection>[]>();
  for (const op of collections)
    if (op.targetId && op.action !== 'skipped')
      collectionTargets.set(op.targetId, [...(collectionTargets.get(op.targetId) ?? []), op]);
  for (const matches of collectionTargets.values())
    if (matches.length > 1)
      for (const op of matches) {
        op.action = 'conflicting';
        op.reason =
          'Two theme groups would modify the same collection. Choose separate collections or exclude one group.';
      }
  for (const op of collections) {
    const parent = op.desired.parentGroup && byGroup.get(op.desired.parentGroup);
    if (
      parent &&
      ['conflicting', 'skipped'].includes(parent.action) &&
      !['conflicting', 'skipped'].includes(op.action)
    ) {
      op.action = 'conflicting';
      op.reason = 'Resolve the parent collection before syncing this extension.';
    }
  }
  const sourceVariables = new Map<string, DesiredVariable[]>();
  for (const desired of model.variables) {
    const group = sourceVariables.get(desired.group) ?? [];
    group.push(desired);
    sourceVariables.set(desired.group, group);
  }
  const varByKey = new Map<string, Operation<DesiredVariable>>();
  const variables: Operation<DesiredVariable>[] = collections
    .flatMap((c) => sourceVariables.get(c.desired.name) ?? [])
    .map((desired) => {
      const collection = byGroup.get(desired.group)!;
      const currentCollection = state.collections.find((c) => c.id === collection.targetId);
      const parent = state.collections.find((c) => c.id === collection.desired.parentId);
      const inherited = currentCollection?.isExtension ? currentCollection : parent;
      const parentGroup = collection.desired.parentGroup;
      const parentVariable = parentGroup
        ? varByKey.get(variableKey(parentGroup, desired.path))
        : undefined;
      const pool = state.variables.filter(
        (v) =>
          v.type === desired.type &&
          (inherited
            ? inherited.variableIds.includes(v.id)
            : v.collectionId === collection.targetId),
      );
      const mapping = mappingFor(registry, model, desired.key);
      const match = target(desired, pool, mapping, choices[desired.key], state.variables);
      const op: Operation<DesiredVariable> = {
        key: desired.key,
        desired,
        targetId: match.target?.id,
        action: match.action ?? (match.target ? 'updated' : 'new'),
        reason: match.reason,
        missingTarget:
          !!mapping &&
          !choices[desired.key] &&
          !state.variables.some((item) => item.id === mapping.targetId) &&
          !pool.some((item) => item.name === desired.name) &&
          !inherited,
        candidates: match.candidates,
      };
      varByKey.set(op.key, op);
      if (op.action === 'skipped') return op;
      if (
        collection.action === 'conflicting' ||
        collection.action === 'skipped' ||
        (parentGroup &&
          ['conflicting', 'skipped'].includes(byGroup.get(parentGroup)?.action ?? 'unchanged'))
      ) {
        op.action = 'conflicting';
        op.reason = 'Resolve or exclude the collection before syncing this variable.';
      }
      const extending = inherited || collection.desired.parentGroup || collection.desired.parentId;
      if (extending && !match.target) {
        if (
          !match.action &&
          parentVariable?.desired.type === desired.type &&
          model.settings.variables
        ) {
          op.inheritedFrom = parentVariable.key;
          op.targetId = parentVariable.targetId;
        } else if (op.action !== 'conflicting') {
          op.action = 'conflicting';
          op.reason =
            'No compatible inherited variable exists. Include the variable in the parent collection first.';
        }
      }
      if (
        !match.target &&
        state.variables.some(
          (v) =>
            v.collectionId === collection.targetId &&
            v.name === desired.name &&
            v.type !== desired.type,
        )
      ) {
        op.action = 'conflicting';
        op.reason =
          'A variable with this name has another type. Existing variables cannot be converted in place.';
      }
      if (
        !extending &&
        !match.target &&
        collection.desired.modes.some((m) => !desired.values[m.key])
      ) {
        op.action = 'conflicting';
        op.reason =
          'A new variable has no source value in every selected mode. Add the missing token to those themes first.';
      }
      if (
        diagnostics.some(
          (d) =>
            d.level === 'error' &&
            d.token === desired.path &&
            collection.desired.modes.some((m) => m.key === d.theme),
        )
      ) {
        op.action = 'conflicting';
        op.reason = 'This token has a resolution or conversion error in at least one theme.';
      }
      if (!model.settings.variables) {
        op.action = match.target ? 'unchanged' : 'skipped';
        if (!match.target)
          op.reason = 'Variable sync is disabled and no existing compatible variable was found.';
        if (match.action === 'conflicting') {
          op.action = 'conflicting';
          op.reason = match.reason;
        }
      }
      return op;
    });
  const ids = new Map(
    variables
      .filter((v) => v.targetId && !['conflicting', 'skipped'].includes(v.action))
      .map((v) => [v.key, v.targetId!]),
  );
  for (const op of variables) {
    if (['conflicting', 'skipped'].includes(op.action)) continue;
    const collection = byGroup.get(op.desired.group)!;
    const current = state.variables.find((v) => v.id === op.targetId);
    const currentCollection = state.collections.find((c) => c.id === collection.targetId);
    const extending =
      !!collection.desired.parentId ||
      !!collection.desired.parentGroup ||
      currentCollection?.isExtension;
    let changed =
      !current ||
      (!extending &&
        (current.name !== op.desired.name ||
          (!model.settings.preserveMetadata &&
            current.description !== (op.desired.description ?? ''))));
    const baseline = mappingFor(registry, model, op.key);
    let localDrift = false;
    for (const [themeId, spec] of Object.entries(op.desired.values)) {
      if (spec.alias) {
        const dependency = varByKey.get(spec.alias);
        if (!dependency || ['conflicting', 'skipped'].includes(dependency.action)) {
          op.action = 'conflicting';
          op.reason =
            'An alias target is unresolved or excluded. Resolve that mapping before syncing.';
        }
      }
      const mode = collectionModes.get(keyOf(op.desired.group, themeId));
      const desiredValue = spec.alias
        ? { type: 'VARIABLE_ALIAS', id: ids.get(spec.alias) ?? `pending:${spec.alias}` }
        : spec.literal;
      if (!mode || !equal(current?.values[mode.modeId], desiredValue)) changed = true;
      if (
        mode &&
        current &&
        (!currentCollection?.overrideModes ||
          currentCollection.overrideModes[current.id]?.includes(mode.modeId)) &&
        baseline?.status === 'synced' &&
        record(baseline.lastValue) &&
        Object.prototype.hasOwnProperty.call(baseline.lastValue, mode.modeId) &&
        !equal(current.values[mode.modeId], baseline.lastValue[mode.modeId]) &&
        !equal(current.values[mode.modeId], desiredValue)
      )
        localDrift = true;
    }
    if (op.action !== 'conflicting') {
      if (!model.settings.variables && changed) {
        op.action = 'conflicting';
        op.reason =
          'This existing variable differs from the source. Enable variable sync or choose separate theme-specific styles to export resolved values.';
      } else op.action = current ? (changed ? 'updated' : 'unchanged') : 'new';
      if (op.action === 'updated' && localDrift && choices[op.key] !== 'repository') {
        op.action = 'conflicting';
        op.localDrift = true;
        op.reason =
          'This value was edited in Figma since the last sync. Keep it locally by skipping this item, or explicitly use the repository value. Dependent outputs may also need review.';
      }
    }
  }
  // Detect collisions after name normalization and explicit mapping selection.
  const collide = <T extends { name: string }>(
    ops: Operation<T>[],
    identity: (op: Operation<T>) => string,
  ) => {
    const buckets = new Map<string, Operation<T>[]>();
    for (const op of ops) {
      if (op.action === 'skipped') continue;
      const key = identity(op);
      buckets.set(key, [...(buckets.get(key) ?? []), op]);
    }
    for (const bucket of buckets.values())
      if (bucket.length > 1)
        for (const op of bucket) {
          op.action = 'conflicting';
          op.reason =
            'Multiple source items would write the same target or normalized name. Rename the source items or skip one.';
        }
  };
  collide(variables, (op) => keyOf(op.desired.group, op.desired.name));
  collide(
    variables.filter((v) => !!v.targetId),
    (op) => keyOf(op.desired.group, op.targetId!),
  );
  // Propagate blocked aliases to all dependants, including chains.
  let changed = true;
  while (changed) {
    changed = false;
    for (const op of variables)
      if (
        !['conflicting', 'skipped'].includes(op.action) &&
        Object.values(op.desired.values).some(
          (v) =>
            v.alias &&
            ['conflicting', 'skipped'].includes(varByKey.get(v.alias)?.action ?? 'skipped'),
        )
      ) {
        op.action = 'conflicting';
        op.reason = 'A transitive alias dependency is unresolved.';
        changed = true;
      }
  }
  const styles: Operation<DesiredStyle>[] = model.styles.map((desired) => {
    const match = target(
      desired,
      state.styles.filter((s) => s.kind === desired.kind),
      mappingFor(registry, model, desired.key),
      choices[desired.key],
      state.styles,
    );
    const op: Operation<DesiredStyle> = {
      key: desired.key,
      desired,
      action: match.action ?? (match.target ? 'updated' : 'new'),
      targetId: match.target?.id,
      reason: match.reason,
      candidates: match.candidates,
    };
    if (op.action === 'skipped') return op;
    if (
      desired.bindings.some(
        (b) =>
          !varByKey.get(b.variable) ||
          ['conflicting', 'skipped'].includes(varByKey.get(b.variable)!.action),
      )
    ) {
      op.action = 'conflicting';
      op.reason =
        'A style binding requires a variable that is unavailable or conflicting. Sync that variable or choose theme-specific styles.';
    }
    if (match.target && !['conflicting', 'skipped'].includes(op.action)) {
      for (const binding of desired.bindings) {
        if (
          choices[binding.variable] !== 'create' ||
          varByKey.get(binding.variable)?.action !== 'new'
        )
          continue;
        const oldId = mappingFor(registry, model, binding.variable)?.targetId;
        if (
          oldId &&
          match.target.bindings[binding.field] === oldId &&
          !state.variables.some((v) => v.id === oldId)
        )
          (op.replacedBindings ??= {})[binding.field] = oldId;
      }
      const material = materializedStyle(
        desired,
        ids,
        match.target,
        model.settings.preserveBindings,
        op.replacedBindings,
      );
      if (material.conflict) {
        op.action = 'conflicting';
        op.reason = material.conflict;
      } else if (
        match.target.name === desired.name &&
        styleMatches(desired, match.target, ids, model.settings.preserveBindings) &&
        (model.settings.preserveMetadata ||
          match.target.description === (desired.description ?? ''))
      )
        op.action = 'unchanged';
      if (
        model.settings.preserveBindings &&
        Object.keys(match.target.bindings).some(
          (field) => !desired.bindings.some((b) => b.field === field),
        )
      )
        diagnostics.push({
          level: 'warning',
          code: 'LOCAL_BINDING',
          token: desired.path,
          message:
            'A locally maintained style binding is preserved. Its variable controls that property instead of the repository literal.',
        });
      const baseline = mappingFor(registry, model, op.key);
      if (
        op.action === 'updated' &&
        choices[op.key] !== 'repository' &&
        baseline?.status === 'synced' &&
        record(baseline.lastValue) &&
        record(baseline.lastValue.data) &&
        record(baseline.lastValue.bindings)
      ) {
        const before = JSON.parse(JSON.stringify(baseline.lastValue.data));
        const now = JSON.parse(
          JSON.stringify(
            Object.fromEntries(Object.keys(before).map((key) => [key, match.target!.data[key]])),
          ),
        );
        // Resolved values of bound properties naturally change with their variables.
        // Locally preserved bindings are not overwritten by this sync either.
        const ignored = new Set([
          ...Object.keys(baseline.lastValue.bindings),
          ...(model.settings.preserveBindings ? Object.keys(match.target.bindings) : []),
        ]);
        for (const field of ignored) {
          if (getAt(before, field) !== undefined) setAt(before, field, '__bound__');
          if (getAt(now, field) !== undefined) setAt(now, field, '__bound__');
        }
        const bindingsChanged =
          !model.settings.preserveBindings &&
          !equal(baseline.lastValue.bindings, match.target.bindings);
        if (!equal(before, now) || bindingsChanged) {
          op.action = 'conflicting';
          op.localDrift = true;
          op.reason =
            'This style was edited in Figma since the last sync. Keep it locally by skipping this item, or explicitly use the repository properties.';
        }
      }
    }
    if (
      diagnostics.some(
        (d) =>
          d.code === 'MISSING_FONT' &&
          d.token === desired.path &&
          (d.theme === desired.theme || desired.theme === 'linked'),
      )
    ) {
      op.action = 'conflicting';
      op.reason =
        'A required font is unavailable. Install the exact family/style and fetch a fresh preview.';
    }
    return op;
  });
  collide(styles, (op) => keyOf(op.desired.kind, op.desired.name));
  collide(
    styles.filter((s) => !!s.targetId),
    (op) => op.targetId!,
  );
  const allKeys = new Set(
    [...collections, ...variables, ...styles].map((o) => registryKey(model.identity, o.key)),
  );
  const claimedIds = new Set(
    [...collections, ...variables, ...styles]
      .filter((o) => o.targetId && !['conflicting', 'skipped'].includes(o.action))
      .map((o) => o.targetId),
  );
  const missing = Object.entries(registry.entries)
    .filter(
      ([key, entry]) =>
        entry.source === model.identity &&
        entry.fileIdentity === state.identity &&
        !byGroup.get(entry.group)?.desired.partialSelection &&
        !allKeys.has(key) &&
        !claimedIds.has(entry.targetId) &&
        (!model.settings.groups.length || model.settings.groups.includes(entry.group)),
    )
    .map(([, entry]) => entry);
  for (const op of variables)
    if (op.action === 'new' && !choices[op.key]) {
      const collection = state.collections.find(
        (c) => c.id === byGroup.get(op.desired.group)?.targetId,
      );
      const possible = missing
        .filter(
          (m) =>
            m.kind === 'variable' &&
            m.group === op.desired.group &&
            m.tokenType === op.desired.tokenType,
        )
        .map((m) => state.variables.find((v) => v.id === m.targetId))
        .filter(
          (v): v is VariableState =>
            !!v &&
            v.type === op.desired.type &&
            v.collectionId === collection?.id &&
            Object.entries(op.desired.values).every(([theme, spec]) => {
              const mode = byGroup
                .get(op.desired.group)
                ?.desired.modes.find((m) => m.key === theme);
              const mid = collection?.modes.find((m) => m.name === mode?.name)?.modeId;
              return (
                !!mid &&
                equal(
                  v.values[mid],
                  spec.alias ? { type: 'VARIABLE_ALIAS', id: ids.get(spec.alias) } : spec.literal,
                )
              );
            }),
        );
      if (possible.length) {
        op.action = 'conflicting';
        op.reason =
          'This may be a renamed source token. Select an existing target to retain its identity, or explicitly create a new item.';
        op.candidates = possible.map((v) => ({ id: v.id, name: v.name }));
      }
    }
  for (const op of styles)
    if (op.action === 'new' && !choices[op.key]) {
      const possible = missing
        .filter(
          (m) =>
            m.kind === 'style' &&
            m.group === op.desired.group &&
            m.theme === op.desired.theme &&
            m.tokenType === op.desired.tokenType,
        )
        .map((m) => state.styles.find((s) => s.id === m.targetId))
        .filter(
          (s): s is StyleState =>
            !!s &&
            s.kind === op.desired.kind &&
            styleMatches(op.desired, s, ids, model.settings.preserveBindings),
        );
      if (possible.length) {
        op.action = 'conflicting';
        op.reason =
          'This may be a renamed style token. Confirm the existing target to retain its identity, or explicitly create a new style.';
        op.candidates = possible.map((s) => ({ id: s.id, name: s.name }));
      }
    }
  // Rename review can block references discovered earlier in planning.
  let renamedDependency = true;
  while (renamedDependency) {
    renamedDependency = false;
    for (const op of variables)
      if (
        !['conflicting', 'skipped'].includes(op.action) &&
        ((op.inheritedFrom &&
          ['conflicting', 'skipped'].includes(varByKey.get(op.inheritedFrom)!.action)) ||
          Object.values(op.desired.values).some(
            (v) => v.alias && varByKey.get(v.alias)?.action === 'conflicting',
          ))
      ) {
        op.action = 'conflicting';
        op.reason = 'An alias target requires rename or mapping review.';
        renamedDependency = true;
      }
  }
  for (const op of styles)
    if (
      !['conflicting', 'skipped'].includes(op.action) &&
      op.desired.bindings.some((b) => varByKey.get(b.variable)?.action === 'conflicting')
    ) {
      op.action = 'conflicting';
      op.reason = 'A bound variable requires rename or mapping review.';
    }
  const counts = { variables: blankCounts(), styles: blankCounts() };
  describeChanges(model, state, registry, collections, variables, styles);
  for (const op of variables) counts.variables[op.action]++;
  for (const op of styles) counts.styles[op.action]++;
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    model,
    documentStamp: documentStamp(state),
    collections,
    variables,
    styles,
    diagnostics,
    missing,
    counts,
  };
}
