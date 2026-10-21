/**
 * Read-only facts a settings page derives from a validated document and its
 * capability's catalog. Everything is keyed by the catalog, so a new catalog
 * entry appears on the page without page code naming it.
 */
import { builtinId, builtinKey, CUSTOM_CONNECTION_ID, type AccessMode, type Descriptor, type ExclusiveOptions, type OptionRule, type ProtocolDescriptor } from '../../shared/connections.ts'
import type { BuiltinOverride, CustomConnection, SettingsDescriptor } from '../../shared/settings.ts'
export type { CustomConnection, CustomAdapterConnection, CustomModelConnection } from '../../shared/settings.ts'
import type { OptionField, OptionGroup } from './fields.ts'

/** A capability catalog; key order is display order. */
export type SettingsCatalog = Readonly<Record<string, SettingsDescriptor>>

/** Catalog keys of adapter entries: the formats a custom connection can use. */
export type AdapterKeyOf<T extends SettingsCatalog> = { [Key in keyof T]: T[Key]['kind'] extends 'adapter' ? Key : never }[keyof T] & string

/** The document fields these helpers read; both capability documents have them. */
export interface CatalogSettings {
  readonly defaultConnection?: string | undefined
  readonly connections?: Readonly<Record<string, unknown>> | undefined
}

export interface Choice { readonly id: string; readonly label: string }

/** Locale keys for one option: its label, an optional placeholder and an optional hint shown below the field. */
export interface OptionCopy<K extends string> { readonly label: K; readonly placeholder?: K; readonly hint?: K }

/** A plugin's copy for the options of one catalog entry. */
export interface OptionCopyTable<K extends string> {
  readonly options: Readonly<Partial<Record<string, OptionCopy<K>>>>
  /** Label of an option that has no copy of its own yet. */
  readonly fallback: K
}

/** The entry of a key taken from the same catalog. */
export function catalogEntry<T extends SettingsCatalog>(catalog: T, key: keyof T & string): SettingsDescriptor {
  const info = catalog[key]
  if (info === undefined) throw new Error('unknown catalog key ' + key)
  return info
}

export function adapterKeys<T extends SettingsCatalog>(catalog: T): AdapterKeyOf<T>[] {
  return Object.entries(catalog).filter(([, info]) => info.kind === 'adapter').map(([key]) => key as AdapterKeyOf<T>)
}

export function builtinOverride(config: CatalogSettings, key: string): BuiltinOverride {
  const stored = config.connections === undefined ? undefined : config.connections[builtinId(key)]
  return stored === undefined ? {} : stored as BuiltinOverride
}

/** Custom connections in document order; the document has passed the capability's validation. */
export function customConnections<A extends string = string, P extends string = string>(config: CatalogSettings): [string, CustomConnection<A, P>][] {
  if (config.connections === undefined) return []
  return Object.entries(config.connections)
    .filter(([id]) => CUSTOM_CONNECTION_ID.test(id))
    .map(([id, connection]) => [id, connection as CustomConnection<A, P>])
}

/**
 * The access an operator configures for a built-in entry: one of its routes,
 * or `none` when the catalog offers neither a keyless nor an API-key route
 * (the entry takes its route and credentials from the Session model).
 */
export type BuiltinAccess = AccessMode | 'none'

/** Built-in connections default to the anonymous route where one exists. */
export function builtinAccess(info: Descriptor, override: BuiltinOverride): BuiltinAccess {
  if (info.access.keyless) return override.access ?? 'keyless'
  return info.access.apiKey ? 'api-key' : 'none'
}

/** The credential a built-in connection resolves on its API-key route, and the catalog's name for it. */
export interface BuiltinCredential {
  readonly ref: string
  readonly catalogRef: string
}

/** Undefined for an entry without an API-key route. */
export function builtinCredential(info: Descriptor, override: BuiltinOverride): BuiltinCredential | undefined {
  if (!info.access.apiKey) return undefined
  const catalogRef = info.access.apiKey.credentialRef
  return { ref: override.credentialRef ?? catalogRef, catalogRef }
}

/** Every credential the page reports on: each catalog entry with API-key access and every custom connection. */
export function credentialRefs(catalog: SettingsCatalog, config: CatalogSettings): string[] {
  const builtin = Object.entries(catalog).flatMap(([key, info]) => {
    const credential = builtinCredential(info, builtinOverride(config, key))
    return credential === undefined ? [] : [credential.ref]
  })
  const custom = customConnections(config).map(([, connection]) => connection.credentialRef)
  return [...new Set([...builtin, ...custom])]
}

/** Connections a default can name: the catalog in order, then custom connections. */
export function connectionChoices<C extends string>(catalog: Readonly<Record<C, SettingsDescriptor>>, config: CatalogSettings, catalogLabel: (key: C) => string): Choice[] {
  return [
    ...(Object.keys(catalog) as C[]).map(key => ({ id: builtinId(key), label: builtinOverride(config, key).label ?? catalogLabel(key) })),
    ...customConnections(config).map(([id, connection]) => ({ id, label: connection.label })),
  ]
}

/** Display name of any connection id; an id that names nothing is shown as is. */
export function connectionName<C extends string>(catalog: Readonly<Record<C, SettingsDescriptor>>, config: CatalogSettings, id: string, catalogLabel: (key: C) => string): string {
  const key = builtinKey(id)
  if (key !== undefined && Object.hasOwn(catalog, key)) return builtinOverride(config, key).label ?? catalogLabel(key as C)
  const custom = customConnections(config).find(([candidate]) => candidate === id)
  return custom === undefined ? id : custom[1].label
}

/**
 * Editable fields for a catalog entry's option rules. The keyless route drops
 * options it rejects and narrows enums it limits; `restricted` reports either.
 * A list option is edited one item per line; a plugin editor that owns it
 * (`ExtraEditor.options`) takes it over.
 */
export function catalogFields<K extends string>(rules: Readonly<Record<string, OptionRule>>, access: AccessMode, copy: OptionCopyTable<K>, exclusive: readonly ExclusiveOptions[] = []): { fields: OptionField<K>[]; restricted: boolean } {
  const fields: OptionField<K>[] = []
  let restricted = false
  for (const [name, rule] of Object.entries(rules)) {
    const scope: KeylessScope = access === 'keyless' ? keylessScope(rule) : { kind: 'all' }
    if (scope.kind === 'none') {
      restricted = true
      continue
    }
    let values: readonly string[] = []
    if (rule.kind === 'enum') {
      values = scope.kind === 'values' ? scope.values : rule.values
      if (values.length < rule.values.length) restricted = true
    }
    const optionCopy = copy.options[name]
    const placeholder = optionCopy === undefined ? undefined : optionCopy.placeholder
    fields.push({
      name,
      label: optionCopy === undefined ? copy.fallback : optionCopy.label,
      kind: rule.kind,
      values,
      placeholder: t => placeholder === undefined ? undefined : t(placeholder),
      ...(optionCopy?.hint === undefined ? {} : { hint: optionCopy.hint }),
      ...(rule.kind === 'text' ? { pattern: rule.pattern } : {}),
      ...(rule.kind === 'integer' ? { min: rule.min, max: rule.max } : {}),
      ...(rule.kind === 'list' ? { pattern: rule.pattern, maxItems: rule.max } : {}),
      ...exclusiveWith(name, exclusive),
    })
  }
  return { fields, restricted }
}

/**
 * The options of several protocols, grouped by the protocols that apply them:
 * one group per distinct set, in order of first appearance, titled with those
 * protocols' labels. An entry that takes every protocol's options (one that
 * follows the Session model) shows which apply where.
 */
export function protocolGroups(protocols: Readonly<Record<string, ProtocolDescriptor>>): OptionGroup[] {
  const entries = Object.values(protocols)
  const groups = new Map<string, { title: string; options: string[] }>()
  for (const option of new Set(entries.flatMap(entry => Object.keys(entry.options)))) {
    const title = entries.filter(entry => Object.hasOwn(entry.options, option)).map(entry => entry.label).join(' / ')
    const group = groups.get(title)
    if (group === undefined) groups.set(title, { title, options: [option] })
    else group.options.push(option)
  }
  return [...groups.values()]
}

/** The options an option is declared exclusive with; nothing when it has none. */
function exclusiveWith(name: string, exclusive: readonly ExclusiveOptions[]): { exclusive?: readonly string[] } {
  const others = exclusive.flatMap(([first, second]) => first === name ? [second] : second === name ? [first] : [])
  return others.length === 0 ? {} : { exclusive: others }
}

/** What the keyless route accepts of one option: all of it, nothing, or only some enum values. */
type KeylessScope = { readonly kind: 'all' } | { readonly kind: 'none' } | { readonly kind: 'values'; readonly values: readonly string[] }

function keylessScope(rule: OptionRule): KeylessScope {
  if (rule.kind === 'list' || rule.keyless === undefined) return { kind: 'all' }
  if (rule.keyless === false) return { kind: 'none' }
  return { kind: 'values', values: rule.keyless }
}

/** Names of stored options the keyless route rejects, by the rule {@link catalogFields} applies. */
export function keylessRejected(rules: Readonly<Record<string, OptionRule>>, stored: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(stored).filter(name => {
    const rule = Object.hasOwn(rules, name) ? rules[name] : undefined
    if (rule === undefined) return false
    const scope = keylessScope(rule)
    return scope.kind === 'none' || (scope.kind === 'values' && !scope.values.some(value => value === stored[name]))
  })
}
