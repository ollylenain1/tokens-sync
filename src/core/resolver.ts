import { Dict, Settings, SyncError, Theme, Token, TokenProject, record } from './model';
export const exactReference = (value: unknown): string | undefined =>
  typeof value === 'string' ? /^\{([^{}]+)\}$/.exec(value.trim())?.[1] : undefined;
export class TokenResolver {
  readonly tokens = new Map<string, Token>();
  readonly exported = new Map<string, Token>();
  private cache = new Map<string, unknown>();
  constructor(
    project: TokenProject,
    readonly theme: Theme,
    settings: Settings,
  ) {
    // Source is the reference fallback; enabled definitions always take precedence.
    for (const status of ['source', 'enabled'])
      for (const set of project.order) {
        if (theme.selectedTokenSets[set] !== status) continue;
        for (const token of project.sets[set] ?? []) {
          this.tokens.set(token.path, token);
          if (status === 'enabled' && (!settings.sets.length || settings.sets.includes(set)))
            this.exported.set(token.path, token);
        }
      }
    // Export only the effective token when a later enabled set overrides an earlier selection.
    for (const path of this.exported.keys()) {
      const token = this.tokens.get(path)!;
      if (settings.sets.length && !settings.sets.includes(token.set)) this.exported.delete(path);
      else this.exported.set(path, token);
    }
  }
  resolve(path: string, stack: string[] = []): unknown {
    if (this.cache.has(path)) return this.cache.get(path);
    if (stack.includes(path))
      throw new SyncError(
        'CIRCULAR_REFERENCE',
        `Circular reference: ${[...stack, path].join(' → ')}.`,
      );
    if (stack.length >= 100)
      throw new SyncError('REFERENCE_DEPTH', `Reference depth exceeds 100 at ${path}.`);
    const token = this.tokens.get(path);
    if (!token)
      throw new SyncError(
        'MISSING_REFERENCE',
        `Missing reference {${path}} in theme ${this.theme.name}.`,
      );
    const studio = token.extensions?.['studio.tokens'];
    if (record(studio) && studio.modify)
      throw new SyncError(
        'COLOR_MODIFIER',
        `Token ${path} uses a Tokens Studio color modifier. Export a resolved color before syncing.`,
      );
    const value = this.resolveValue(token.value, [...stack, path]);
    this.cache.set(path, value);
    return value;
  }
  resolveValue(value: unknown, stack: string[] = []): unknown {
    if (Array.isArray(value)) return value.map((v) => this.resolveValue(v, stack));
    if (record(value)) {
      if ('$ref' in value)
        throw new SyncError('DTCG_REFERENCE', 'JSON Pointer $ref is not supported.');
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, this.resolveValue(v, stack)]),
      );
    }
    if (typeof value !== 'string') return value;
    const ref = exactReference(value);
    if (ref) return this.resolve(ref, stack);
    return value.replace(/\{([^{}]+)\}/g, (_match, path: string) => {
      const resolved = this.resolve(path, stack);
      if (
        record(resolved) &&
        typeof resolved.value === 'number' &&
        typeof resolved.unit === 'string'
      )
        return `${resolved.value}${resolved.unit}`;
      if (
        typeof resolved === 'string' ||
        typeof resolved === 'number' ||
        typeof resolved === 'boolean'
      )
        return String(resolved);
      throw new SyncError(
        'COMPOSITE_INTERPOLATION',
        `Composite reference {${path}} cannot be interpolated into a string.`,
      );
    });
  }
  rawComposite(path: string, seen = new Set<string>()): Dict | unknown[] | undefined {
    if (seen.has(path)) return;
    seen.add(path);
    const value = this.tokens.get(path)?.value,
      ref = exactReference(value);
    if (ref) return this.rawComposite(ref, seen);
    return record(value) || Array.isArray(value) ? value : undefined;
  }
}
