export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Dict = Record<string, unknown>;
export type ProviderKind = 'github' | 'gitlab';
export interface Connection {
  name?: string;
  provider: ProviderKind;
  baseUrl: string;
  owner: string;
  repository: string;
  branch: string;
  path: string;
  layout: 'auto' | 'bundle' | 'single-set';
  token: string;
  remember: boolean;
}
export interface RepositorySnapshot {
  identity: string;
  revision: string;
  fetchedAt: string;
  files: Record<string, string>;
  singleFile?: string;
  layout: Connection['layout'];
}
export interface Diagnostic {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  token?: string;
  theme?: string;
}
export interface Token {
  path: string;
  type: string;
  value: unknown;
  set: string;
  description?: string;
  dtcg: boolean;
  extensions?: Dict;
}
export interface Theme {
  id: string;
  name: string;
  group: string;
  selectedTokenSets: Record<string, 'enabled' | 'source' | 'disabled'>;
  collectionId?: string;
  modeId?: string;
  isExtension?: boolean;
  parentCollectionId?: string;
  parentThemeId?: string;
  variableReferences: Record<string, string>;
  styleReferences: Record<string, string>;
}
export interface TokenProject {
  identity: string;
  revision: string;
  fetchedAt: string;
  sets: Record<string, Token[]>;
  order: string[];
  themes: Theme[];
  diagnostics: Diagnostic[];
}
export interface Settings {
  variables: boolean;
  styles: boolean;
  groups: string[];
  excludedThemeIds?: string[];
  sets: string[];
  styleThemes: string[];
  styleStrategy: 'linked' | 'themes';
  styleName: string;
  preserveMetadata: boolean;
  preserveBindings: boolean;
  rootFontSize: number;
  extensionParents: Record<string, string>;
}
export const defaultSettings: Settings = {
  variables: true,
  styles: true,
  groups: [],
  sets: [],
  styleThemes: [],
  styleStrategy: 'linked',
  styleName: '{kind}/{group}/{theme}/{token}',
  preserveMetadata: true,
  preserveBindings: true,
  rootFontSize: 16,
  extensionParents: {},
};
export type VariableType = 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
export type Literal = string | number | boolean | { r: number; g: number; b: number; a: number };
export interface ValueSpec {
  literal: Literal;
  alias?: string;
}
export interface DesiredCollection {
  partialSelection?: boolean;
  key: string;
  name: string;
  sourceIds: string[];
  figmaName?: string;
  parentId?: string;
  parentGroup?: string;
  extensionError?: string;
  modes: {
    key: string;
    name: string;
    sourceId?: string;
    parentMode?: { key: string; name: string; sourceId?: string };
  }[];
}
export interface DesiredVariable {
  key: string;
  path: string;
  tokenType: string;
  group: string;
  name: string;
  type: VariableType;
  values: Record<string, ValueSpec>;
  sourceIds: string[];
  description?: string;
}
export interface BindingSpec {
  field: string;
  variable: string;
}
export interface StyleData {
  [key: string]: unknown;
}
export interface DesiredStyle {
  key: string;
  path: string;
  tokenType: string;
  group: string;
  theme: string;
  kind: 'TEXT' | 'EFFECT' | 'PAINT';
  name: string;
  data: StyleData;
  bindings: BindingSpec[];
  sourceIds: string[];
  description?: string;
  requiredFonts?: { family: string; style: string }[];
}
export interface DesiredModel {
  identity: string;
  revision: string;
  settings: Settings;
  collections: DesiredCollection[];
  variables: DesiredVariable[];
  styles: DesiredStyle[];
  diagnostics: Diagnostic[];
}
export interface CollectionState {
  id: string;
  key?: string;
  name: string;
  modes: { modeId: string; name: string; parentModeId?: string }[];
  variableIds: string[];
  isExtension: boolean;
  parentId?: string;
  canExtend: boolean;
  overrideModes?: Record<string, string[]>;
}
export interface VariableState {
  id: string;
  key?: string;
  name: string;
  collectionId: string;
  type: VariableType;
  values: Record<string, unknown>;
  description: string;
}
export interface StyleState {
  id: string;
  key?: string;
  name: string;
  kind: DesiredStyle['kind'];
  data: StyleData;
  bindings: Record<string, string>;
  description: string;
}
export interface DocumentState {
  identity: string;
  collections: CollectionState[];
  variables: VariableState[];
  styles: StyleState[];
}
export interface Mapping {
  source: string;
  path: string;
  tokenType: string;
  group: string;
  theme?: string;
  kind: 'collection' | 'variable' | 'style';
  targetId: string;
  fileIdentity: string;
  lastValue?: unknown;
  status: 'synced' | 'missing' | 'partial';
}
export interface Registry {
  version: 1;
  fileIdentity: string;
  entries: Record<string, Mapping>;
  modes: Record<string, string>;
}
export type Action = 'new' | 'updated' | 'unchanged' | 'conflicting' | 'skipped';
export interface PropertyChange {
  field: string;
  kind: 'value' | 'binding' | 'name' | 'description' | 'mode';
  before?: unknown;
  after?: unknown;
  changed: boolean;
}
export interface Operation<T> {
  key: string;
  action: Action;
  desired: T;
  targetId?: string;
  inheritedFrom?: string;
  reason?: string;
  missingTarget?: boolean;
  replacedBindings?: Record<string, string>;
  candidates?: { id: string; name: string }[];
  localDrift?: boolean;
  changes?: PropertyChange[];
}
export interface SyncPlan {
  id: string;
  model: DesiredModel;
  documentStamp: string;
  collections: Operation<DesiredCollection>[];
  variables: Operation<DesiredVariable>[];
  styles: Operation<DesiredStyle>[];
  diagnostics: Diagnostic[];
  missing: Mapping[];
  counts: { variables: Record<Action, number>; styles: Record<Action, number> };
}
export interface SyncReport {
  revision?: string;
  source?: string;
  completedAt?: string;
  groups?: string[];
  preserveMetadata?: boolean;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  cancelled: boolean;
  diagnostics: Diagnostic[];
}
export const record = (v: unknown): v is Dict => !!v && typeof v === 'object' && !Array.isArray(v);
export const own = (v: object, key: string) => Object.prototype.hasOwnProperty.call(v, key);
export function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (record(value))
    return (
      '{' +
      Object.keys(value)
        .filter((k) => value[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + stable(value[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}
export function equal(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number')
    return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (record(a) && record(b)) {
    const keys = Object.keys(a).filter((k) => a[k] !== undefined),
      other = Object.keys(b).filter((k) => b[k] !== undefined);
    return keys.length === other.length && keys.every((k) => own(b, k) && equal(a[k], b[k]));
  }
  return a === b;
}
export const keyOf = (...parts: string[]) => JSON.stringify(parts);
export const variableKey = (group: string, path: string) => keyOf('variable', group, path);
export const registryKey = (source: string, key: string) => keyOf(source, key);
export const figmaName = (path: string) => path.replace(/\./g, '/');
export const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
export class SyncError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}
export function safeError(error: unknown): string {
  return error instanceof SyncError
    ? error.message
    : 'The operation could not be completed. Check file access, available fonts and Figma plan limits, then fetch a fresh preview.';
}
