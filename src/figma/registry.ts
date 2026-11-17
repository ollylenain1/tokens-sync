import { Registry, SyncError, record } from '../core/model';
import { emptyRegistry } from '../sync/planner';
const PREFIX = 'blueprint.registry.';
export class RegistryStore {
  readonly identity: string;
  constructor(
    private root: PluginDataMixin,
    fileKey?: string,
  ) {
    this.identity = fileKey
      ? `figma:${fileKey}`
      : root.getPluginData('blueprint.fileIdentity') ||
        `local:${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  read(): Registry {
    const head = this.root.getPluginData(PREFIX + 'head');
    if (!head) return emptyRegistry(this.identity);
    try {
      const { generation, count } = JSON.parse(head);
      if (typeof generation !== 'string' || !Number.isInteger(count) || count < 1 || count > 2000)
        throw new Error();
      let content = '';
      for (let i = 0; i < count; i++)
        content += this.root.getPluginData(`${PREFIX}${generation}.${i}`);
      const data = JSON.parse(content);
      if (data.version !== 1 || !record(data.entries) || !record(data.modes)) throw new Error();
      // A duplicated file with a known file key must not inherit another file's target IDs.
      return data.fileIdentity === this.identity ? data : emptyRegistry(this.identity);
    } catch {
      throw new SyncError(
        'REGISTRY',
        'The local mapping registry could not be read. Restore a previous file version or contact the plugin maintainer; sync is blocked to protect existing identities.',
      );
    }
  }
  write(registry: Registry): void {
    const previous = this.root.getPluginData(PREFIX + 'head');
    const generation = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const serialized = JSON.stringify(registry),
      chunks = serialized.match(/[\s\S]{1,18000}/g) ?? ['{}'];
    try {
      for (let i = 0; i < chunks.length; i++)
        this.root.setPluginData(`${PREFIX}${generation}.${i}`, chunks[i]);
      this.root.setPluginData('blueprint.fileIdentity', this.identity);
      // Commit the head last. Readers never observe a half-written registry.
      this.root.setPluginData(
        PREFIX + 'head',
        JSON.stringify({ generation, count: chunks.length }),
      );
    } catch {
      throw new SyncError(
        'REGISTRY_WRITE',
        'Figma could not save the mapping registry. Sync stopped. Existing changes remain; use Undo or retry after resolving document storage limits.',
      );
    }
    if (previous)
      try {
        const old = JSON.parse(previous);
        for (let i = 0; i < Math.min(old.count, 2000); i++)
          this.root.setPluginData(`${PREFIX}${old.generation}.${i}`, '');
      } catch {
        /* A committed registry remains valid even if obsolete shards cannot be cleared. */
      }
  }
}
