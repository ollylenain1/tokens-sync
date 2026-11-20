import {
  DesiredCollection,
  DesiredStyle,
  DesiredVariable,
  Mapping,
  Operation,
  Registry,
  StyleState,
  SyncError,
  SyncPlan,
  SyncReport,
  equal,
  keyOf,
  registryKey,
  record,
  safeError,
  tick,
} from '../core/model';
import { FigmaAdapter, styleState } from '../figma/adapter';
import { RegistryStore } from '../figma/registry';
import { documentStamp, materializedStyle, styleMatches } from './planner';
export interface RunControl {
  cancelled: boolean;
  progress: (message: string, done: number, total: number) => void;
}
export async function applyPlan(
  plan: SyncPlan,
  adapter: FigmaAdapter,
  registry: Registry,
  store: RegistryStore,
  control: RunControl,
): Promise<SyncReport> {
  control.progress('Checking the Figma document…', 0, 0);
  const current = await adapter.snapshot();
  if (documentStamp(current) !== plan.documentStamp)
    throw new SyncError(
      'STALE_PREVIEW',
      'Figma changed since this preview. Refresh the preview before syncing.',
    );
  const plannedPaths = new Set([...plan.variables, ...plan.styles].map((op) => op.desired.path));
  const omitted = new Set(
    plan.diagnostics
      .filter(
        (d) =>
          d.token &&
          (d.level === 'error' || d.code === 'UNSUPPORTED') &&
          !plannedPaths.has(d.token),
      )
      .map((d) => `${d.theme}:${d.token}`),
  );
  const report: SyncReport = {
    revision: plan.model.revision,
    source: plan.model.identity,
    groups: [
      ...new Set([
        ...plan.collections.map((op) => op.desired.name),
        ...plan.styles.map((op) => op.desired.group),
      ]),
    ],
    preserveMetadata: plan.model.settings.preserveMetadata,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: omitted.size,
    failed: 0,
    cancelled: false,
    diagnostics: plan.diagnostics.filter(
      (d) => d.level === 'error' && d.token && !plannedPaths.has(d.token),
    ),
  };
  const blocked = (op: { action: string }) => ['conflicting', 'skipped'].includes(op.action);
  const selectedStyles = plan.styles.filter((s) => !blocked(s));
  control.progress('Loading fonts…', 0, 0);
  const failedFonts = await adapter.loadFonts(selectedStyles.map((s) => s.desired));
  if (documentStamp(await adapter.snapshot()) !== plan.documentStamp)
    throw new SyncError(
      'STALE_PREVIEW',
      'Figma changed while fonts were loading. Refresh the preview before syncing.',
    );
  const collectionIds = new Map<string, string>(),
    variableIds = new Map<string, string>();
  const modeIds = new Map<string, string>(),
    failures = new Set<string>();
  const total =
    (plan.model.settings.variables ? plan.collections.length + plan.variables.length * 2 : 0) +
    plan.styles.length +
    1;
  let done = 0,
    dirty = false;
  function save(
    op: Operation<DesiredCollection | DesiredVariable | DesiredStyle>,
    kind: Mapping['kind'],
    targetId: string,
    lastValue?: unknown,
    status: Mapping['status'] = 'synced',
  ) {
    const desired = op.desired;
    registry.entries[registryKey(plan.model.identity, op.key)] = {
      source: plan.model.identity,
      path: 'path' in desired ? desired.path : desired.name,
      tokenType: 'tokenType' in desired ? desired.tokenType : 'collection',
      group: 'group' in desired ? desired.group : desired.name,
      theme: 'theme' in desired ? desired.theme : undefined,
      kind,
      targetId,
      fileIdentity: registry.fileIdentity,
      lastValue,
      status,
    };
    dirty = true;
  }
  function checkpoint() {
    if (dirty) {
      store.write(registry);
      dirty = false;
    }
  }
  function error(op: { key: string; desired: { name: string } }, cause: unknown) {
    if (cause instanceof SyncError && cause.code === 'REGISTRY_WRITE') throw cause;
    failures.add(op.key);
    report.failed++;
    report.diagnostics.push({
      level: 'error',
      code: cause instanceof SyncError ? cause.code : 'FIGMA_WRITE',
      token: op.desired.name,
      message: safeError(cause),
    });
  }
  async function progress(message: string) {
    control.progress(message, ++done, total);
    if (done % 30 === 0) {
      checkpoint();
      await tick();
    }
  }
  const cancelled = () => {
    if (!control.cancelled) return false;
    report.cancelled = true;
    return true;
  };
  adapter.api.commitUndo();
  try {
    if (plan.model.settings.variables)
      for (const op of plan.collections) {
        if (cancelled()) break;
        await progress(`Preparing collection ${op.desired.name}`);
        if (blocked(op)) {
          failures.add(op.key);
          continue;
        }
        try {
          const existed = !!op.targetId;
          const parentGroup = op.desired.parentGroup;
          const inPlan =
            parentGroup && plan.collections.some((parent) => parent.desired.name === parentGroup);
          const parentId = inPlan ? collectionIds.get(parentGroup) : op.desired.parentId;
          if (inPlan && !parentId)
            throw new SyncError('EXTENSION_PARENT', 'The parent collection could not be prepared.');
          const name = op.desired.figmaName ?? op.desired.name;
          const collection = op.targetId
            ? adapter.collections.get(op.targetId)!
            : adapter.createCollection(name, parentId);
          collectionIds.set(op.desired.name, collection.id);
          save(op, 'collection', collection.id, undefined, 'partial');
          checkpoint();
          if (collection.name !== name) collection.name = name;
          let usedDefault = existed || collection.isExtension;
          for (const mode of op.desired.modes) {
            const mapKey = registryKey(
              plan.model.identity,
              keyOf('mode', op.desired.name, mode.key),
            );
            const parent = parentId ? adapter.collections.get(parentId) : undefined;
            const parentMode = mode.parentMode;
            const savedParentMode =
              parentGroup && parentMode
                ? registry.modes[
                    registryKey(plan.model.identity, keyOf('mode', parentGroup, parentMode.key))
                  ]
                : undefined;
            const inheritedModeId =
              parent && (parentMode || !existed)
                ? (parentGroup && modeIds.get(keyOf(parentGroup, parentMode?.key ?? mode.key))) ||
                  parent.modes.find(
                    (m) =>
                      m.modeId === savedParentMode ||
                      m.modeId === parentMode?.sourceId ||
                      m.name === (parentMode?.name ?? mode.name),
                  )?.modeId
                : undefined;
            let found = collection.modes.find((m) =>
              inheritedModeId
                ? 'parentModeId' in m && m.parentModeId === inheritedModeId
                : m.modeId === registry.modes[mapKey] ||
                  m.modeId === mode.sourceId ||
                  m.name === mode.name,
            );
            if (!found && collection.isExtension)
              throw new SyncError(
                'EXTENSION_MODE',
                'A required mode is not inherited from the parent collection.',
              );
            if (!found && !usedDefault) {
              collection.renameMode(collection.defaultModeId, mode.name);
              found = { modeId: collection.defaultModeId, name: mode.name };
              usedDefault = true;
            }
            if (!found) {
              try {
                found = { modeId: collection.addMode(mode.name), name: mode.name };
              } catch {
                throw new SyncError(
                  'MODE_LIMIT',
                  'Figma could not add a mode. Check the file plan’s mode limit, reduce the selected group or upgrade the plan. Existing modes remain intact.',
                );
              }
            }
            if (found.name !== mode.name && (!collection.isExtension || !!mode.parentMode))
              collection.renameMode(found.modeId, mode.name);
            registry.modes[mapKey] = found.modeId;
            modeIds.set(keyOf(op.desired.name, mode.key), found.modeId);
            dirty = true;
          }
          save(op, 'collection', collection.id, collection.modes);
          checkpoint();
        } catch (cause) {
          collectionIds.delete(op.desired.name);
          error(op, cause);
          checkpoint();
        }
      }
    else
      for (const op of plan.collections)
        if (op.targetId) collectionIds.set(op.desired.name, op.targetId);
    // Allocate identities before setting any aliases. A failed allocation blocks its dependants.
    for (const op of plan.variables) {
      if (cancelled()) break;
      await progress(`Preparing variable ${op.desired.name}`);
      if (blocked(op)) {
        failures.add(op.key);
        report.skipped++;
        continue;
      }
      if (!plan.model.settings.variables) {
        if (op.targetId) variableIds.set(op.key, op.targetId);
        continue;
      }
      const collectionId = collectionIds.get(op.desired.group);
      if (!collectionId) {
        failures.add(op.key);
        report.skipped++;
        continue;
      }
      try {
        const collection = adapter.collections.get(collectionId)!;
        const targetId = op.inheritedFrom ? variableIds.get(op.inheritedFrom) : op.targetId;
        if (collection.isExtension && (!targetId || !collection.variableIds.includes(targetId)))
          throw new SyncError(
            'EXTENSION_VARIABLE',
            'The inherited variable could not be prepared.',
          );
        const variable = targetId
          ? adapter.variables.get(targetId)!
          : adapter.createVariable(op.desired.name, collection, op.desired.type);
        variableIds.set(op.key, variable.id);
        if (!targetId) {
          variable.description = op.desired.description ?? '';
          save(op, 'variable', variable.id, undefined, 'partial');
        }
      } catch (cause) {
        error(op, cause);
      }
    }
    checkpoint();
    const visited = new Set<string>(),
      pending = new Set<string>();
    const variablesByKey = new Map(plan.variables.map((v) => [v.key, v]));
    const writeVariable = async (op: Operation<DesiredVariable>): Promise<void> => {
      if (visited.has(op.key) || failures.has(op.key) || cancelled()) return;
      // The resolver validates cycles within each theme. The union of valid per-mode
      // dependencies can contain cycles (A→B in Light, B→A in Dark); identities already exist.
      if (pending.has(op.key)) return;
      pending.add(op.key);
      for (const spec of Object.values(op.desired.values))
        if (spec.alias) {
          const dependency = variablesByKey.get(spec.alias);
          if (dependency) await writeVariable(dependency);
          if (!dependency || failures.has(spec.alias)) failures.add(op.key);
        }
      pending.delete(op.key);
      visited.add(op.key);
      if (cancelled()) return;
      if (failures.has(op.key)) {
        report.skipped++;
        report.diagnostics.push({
          level: 'error',
          code: 'DEPENDENCY_FAILED',
          token: op.desired.path,
          message: 'Variable was skipped because its alias dependency failed.',
        });
        return;
      }
      await progress(`Syncing variable ${op.desired.name}`);
      try {
        const variable = adapter.variables.get(variableIds.get(op.key)!);
        if (!variable)
          throw new SyncError('VARIABLE_MISSING', 'The variable is no longer available.');
        const collection = adapter.collections.get(collectionIds.get(op.desired.group)!)!;
        let values = collection.isExtension
          ? await variable.valuesByModeForCollectionAsync(collection)
          : variable.valuesByMode;
        const desiredValues: Record<string, unknown> = {};
        for (const [themeId, spec] of Object.entries(op.desired.values)) {
          const modeId = modeIds.get(keyOf(op.desired.group, themeId));
          if (!modeId) throw new SyncError('MODE_MISSING', 'The variable mode is unavailable.');
          const alias = spec.alias
            ? adapter.variables.get(variableIds.get(spec.alias)!)
            : undefined;
          if (spec.alias && !alias)
            throw new SyncError('ALIAS_MISSING', 'An alias target failed to sync.');
          const value = alias ? adapter.api.variables.createVariableAlias(alias) : spec.literal;
          desiredValues[modeId] = value;
          if (collection.isExtension) {
            const extension = collection as unknown as ExtendedVariableCollection;
            const parent = adapter.collections.get(extension.parentVariableCollectionId);
            const parentModeId = extension.modes.find((m) => m.modeId === modeId)?.parentModeId;
            const parentValues = parent?.isExtension
              ? await variable.valuesByModeForCollectionAsync(parent)
              : variable.valuesByMode;
            if (parentModeId && equal(parentValues[parentModeId], value)) {
              if (
                Object.prototype.hasOwnProperty.call(
                  extension.variableOverrides?.[variable.id] ?? {},
                  modeId,
                )
              )
                variable.removeOverrideForMode(modeId);
              continue;
            }
          }
          if (!equal(values[modeId], value)) variable.setValueForMode(modeId, value);
        }
        if (!collection.isExtension && variable.name !== op.desired.name)
          variable.name = op.desired.name;
        if (!plan.model.settings.preserveMetadata && !collection.isExtension)
          variable.description = op.desired.description ?? '';
        values = collection.isExtension
          ? await variable.valuesByModeForCollectionAsync(collection)
          : variable.valuesByMode;
        if (!Object.entries(desiredValues).every(([mode, value]) => equal(values[mode], value)))
          throw new SyncError(
            'VERIFY_VARIABLE',
            'Figma did not retain the expected variable values. Retry with a fresh preview.',
          );
        const previous = registry.entries[registryKey(plan.model.identity, op.key)];
        const baseline =
          previous?.targetId === variable.id && record(previous.lastValue)
            ? previous.lastValue
            : {};
        save(op, 'variable', variable.id, { ...baseline, ...desiredValues });
        report[
          op.action === 'new' ? 'created' : op.action === 'updated' ? 'updated' : 'unchanged'
        ]++;
      } catch (cause) {
        const id = variableIds.get(op.key);
        if (id) save(op, 'variable', id, undefined, 'partial');
        error(op, cause);
      }
    };
    if (plan.model.settings.variables) for (const op of plan.variables) await writeVariable(op);
    checkpoint();
    for (const op of plan.styles) {
      if (cancelled()) break;
      await progress(`Syncing style ${op.desired.name}`);
      if (blocked(op) || op.desired.bindings.some((b) => failures.has(b.variable))) {
        report.skipped++;
        continue;
      }
      if (failedFonts.has(op.key)) {
        error(
          op,
          new SyncError(
            'FONT_LOAD',
            'Figma could not load the exact required font. Install or enable the font and retry; the style was not changed.',
          ),
        );
        continue;
      }
      let target: TextStyle | EffectStyle | PaintStyle | undefined;
      let previous: StyleState | undefined;
      try {
        target = op.targetId ? adapter.styles.get(op.targetId) : undefined;
        if (target) previous = styleState(target);
        const material = materializedStyle(
          op.desired,
          variableIds,
          previous,
          plan.model.settings.preserveBindings,
          op.replacedBindings,
        );
        if (material.conflict) throw new SyncError('BINDING_CONFLICT', material.conflict);
        if (Object.values(material.bindings).some((id) => id.startsWith('pending:')))
          throw new SyncError(
            'BINDING_MISSING',
            'A style binding is unavailable. Sync its variables first.',
          );
        if (!target) {
          target = adapter.createStyle(op.desired.kind);
          target.name = op.desired.name;
          target.description = op.desired.description ?? '';
          save(op, 'style', target.id, undefined, 'partial');
          checkpoint();
        }
        if (op.action !== 'unchanged')
          await adapter.writeStyle(
            target,
            op.desired,
            material.bindings,
            plan.model.settings.preserveMetadata,
          );
        if (
          !styleMatches(
            op.desired,
            styleState(target),
            variableIds,
            plan.model.settings.preserveBindings,
          )
        )
          throw new SyncError(
            'VERIFY_STYLE',
            'Figma did not retain the expected style values or bindings. The previous style will be restored where possible.',
          );
        const syncedState = styleState(target);
        save(op, 'style', target.id, { data: syncedState.data, bindings: syncedState.bindings });
        report[
          op.action === 'new' ? 'created' : op.action === 'updated' ? 'updated' : 'unchanged'
        ]++;
      } catch (cause) {
        if (previous && target)
          try {
            await adapter.writeStyle(
              target,
              {
                ...op.desired,
                name: previous.name,
                data: previous.data,
                description: previous.description,
              },
              previous.bindings,
              false,
            );
          } catch {
            report.diagnostics.push({
              level: 'error',
              code: 'ROLLBACK',
              token: op.desired.path,
              message:
                'The previous style could not be fully restored. Use Figma Undo to revert this sync.',
            });
          }
        error(op, cause);
      }
    }
  } finally {
    control.progress('Saving sync results…', done, total);
    try {
      checkpoint();
    } finally {
      adapter.api.commitUndo();
    }
  }
  if (!report.cancelled) control.progress('Finished sending to Figma', total, total);
  report.completedAt = new Date().toISOString();
  return report;
}
