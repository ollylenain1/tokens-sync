import {
  DesiredModel,
  DesiredStyle,
  DocumentState,
  StyleData,
  StyleState,
  SyncError,
  VariableType,
  tick,
} from '../core/model';
import { getAt, setAt } from '../core/desired';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const pick = (source: any, fields: string[]) =>
  Object.fromEntries(
    fields.filter((key) => source[key] !== undefined).map((key) => [key, copy(source[key])]),
  );
export function styleState(style: BaseStyle): StyleState {
  const bindings: Record<string, string> = {};
  let data: StyleData;
  if (style.type === 'TEXT') {
    data = pick(style, [
      'fontName',
      'fontSize',
      'lineHeight',
      'letterSpacing',
      'paragraphSpacing',
      'paragraphIndent',
      'textCase',
      'textDecoration',
    ]);
    const map: Record<string, string> = {
      fontFamily: 'fontName.family',
      fontStyle: 'fontName.style',
      fontWeight: 'fontWeight',
      fontSize: 'fontSize',
      lineHeight: 'lineHeight.value',
      letterSpacing: 'letterSpacing.value',
      paragraphSpacing: 'paragraphSpacing',
      paragraphIndent: 'paragraphIndent',
    };
    for (const [field, binding] of Object.entries(style.boundVariables ?? {}))
      if (binding) bindings[map[field] ?? field] = binding.id;
  } else if (style.type === 'EFFECT') {
    data = {
      effects: style.effects.map((effect, i) => {
        const map: Record<string, string> = {
          color: 'color',
          radius: 'radius',
          spread: 'spread',
          offsetX: 'offset.x',
          offsetY: 'offset.y',
        };
        for (const [field, binding] of Object.entries(
          ('boundVariables' in effect ? (effect.boundVariables ?? {}) : {}) as Record<
            string,
            VariableAlias
          >,
        ))
          if (binding) bindings[`effects.${i}.${map[field] ?? field}`] = binding.id;
        return pick(effect, [
          'type',
          'color',
          'offset',
          'radius',
          'spread',
          'visible',
          'blendMode',
          'showShadowBehindNode',
          'blurType',
        ]);
      }),
    };
  } else if (style.type === 'PAINT') {
    data = {
      paints: style.paints.map((paint, i) => {
        if (paint.type === 'SOLID' && paint.boundVariables?.color)
          bindings[`paints.${i}.color`] = paint.boundVariables.color.id;
        const result = pick(paint, ['type', 'color', 'opacity', 'gradientTransform']);
        if ('gradientStops' in paint)
          result.gradientStops = paint.gradientStops.map((stop, j) => {
            if (stop.boundVariables?.color)
              bindings[`paints.${i}.gradientStops.${j}.color`] = stop.boundVariables.color.id;
            return { color: copy(stop.color), position: stop.position };
          });
        return result;
      }),
    };
  } else throw new SyncError('STYLE', 'Unsupported local style type.');
  return {
    id: style.id,
    key: style.key,
    name: style.name,
    kind: style.type,
    data,
    bindings,
    description: style.description,
  };
}
export class FigmaAdapter {
  collections = new Map<string, VariableCollection>();
  variables = new Map<string, Variable>();
  styles = new Map<string, TextStyle | EffectStyle | PaintStyle>();
  private fonts?: Font[];
  constructor(
    readonly api: PluginAPI,
    readonly identity: string,
  ) {}
  async snapshot(): Promise<DocumentState> {
    const [collections, variables, text, effect, paint] = await Promise.all([
      this.api.variables.getLocalVariableCollectionsAsync(),
      this.api.variables.getLocalVariablesAsync(),
      this.api.getLocalTextStylesAsync(),
      this.api.getLocalEffectStylesAsync(),
      this.api.getLocalPaintStylesAsync(),
    ]);
    this.collections = new Map(collections.filter((c) => !c.remote).map((c) => [c.id, c]));
    this.variables = new Map(
      variables
        .filter(
          (v) => !v.remote && ['COLOR', 'FLOAT', 'STRING', 'BOOLEAN'].includes(v.resolvedType),
        )
        .map((v) => [v.id, v]),
    );
    this.styles = new Map(
      [...text, ...effect, ...paint].filter((s) => !s.remote).map((s) => [s.id, s]),
    );
    const states = [...this.variables.values()].map((v) => ({
      id: v.id,
      key: v.key,
      name: v.name,
      collectionId: v.variableCollectionId,
      type: v.resolvedType as VariableType,
      values: copy(v.valuesByMode),
      description: v.description,
    }));
    const byId = new Map(states.map((s) => [s.id, s]));
    let work = 0;
    for (const collection of this.collections.values())
      if (collection.isExtension)
        for (const id of collection.variableIds) {
          const variable = this.variables.get(id),
            state = byId.get(id);
          if (variable && state && typeof variable.valuesByModeForCollectionAsync === 'function')
            Object.assign(state.values, await variable.valuesByModeForCollectionAsync(collection));
          if (++work % 50 === 0) await tick();
        }
    return {
      identity: this.identity,
      collections: [...this.collections.values()].map((c) => ({
        id: c.id,
        key: c.key,
        name: c.name,
        modes: copy(c.modes),
        variableIds: [...c.variableIds],
        isExtension: !!c.isExtension,
        parentId: c.isExtension
          ? (c as unknown as ExtendedVariableCollection).parentVariableCollectionId
          : undefined,
        overrideModes: c.isExtension
          ? Object.fromEntries(
              Object.entries(
                (c as unknown as ExtendedVariableCollection).variableOverrides ?? {},
              ).map(([id, overrides]) => [id, Object.keys(overrides)]),
            )
          : undefined,
        canExtend: typeof c.extend === 'function',
      })),
      variables: states,
      styles: [...this.styles.values()].map(styleState),
    };
  }
  async prepareFonts(model: DesiredModel): Promise<void> {
    if (!model.styles.some((s) => s.kind === 'TEXT')) return;
    // Availability can change while the plugin remains open (font install/helper reconnect).
    this.fonts = await this.api.listAvailableFontsAsync();
    const normalize = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '');
    for (const style of model.styles)
      if (style.kind === 'TEXT') {
        for (const required of style.requiredFonts ?? [style.data.fontName as FontName]) {
          const matches = this.fonts.filter(
            (f) =>
              f.fontName.family === required.family &&
              normalize(f.fontName.style) === normalize(required.style),
          );
          if (matches.length !== 1)
            model.diagnostics.push({
              level: 'error',
              code: 'MISSING_FONT',
              token: style.path,
              theme: style.theme,
              message: `Font unavailable or ambiguous: ${required.family} / ${required.style}. Install the exact font; no substitute will be used.`,
            });
          else if (
            (style.data.fontName as FontName).family === required.family &&
            (style.data.fontName as FontName).style === required.style
          )
            style.data.fontName = copy(matches[0].fontName);
        }
      }
  }
  async loadFonts(styles: DesiredStyle[]): Promise<Set<string>> {
    const failed = new Set<string>(),
      loaded = new Map<string, boolean>();
    for (const style of styles)
      if (style.kind === 'TEXT') {
        for (const font of [style.data.fontName as FontName, ...(style.requiredFonts ?? [])]) {
          const normalized =
            this.fonts?.find(
              (f) =>
                f.fontName.family === font.family &&
                f.fontName.style.toLowerCase().replace(/[\s_-]/g, '') ===
                  font.style.toLowerCase().replace(/[\s_-]/g, ''),
            )?.fontName ?? font;
          const key = JSON.stringify(normalized);
          if (!loaded.has(key))
            try {
              await this.api.loadFontAsync(normalized);
              loaded.set(key, true);
            } catch {
              loaded.set(key, false);
            }
          if (!loaded.get(key)) failed.add(style.key);
        }
      }
    return failed;
  }
  createCollection(name: string, parentId?: string): VariableCollection {
    let collection: VariableCollection;
    if (parentId) {
      const parent = this.collections.get(parentId);
      if (!parent || typeof parent.extend !== 'function')
        throw new SyncError(
          'EXTENSION_API',
          'Extended collections are unavailable. Clear the parent setting and use a regular collection.',
        );
      try {
        collection = parent.extend(name) as unknown as VariableCollection;
      } catch {
        throw new SyncError(
          'EXTENSION_PLAN',
          'Figma could not create this extension. It requires an Enterprise plan and an eligible local parent. Clear the parent setting to use a regular collection.',
        );
      }
    } else collection = this.api.variables.createVariableCollection(name);
    this.collections.set(collection.id, collection);
    return collection;
  }
  createVariable(
    name: string,
    collection: VariableCollection,
    type: VariableResolvedDataType,
  ): Variable {
    const variable = this.api.variables.createVariable(name, collection, type);
    this.variables.set(variable.id, variable);
    return variable;
  }
  createStyle(kind: DesiredStyle['kind']): TextStyle | EffectStyle | PaintStyle {
    const style =
      kind === 'TEXT'
        ? this.api.createTextStyle()
        : kind === 'EFFECT'
          ? this.api.createEffectStyle()
          : this.api.createPaintStyle();
    this.styles.set(style.id, style);
    return style;
  }
  async writeStyle(
    target: TextStyle | EffectStyle | PaintStyle,
    desired: DesiredStyle,
    bindings: Record<string, string>,
    preserveMetadata: boolean,
  ): Promise<void> {
    const data = copy(desired.data);
    const bound = new Map<string, Variable>();
    for (const [field, id] of Object.entries(bindings)) {
      const variable =
        this.variables.get(id) ?? (await this.api.variables.getVariableByIdAsync(id));
      if (!variable)
        throw new SyncError(
          'BINDING',
          'A style variable binding became unavailable. Fetch a fresh preview.',
        );
      bound.set(field, variable);
    }
    if (target.type === 'TEXT') {
      const fields: Record<string, VariableBindableTextField> = {
        'fontName.family': 'fontFamily',
        'fontName.style': 'fontStyle',
        fontWeight: 'fontWeight',
        fontSize: 'fontSize',
        'lineHeight.value': 'lineHeight',
        'letterSpacing.value': 'letterSpacing',
        paragraphSpacing: 'paragraphSpacing',
        paragraphIndent: 'paragraphIndent',
      };
      for (const field of Object.keys(target.boundVariables ?? {}))
        target.setBoundVariable(field as VariableBindableTextField, null);
      Object.assign(target, data);
      for (const [path, variable] of bound) {
        if (!fields[path])
          throw new SyncError(
            'BINDING_FIELD',
            'An existing text binding cannot be preserved by this API.',
          );
        target.setBoundVariable(fields[path], variable);
      }
    } else if (target.type === 'EFFECT') {
      const effects = data.effects as Effect[];
      for (const [path, variable] of bound) {
        const [, index, ...tail] = path.split('.'),
          field = tail.join('.');
        const map: Record<string, VariableBindableEffectField> = {
          color: 'color',
          radius: 'radius',
          spread: 'spread',
          'offset.x': 'offsetX',
          'offset.y': 'offsetY',
        };
        if (!effects[Number(index)] || !map[field])
          throw new SyncError(
            'BINDING_FIELD',
            'An existing effect binding no longer has a compatible effect. Disable binding preservation only after reviewing this change.',
          );
        effects[Number(index)] = this.api.variables.setBoundVariableForEffect(
          effects[Number(index)],
          map[field],
          variable,
        );
      }
      target.effects = effects;
    } else {
      const paints = data.paints as Paint[];
      for (const [path, variable] of bound) {
        const parts = path.split('.'),
          index = Number(parts[1]),
          paint = paints[index];
        if (!paint)
          throw new SyncError('BINDING_FIELD', 'A paint binding no longer has a compatible paint.');
        if (paint.type === 'SOLID' && parts[2] === 'color')
          paints[index] = this.api.variables.setBoundVariableForPaint(paint, 'color', variable);
        else if ('gradientStops' in paint && parts[2] === 'gradientStops') {
          const stops = copy(paint.gradientStops) as ColorStop[],
            stop = Number(parts[3]);
          if (!stops[stop])
            throw new SyncError(
              'BINDING_FIELD',
              'A gradient stop binding no longer has a compatible stop.',
            );
          stops[stop] = {
            ...stops[stop],
            boundVariables: { color: this.api.variables.createVariableAlias(variable) },
          };
          paints[index] = { ...paint, gradientStops: stops };
        } else throw new SyncError('BINDING_FIELD', 'Unsupported paint binding.');
      }
      target.paints = paints;
    }
    target.name = desired.name;
    if (!preserveMetadata) target.description = desired.description ?? '';
  }
}
