import {
  BindingSpec,
  DesiredModel,
  DesiredCollection,
  DesiredStyle,
  DesiredVariable,
  Diagnostic,
  Settings,
  SyncError,
  Theme,
  Token,
  TokenProject,
  VariableType,
  figmaName,
  keyOf,
  record,
  stable,
  tick,
  variableKey,
} from './model';
import { TokenResolver, exactReference } from './resolver';
import { composite } from './composites';
import { numeric, primitive } from './values';

export function setAt(object: any, path: string, value: unknown): void {
  const parts = path.split('.');
  let cursor = object;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (cursor[part] === undefined) cursor[part] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}
export function getAt(object: any, path: string): unknown {
  return path.split('.').reduce((v, part) => v?.[part], object);
}
export function styleSignature(data: unknown, bindings: BindingSpec[]): string {
  const normalized = JSON.parse(JSON.stringify(data));
  for (const binding of bindings) setAt(normalized, binding.field, { variable: binding.variable });
  return stable(normalized);
}
function expanded(
  token: Token,
  resolver: TokenResolver,
  root: number,
  warn: (message: string) => void,
): Token[] {
  const value = resolver.resolve(token.path),
    type = token.type.toLowerCase();
  if (type === 'border') {
    if (
      !record(value) ||
      value.color === undefined ||
      value.width === undefined ||
      value.style === undefined
    )
      throw new SyncError('BORDER', 'Border requires color, width and style.');
    const extras = Object.keys(value).filter((k) => !['color', 'width', 'style'].includes(k));
    if (extras.length || typeof value.style !== 'string')
      throw new SyncError(
        'BORDER',
        'This border contains unsupported properties or a composite stroke style.',
      );
    const raw = resolver.rawComposite(token.path);
    warn('Exports color, width, and style as separate variables. Set the stroke in Figma.');
    return [
      ['color', 'color'],
      ['width', 'borderWidth'],
      ['style', 'string'],
    ].map(([field, fieldType]) => ({
      ...token,
      path: `${token.path}.${field}`,
      type: fieldType,
      value: record(raw) ? raw[field] : value[field],
    }));
  }
  if (
    ['borderradius', 'spacing'].includes(type) &&
    typeof value === 'string' &&
    !/[+*/()]/.test(value)
  ) {
    const parts = value.trim().split(/\s+/);
    if (parts.length >= 2 && parts.length <= 4) {
      parts.forEach((p) => numeric(p, root));
      const [a, b = a, c = a, d = b] = parts;
      const names =
        type === 'borderradius'
          ? ['topLeft', 'topRight', 'bottomRight', 'bottomLeft']
          : ['top', 'right', 'bottom', 'left'];
      warn('Exports four number variables. Apply them to the matching sides or corners in Figma.');
      return names.map((name, i) => ({
        ...token,
        path: `${token.path}.${name}`,
        type: 'dimension',
        value: [a, b, c, d][i],
      }));
    }
  }
  return [token];
}
export async function buildDesired(
  project: TokenProject,
  settings: Settings,
): Promise<DesiredModel> {
  if (
    !Number.isFinite(settings.rootFontSize) ||
    settings.rootFontSize <= 0 ||
    settings.rootFontSize > 1000
  )
    throw new SyncError('SETTINGS', 'Root font size must be between 0 and 1000 px.');
  const excluded = new Set(settings.excludedThemeIds);
  const diagnostics = project.diagnostics.filter((d) => !d.theme || !excluded.has(d.theme));
  const themes = project.themes.filter(
    (t) => (!settings.groups.length || settings.groups.includes(t.group)) && !excluded.has(t.id),
  );
  const resolvers = themes.map((theme) => new TokenResolver(project, theme, settings));
  const themesById = new Map(project.themes.map((theme) => [theme.id, theme]));
  const groupsByCollection = new Map<string, Set<string>>();
  for (const theme of project.themes) {
    if (!theme.collectionId) continue;
    const groups = groupsByCollection.get(theme.collectionId) ?? new Set<string>();
    groups.add(theme.group);
    groupsByCollection.set(theme.collectionId, groups);
  }
  const modeFor = (theme: Theme) => ({ key: theme.id, name: theme.name, sourceId: theme.modeId });
  const collections: DesiredCollection[] = [...new Set(themes.map((t) => t.group))].map((group) => {
    const selected = themes.filter((t) => t.group === group);
    const groupThemes = project.themes.filter((t) => t.group === group);
    const extension = groupThemes.some((t) => t.isExtension);
    const parentIds = new Set(
      groupThemes.flatMap((t) => (t.parentCollectionId ? [t.parentCollectionId] : [])),
    );
    const parentGroups = new Set(
      groupThemes.flatMap((t) => {
        const parentTheme = t.parentThemeId && themesById.get(t.parentThemeId);
        const collectionGroups = t.parentCollectionId
          ? groupsByCollection.get(t.parentCollectionId)
          : undefined;
        return [...(parentTheme ? [parentTheme.group] : []), ...(collectionGroups ?? [])];
      }),
    );
    const parentId =
      settings.extensionParents[group] ?? (extension ? [...parentIds][0] : undefined);
    return {
      partialSelection: groupThemes.some((t) => excluded.has(t.id)),
      key: keyOf('collection', group),
      name: group,
      figmaName: extension ? group.split('/').pop()?.trim() || group : undefined,
      sourceIds: [...new Set(selected.flatMap((t) => (t.collectionId ? [t.collectionId] : [])))],
      parentId,
      parentGroup: extension ? [...parentGroups][0] : undefined,
      extensionError:
        extension &&
        (groupThemes.some((t) => !t.isExtension) ||
          parentIds.size > 1 ||
          parentGroups.size > 1 ||
          (!parentId && !parentGroups.size))
          ? 'The extended theme group must reference a single parent collection.'
          : undefined,
      modes: selected.map((t) => {
        const parent = extension && t.parentThemeId ? themesById.get(t.parentThemeId) : undefined;
        return { ...modeFor(t), parentMode: parent ? modeFor(parent) : undefined };
      }),
    };
  });
  const variables = new Map<string, DesiredVariable>();
  const origins = new Map<string, { resolver: TokenResolver; token: Token }[]>();
  const issue = (error: unknown, token: Token, theme: Theme) =>
    diagnostics.push({
      level: 'error',
      code: error instanceof SyncError ? error.code : 'TOKEN',
      token: token.path,
      theme: theme.id,
      message: error instanceof SyncError ? error.message : 'Token conversion failed.',
    });
  let work = 0;
  // Variables are built even for Styles-only, so references can match existing variables.
  for (const resolver of resolvers) {
    if (diagnostics.some((d) => d.code === 'MISSING_SET' && d.theme === resolver.theme.id))
      continue;
    for (const source of resolver.exported.values()) {
      if (++work % 100 === 0) await tick();
      try {
        for (const token of expanded(source, resolver, settings.rootFontSize, (message) => {
          if (settings.variables)
            diagnostics.push({
              level: 'warning',
              code: 'PARTIAL_COMPOSITE',
              token: source.path,
              theme: resolver.theme.id,
              message,
            });
        })) {
          const value =
            token === source ? resolver.resolve(token.path) : resolver.resolveValue(token.value);
          const converted = primitive(token, value, settings.rootFontSize);
          if (!converted) continue;
          const group = resolver.theme.group,
            key = variableKey(group, token.path);
          let variable = variables.get(key);
          if (!variable) {
            variable = {
              key,
              path: token.path,
              tokenType: token.type,
              group,
              name: figmaName(token.path),
              type: converted.type,
              values: {},
              sourceIds: [],
              description: token.description,
            };
            variables.set(key, variable);
          }
          if (variable.type !== converted.type) {
            issue(
              new SyncError(
                'TYPE_CONFLICT',
                'The same token has incompatible variable types across modes.',
              ),
              token,
              resolver.theme,
            );
            continue;
          }
          variable.values[resolver.theme.id] = { literal: converted.literal };
          const sourceId = resolver.theme.variableReferences[token.path];
          if (sourceId && !variable.sourceIds.includes(sourceId)) variable.sourceIds.push(sourceId);
          origins.set(key, [...(origins.get(key) ?? []), { resolver, token }]);
        }
      } catch (error) {
        if (settings.variables) issue(error, source, resolver.theme);
      }
    }
  }
  const reference = (
    path: string,
    type: VariableType,
    resolver: TokenResolver,
  ): string | undefined => {
    const ownKey = variableKey(resolver.theme.group, path),
      own = variables.get(ownKey);
    if (own?.type === type && own.values[resolver.theme.id]) return ownKey;
    const source = resolver.tokens.get(path);
    if (!source) return;
    const candidates = [...variables.values()].filter(
      (v) =>
        v.path === path &&
        v.type === type &&
        origins.get(v.key)?.some((origin) => origin.token.set === source.set),
    );
    if (candidates.length === 1) return candidates[0].key;
  };
  for (const variable of variables.values())
    for (const { resolver, token } of origins.get(variable.key) ?? []) {
      const path = exactReference(token.value);
      if (!path) continue;
      const alias = reference(path, variable.type, resolver);
      if (alias && alias !== variable.key) variable.values[resolver.theme.id].alias = alias;
      else
        diagnostics.push({
          level: 'info',
          code: 'RESOLVED_ALIAS',
          token: token.path,
          theme: resolver.theme.id,
          message: `Reference {${path}} is resolved to a value because no unambiguous compatible exported variable is available.`,
        });
    }
  const styleCandidates: DesiredStyle[] = [];
  if (settings.styles)
    for (const resolver of resolvers) {
      if (settings.styleThemes.length && !settings.styleThemes.includes(resolver.theme.id))
        continue;
      if (diagnostics.some((d) => d.code === 'MISSING_SET' && d.theme === resolver.theme.id))
        continue;
      for (const token of resolver.exported.values()) {
        if (++work % 100 === 0) await tick();
        try {
          const value = resolver.resolve(token.path);
          const raw = resolver.rawComposite(token.path) ?? token.value;
          const result = composite(token, value, raw, settings.rootFontSize);
          if (!result) {
            if (
              !variables.has(variableKey(resolver.theme.group, token.path)) &&
              !['border', 'borderradius', 'spacing'].includes(token.type.toLowerCase())
            )
              diagnostics.push({
                level: 'warning',
                code: 'UNSUPPORTED',
                token: token.path,
                theme: resolver.theme.id,
                message: `Token type ${token.type} has no supported native representation.`,
              });
            continue;
          }
          const bindings: BindingSpec[] = [];
          if (settings.styleStrategy === 'linked') {
            // Solid color styles can reference their own corresponding color variable.
            if (
              result.kind === 'PAINT' &&
              token.type === 'color' &&
              !String(value).includes('gradient')
            ) {
              const own = variables.get(variableKey(resolver.theme.group, token.path));
              if (own?.type === 'COLOR')
                bindings.push({ field: 'paints.0.color', variable: own.key });
            }
            for (const entry of result.references) {
              if (bindings.some((b) => b.field === entry.field)) continue;
              const target = reference(entry.path, entry.type, resolver);
              if (target) bindings.push({ field: entry.field, variable: target });
              else
                diagnostics.push({
                  level: 'info',
                  code: 'RESOLVED_STYLE_REFERENCE',
                  token: token.path,
                  theme: resolver.theme.id,
                  message: `Style reference {${entry.path}} is resolved to a literal; no compatible exported variable was found.`,
                });
            }
          }
          for (const message of result.warnings)
            diagnostics.push({
              level: 'warning',
              code: 'STYLE_CONVERSION',
              token: token.path,
              theme: resolver.theme.id,
              message,
            });
          styleCandidates.push({
            key: '',
            path: token.path,
            tokenType: token.type,
            group: resolver.theme.group,
            theme: resolver.theme.id,
            kind: result.kind,
            name: '',
            data: result.data,
            bindings,
            description: token.description,
            sourceIds: resolver.theme.styleReferences[token.path]
              ? [resolver.theme.styleReferences[token.path]]
              : [],
          });
        } catch (error) {
          if (
            !diagnostics.some(
              (d) => d.token === token.path && d.theme === resolver.theme.id && d.level === 'error',
            )
          )
            issue(error, token, resolver.theme);
        }
      }
    }
  if (!settings.styles)
    for (const resolver of resolvers)
      for (const token of resolver.exported.values()) {
        if (
          !variables.has(variableKey(resolver.theme.group, token.path)) &&
          !['border', 'spacing', 'borderRadius'].includes(token.type)
        )
          diagnostics.push({
            level: 'warning',
            code: 'UNSUPPORTED',
            token: token.path,
            theme: resolver.theme.id,
            message: `Token type ${token.type} cannot be exported as a scalar variable. Enable Styles for supported composites.`,
          });
      }
  const groupedStyles = new Map<string, DesiredStyle[]>();
  for (const style of styleCandidates) {
    const key = keyOf(style.group, style.path, style.kind);
    groupedStyles.set(key, [...(groupedStyles.get(key) ?? []), style]);
  }
  // Keep linked vs. theme-specific style identities stable on a partial group send.
  const partialGroups = collections.filter((c) => c.partialSelection).map((c) => c.name);
  const fullGroupStyles =
    partialGroups.length && settings.styles && settings.styleStrategy === 'linked'
      ? (await buildDesired(project, { ...settings, groups: partialGroups, excludedThemeIds: [] }))
          .styles
      : [];
  const linkedKeys = new Set(fullGroupStyles.filter((s) => s.theme === 'linked').map((s) => s.key));
  const styles: DesiredStyle[] = [];
  for (const candidates of groupedStyles.values()) {
    const shared =
      settings.styleStrategy === 'linked' &&
      (!partialGroups.includes(candidates[0].group) ||
        linkedKeys.has(
          keyOf('style', candidates[0].group, 'linked', candidates[0].kind, candidates[0].path),
        )) &&
      candidates.every(
        (s) =>
          styleSignature(s.data, s.bindings) ===
          styleSignature(candidates[0].data, candidates[0].bindings),
      );
    for (const style of shared ? [candidates[0]] : candidates) {
      const theme = themes.find((t) => t.id === style.theme)!;
      if (shared) {
        style.theme = 'linked';
        style.sourceIds = [...new Set(candidates.flatMap((s) => s.sourceIds))];
      }
      // Theme-specific fallback removes bindings: its selected values must not switch with another mode.
      else if (settings.styleStrategy === 'linked') {
        style.bindings = [];
        diagnostics.push({
          level: 'info',
          code: 'THEME_STYLE',
          token: style.path,
          theme: theme.id,
          message: 'Values differ by theme, so each theme gets its own style.',
        });
      }
      if (style.kind === 'TEXT')
        style.requiredFonts = (shared ? candidates : [style]).map(
          (s) => s.data.fontName as { family: string; style: string },
        );
      style.key = keyOf('style', style.group, style.theme, style.kind, style.path);
      const kind = { TEXT: 'Typography', EFFECT: 'Effects', PAINT: 'Paint' }[style.kind];
      let pattern = settings.styleName || '{kind}/{group}/{theme}/{token}';
      if (!pattern.includes('{token}'))
        throw new SyncError('STYLE_NAME', 'Style naming must include {token}.');
      if (!pattern.includes('{group}')) pattern = `{group}/${pattern}`;
      if (!shared && !pattern.includes('{theme}')) pattern = `{theme}/${pattern}`;
      style.name = pattern
        .replace(/\{kind\}/g, kind)
        .replace(/\{group\}/g, style.group)
        .replace(/\{theme\}/g, shared ? 'Linked' : theme.name)
        .replace(/\{token\}/g, figmaName(style.path));
      styles.push(style);
    }
  }
  let exportedVariables = [...variables.values()];
  let exportedCollections = collections;
  if (!settings.variables) {
    const required = new Set(
      styles.flatMap((style) => style.bindings.map((binding) => binding.variable)),
    );
    for (const key of required)
      for (const value of Object.values(variables.get(key)?.values ?? {}))
        if (value.alias) required.add(value.alias);
    exportedVariables = exportedVariables.filter((v) => required.has(v.key));
    const groups = new Set(exportedVariables.map((v) => v.group));
    exportedCollections = collections.filter((c) => groups.has(c.name));
  }
  return {
    identity: project.identity,
    revision: project.revision,
    settings,
    collections: exportedCollections,
    variables: exportedVariables,
    styles,
    diagnostics,
  };
}
