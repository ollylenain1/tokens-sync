import { FigmaAdapter } from '../src/figma/adapter';
import { RegistryStore } from '../src/figma/registry';
export function mockFigma(
  options: { enterprise?: boolean; maxModes?: number; fontFailure?: boolean } = {},
) {
  let counter = 0,
    writes = 0;
  const collections: any[] = [],
    variables: any[] = [],
    styles: any[] = [],
    storage = new Map<string, string>();
  const data = () => {
    const map = new Map<string, string>();
    return {
      getPluginData: (k: string) => map.get(k) ?? '',
      setPluginData: (k: string, v: string) => {
        if (v) map.set(k, v);
        else map.delete(k);
      },
    };
  };
  const root = {
    getPluginData: (k: string) => storage.get(k) ?? '',
    setPluginData: (k: string, v: string) => {
      if (v) storage.set(k, v);
      else storage.delete(k);
    },
  };
  const id = (prefix: string) => `${prefix}:${++counter}`;
  function createCollection(name: string, parent?: any): any {
    if (parent && options.enterprise === false)
      throw new Error('in extend: Cannot create extended collections outside of enterprise plan.');
    const cid = id('VariableCollectionId');
    const modes = parent
      ? parent.modes.map((m: any) => ({
          name: m.name,
          parentModeId: m.modeId,
          modeId: `${cid}/${m.modeId}`,
        }))
      : [{ name: 'Mode 1', modeId: id('mode') }];
    const collection: any = {
      ...data(),
      id: cid,
      key: id('collectionKey'),
      name,
      modes,
      defaultModeId: modes[0].modeId,
      variableIds: parent ? [...parent.variableIds] : [],
      remote: false,
      isExtension: !!parent,
      hiddenFromPublishing: false,
      parentVariableCollectionId: parent?.id,
      rootVariableCollectionId: parent?.rootVariableCollectionId ?? parent?.id,
      variableOverrides: {},
      renameMode: (mid: string, newName: string) => {
        writes++;
        modes.find((m: any) => m.modeId === mid).name = newName;
      },
      addMode: (newName: string) => {
        if (parent) throw new Error('Cannot add inherited mode');
        if (modes.length >= (options.maxModes ?? 40)) throw new Error('Limited modes');
        writes++;
        const mid = id('mode');
        modes.push({ name: newName, modeId: mid });
        return mid;
      },
      extend: (newName: string) => createCollection(newName, collection),
      remove: () => {
        throw new Error('Deletion is forbidden in this test');
      },
    };
    collections.push(collection);
    writes++;
    return collection;
  }
  function createVariable(name: string, collection: any, type: string): any {
    if (collection.isExtension) throw new Error('Do not duplicate inherited variables');
    const variable: any = {
      ...data(),
      id: id('VariableID'),
      key: id('variableKey'),
      name,
      variableCollectionId: collection.id,
      resolvedType: type,
      remote: false,
      valuesByMode: {},
      description: '',
      codeSyntax: { WEB: 'var(--local)' },
      scopes: ['ALL_SCOPES'],
      hiddenFromPublishing: false,
      setValueForMode: (mode: string, value: any) => {
        writes++;
        const extension = collections.find(
          (c) => c.isExtension && c.modes.some((m: any) => m.modeId === mode),
        );
        if (extension) {
          extension.variableOverrides[variable.id] ??= {};
          extension.variableOverrides[variable.id][mode] = structuredClone(value);
        } else variable.valuesByMode[mode] = structuredClone(value);
      },
      valuesByModeForCollectionAsync: async (c: any) =>
        c.isExtension
          ? Object.fromEntries(
              c.modes.map((m: any) => [
                m.modeId,
                c.variableOverrides[variable.id]?.[m.modeId] ??
                  variable.valuesByMode[m.parentModeId],
              ]),
            )
          : variable.valuesByMode,
      remove: () => {
        throw new Error('Deletion is forbidden in this test');
      },
    };
    variables.push(variable);
    collection.variableIds.push(variable.id);
    writes++;
    return variable;
  }
  function createStyle(type: string): any {
    const style: any = {
      ...data(),
      id: id('S'),
      key: id('styleKey'),
      type,
      name: '',
      description: '',
      remote: false,
      boundVariables: {},
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 12,
      lineHeight: { unit: 'AUTO' },
      letterSpacing: { unit: 'PIXELS', value: 0 },
      paragraphSpacing: 0,
      paragraphIndent: 0,
      textCase: 'ORIGINAL',
      textDecoration: 'NONE',
      paints: [],
      effects: [],
      setBoundVariable: (field: string, variable: any) => {
        writes++;
        if (variable) style.boundVariables[field] = { type: 'VARIABLE_ALIAS', id: variable.id };
        else delete style.boundVariables[field];
      },
      remove: () => {
        throw new Error('Deletion is forbidden in this test');
      },
    };
    styles.push(style);
    writes++;
    return style;
  }
  const api = {
    root,
    fileKey: 'test-file',
    commitUndo: () => {},
    variables: {
      getLocalVariableCollectionsAsync: async () => collections,
      getLocalVariablesAsync: async () => variables,
      getVariableByIdAsync: async (vid: string) => variables.find((v) => v.id === vid) ?? null,
      createVariableCollection: createCollection,
      createVariable,
      createVariableAlias: (v: any) => ({ type: 'VARIABLE_ALIAS', id: v.id }),
      setBoundVariableForPaint: (paint: any, field: string, variable: any) => ({
        ...paint,
        boundVariables: {
          ...paint.boundVariables,
          [field]: { type: 'VARIABLE_ALIAS', id: variable.id },
        },
      }),
      setBoundVariableForEffect: (effect: any, field: string, variable: any) => ({
        ...effect,
        boundVariables: {
          ...effect.boundVariables,
          [field]: { type: 'VARIABLE_ALIAS', id: variable.id },
        },
      }),
    },
    getLocalTextStylesAsync: async () => styles.filter((s) => s.type === 'TEXT'),
    getLocalEffectStylesAsync: async () => styles.filter((s) => s.type === 'EFFECT'),
    getLocalPaintStylesAsync: async () => styles.filter((s) => s.type === 'PAINT'),
    createTextStyle: () => createStyle('TEXT'),
    createEffectStyle: () => createStyle('EFFECT'),
    createPaintStyle: () => createStyle('PAINT'),
    listAvailableFontsAsync: async () =>
      ['Regular', 'Bold', 'Semi Bold', 'Italic'].map((style) => ({
        fontName: { family: 'Inter', style },
      })),
    loadFontAsync: async (font: any) => {
      if (options.fontFailure || font.family !== 'Inter') throw new Error('Unavailable');
    },
  } as unknown as PluginAPI;
  const store = new RegistryStore(api.root, api.fileKey),
    adapter = new FigmaAdapter(api, store.identity);
  return {
    api,
    adapter,
    store,
    collections,
    variables,
    styles,
    storage,
    get writes() {
      return writes;
    },
    createCollection,
    createVariable,
    createStyle,
  };
}
