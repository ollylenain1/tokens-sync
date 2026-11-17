import {
  Diagnostic,
  Dict,
  RepositorySnapshot,
  SyncError,
  Theme,
  Token,
  TokenProject,
  own,
  record,
} from './model';

function json(text: string, file: string): unknown {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new SyncError(
      'INVALID_JSON',
      `Invalid JSON in ${file}. Correct the file and fetch again.`,
    );
  }
}
function stringMap(value: unknown): Record<string, string> {
  return record(value)
    ? Object.fromEntries(
        Object.entries(value).filter((p): p is [string, string] => typeof p[1] === 'string'),
      )
    : {};
}
export function parseThemes(input: unknown): Theme[] {
  if (!Array.isArray(input))
    throw new SyncError('THEMES', '$themes must be an array of theme definitions.');
  const ids = new Set<string>();
  return input.map((v, i) => {
    if (!record(v) || typeof v.name !== 'string' || !v.name.trim() || !record(v.selectedTokenSets))
      throw new SyncError('THEMES', `Theme ${i + 1} needs a name and selectedTokenSets object.`);
    const id = typeof v.id === 'string' ? v.id : `name:${String(v.group ?? 'Tokens')}/${v.name}`;
    if (ids.has(id)) throw new SyncError('THEMES', `Duplicate theme identity: ${id}.`);
    ids.add(id);
    const selectedTokenSets: Theme['selectedTokenSets'] = Object.create(null);
    for (const [set, status] of Object.entries(v.selectedTokenSets)) {
      if (!['enabled', 'source', 'disabled'].includes(String(status)))
        throw new SyncError('THEMES', `Invalid token set status in theme ${v.name}: ${set}.`);
      selectedTokenSets[set] = status as 'enabled' | 'source' | 'disabled';
    }
    return {
      id,
      name: v.name,
      group: typeof v.group === 'string' && v.group ? v.group : v.name,
      selectedTokenSets,
      collectionId: typeof v.$figmaCollectionId === 'string' ? v.$figmaCollectionId : undefined,
      modeId: typeof v.$figmaModeId === 'string' ? v.$figmaModeId : undefined,
      variableReferences: stringMap(v.$figmaVariableReferences),
      styleReferences: stringMap(v.$figmaStyleReferences),
    };
  });
}
function flatten(tree: unknown, set: string, diagnostics: Diagnostic[]): Token[] {
  if (!record(tree)) throw new SyncError('TOKENS', `Token set ${set} must be a JSON object.`);
  const tokens: Token[] = [],
    paths = new Set<string>();
  function walk(node: Dict, path: string[], inheritedType?: string, depth = 0): void {
    if (depth > 80) throw new SyncError('DEPTH', `Token nesting is too deep in ${set}.`);
    if (own(node, '$extends') || own(node, '$ref')) {
      diagnostics.push({
        level: 'error',
        code: 'DTCG_REFERENCE',
        token: path.join('.'),
        message: 'DTCG $extends and JSON Pointer $ref are unsupported. This subtree is skipped.',
      });
      return;
    }
    const dtcg = own(node, '$value');
    if (dtcg || own(node, 'value')) {
      const name = path.join('.'),
        type = node.$type ?? node.type ?? inheritedType;
      if (!name || typeof type !== 'string') {
        diagnostics.push({
          level: 'error',
          code: 'TOKEN_TYPE',
          token: name,
          message: `Token in ${set} has no explicit or inherited type.`,
        });
        return;
      }
      if (paths.has(name))
        throw new SyncError('DUPLICATE_TOKEN', `Duplicate token path ${name} in ${set}.`);
      paths.add(name);
      tokens.push({
        path: name,
        type,
        value: dtcg ? node.$value : node.value,
        set,
        dtcg,
        description:
          typeof (node.$description ?? node.description) === 'string'
            ? String(node.$description ?? node.description)
            : undefined,
        extensions: record(node.$extensions) ? node.$extensions : undefined,
      });
      return;
    }
    const type = typeof node.$type === 'string' ? node.$type : inheritedType;
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith('$')) continue;
      if (record(child)) walk(child, [...path, key], type, depth + 1);
      else
        diagnostics.push({
          level: 'warning',
          code: 'IGNORED_DATA',
          token: [...path, key].join('.'),
          message: `Non-token data in ${set} was skipped.`,
        });
    }
  }
  walk(tree, []);
  return tokens;
}
export function parseRepository(snapshot: RepositorySnapshot): TokenProject {
  const sets: Record<string, Token[]> = Object.create(null),
    diagnostics: Diagnostic[] = [];
  let themeInput: unknown, metadata: unknown;
  const files = Object.entries(snapshot.files).sort(([a], [b]) => a.localeCompare(b));
  for (const [file, content] of files) {
    const base = file.split('/').pop();
    if (base === '$themes.json') {
      themeInput = json(content, file);
      continue;
    }
    if (base === '$metadata.json') {
      metadata = json(content, file);
      continue;
    }
    if (!file.endsWith('.json')) continue;
    const data = json(content, file);
    if (!record(data)) throw new SyncError('TOKENS', `${file} must contain a JSON object.`);
    const bundle =
      file === snapshot.singleFile &&
      (snapshot.layout === 'bundle' ||
        (snapshot.layout === 'auto' && (own(data, '$themes') || own(data, '$metadata'))));
    if (bundle) {
      if (data.$themes !== undefined) themeInput = data.$themes;
      if (data.$metadata !== undefined) metadata = data.$metadata;
      for (const [set, value] of Object.entries(data))
        if (!set.startsWith('$')) sets[set] = flatten(value, set, diagnostics);
    } else {
      const set = file.replace(/\.json$/, '');
      sets[set] = flatten(data, set, diagnostics);
    }
  }
  const specified =
    record(metadata) && Array.isArray(metadata.tokenSetOrder)
      ? metadata.tokenSetOrder.filter((v): v is string => typeof v === 'string')
      : [];
  const order = [...new Set([...specified.filter((s) => own(sets, s)), ...Object.keys(sets)])];
  if (!order.length)
    throw new SyncError(
      'NO_TOKENS',
      'No token sets were found at this path. Choose a token file or directory.',
    );
  if (!specified.length && order.length > 1)
    diagnostics.push({
      level: 'warning',
      code: 'SET_ORDER',
      message:
        'No tokenSetOrder metadata found. Using deterministic file/key order; later enabled sets win. Verify precedence.',
    });
  let themes = themeInput !== undefined ? parseThemes(themeInput) : [];
  if (!themes.length) {
    themes = order.map((set) => ({
      id: `set:${set}`,
      name: 'Default',
      group: set,
      selectedTokenSets: { [set]: 'enabled' },
      variableReferences: {},
      styleReferences: {},
    }));
    diagnostics.push({
      level: 'info',
      code: 'NO_THEMES',
      message: 'No themes found. Each token set is offered as a collection with a Default mode.',
    });
  }
  for (const theme of themes)
    for (const [set, status] of Object.entries(theme.selectedTokenSets))
      if (status !== 'disabled' && !own(sets, set))
        diagnostics.push({
          level: 'error',
          code: 'MISSING_SET',
          theme: theme.id,
          message: `Theme ${theme.name} references missing token set ${set}.`,
        });
  return {
    identity: snapshot.identity,
    revision: snapshot.revision,
    fetchedAt: snapshot.fetchedAt,
    sets,
    order,
    themes,
    diagnostics,
  };
}
