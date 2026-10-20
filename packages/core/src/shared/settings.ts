import { z } from 'zod'
import { builtinId, builtinKey, CREDENTIAL_REF, CUSTOM_CONNECTION_ID, defaultAccess, TEXT_MAX_LENGTH, validateOptions, type AccessMode, type Descriptor } from './connections.ts'
import { isEndpoint } from './url.ts'

// Unversioned documents are permanently the first unified grammar, not the latest release.
export const UNVERSIONED_SETTINGS_VERSION = 2 as const
export const CURRENT_SETTINGS_VERSION = 2 as const
export const SETTINGS_RESET_HINT = 'this release does not read 0.1.x settings; remove the field or use Reset on the settings page'
export const SETTINGS_FIELDS = ['version', 'defaultConnection', 'showSelector', 'defaults', 'connections'] as const

export type DocumentVersion =
  | { readonly kind: 'current' }
  | { readonly kind: 'older'; readonly version: number }
  | { readonly kind: 'newer'; readonly version: number }
  | { readonly kind: 'invalid'; readonly reason: string }

export function documentVersion(document: unknown, currentVersion: number = CURRENT_SETTINGS_VERSION): DocumentVersion {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) return { kind: 'invalid', reason: 'settings must be an object' }
  const storedVersion = (document as Record<string, unknown>).version
  const version = storedVersion === undefined ? UNVERSIONED_SETTINGS_VERSION : storedVersion
  if (version === currentVersion) return { kind: 'current' }
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) return { kind: 'invalid', reason: 'settings.version must be a positive integer' }
  return { kind: version < currentVersion ? 'older' : 'newer', version }
}

export type SettingsMigration = (document: Readonly<Record<string, unknown>>) => Record<string, unknown>
export interface SettingsMigrations {
  readonly currentVersion: number
  readonly steps: ReadonlyMap<number, SettingsMigration>
}
// Add only this grammar's future N → N+1 steps; predecessor formats have no steps.
export const SETTINGS_MIGRATIONS: SettingsMigrations = { currentVersion: CURRENT_SETTINGS_VERSION, steps: new Map() }

/** Pure upgrade pipeline. Never guesses a predecessor's schema or rewrites its fields. */
export function migrateDocument(document: unknown, migrations: SettingsMigrations = SETTINGS_MIGRATIONS): Record<string, unknown> {
  validateDocumentBounds(document)
  const state = documentVersion(document, migrations.currentVersion)
  if (state.kind === 'invalid') throw new Error(state.reason)
  if (state.kind === 'newer') throw new Error('settings.version is newer than supported; upgrade the plugin')
  let result = structuredClone(document) as Record<string, unknown>
  if (state.kind === 'older') {
    for (let version = state.version; version < migrations.currentVersion; version += 1) {
      const migrate = migrations.steps.get(version)
      if (migrate === undefined) throw new Error('settings.version: no migration from version ' + version + '; ' + SETTINGS_RESET_HINT)
      result = { ...migrate(result), version: version + 1 }
      validateDocumentBounds(result)
    }
  }
  return result
}

const text = z.string().trim().min(1).max(TEXT_MAX_LENGTH)
const label = z.string().trim().min(1).max(200)
const credentialRef = text.regex(CREDENTIAL_REF, 'must be a credential reference such as EXA_API_KEY')
const endpoint = text.refine(isEndpoint, 'must be an absolute http(s) URL without credentials, query or fragment')
const options = z.record(z.string(), z.unknown())

export function documentSchema<S extends z.ZodRawShape>(defaults: z.ZodObject<S>, currentVersion: number = CURRENT_SETTINGS_VERSION) {
  return z.strictObject({
    version: z.literal(currentVersion).optional(),
    defaultConnection: z.string().min(1).max(200).optional(),
    showSelector: z.boolean().optional(),
    defaults: defaults.optional(),
    connections: z.record(z.string().max(200), z.unknown()).refine(value => Object.keys(value).length <= 200, 'must contain at most 200 connections').optional(),
  })
}

export const builtinOverrideSchema = z.strictObject({
  label: label.optional(), disabled: z.boolean().optional(),
  access: z.enum(['keyless', 'api-key']).optional(), credentialRef: credentialRef.optional(),
  trustedEndpoint: z.boolean().optional(), options: options.optional(),
})
export interface BuiltinOverride {
  label?: string
  disabled?: boolean
  access?: AccessMode
  credentialRef?: string
  trustedEndpoint?: boolean
  options?: Record<string, unknown>
}

/** A persisted operator-defined connection; its grammar is customConnectionSchema, and a test keeps the two identical. */
export interface CustomConnection<A extends string = string> {
  readonly kind: 'adapter'
  readonly adapter: A
  readonly label: string
  readonly credentialRef: string
  readonly endpoint?: string | undefined
  readonly trustedEndpoint?: boolean | undefined
  readonly disabled?: boolean | undefined
  readonly options?: Record<string, unknown> | undefined
}

export function customConnectionSchema(adapterKeys: readonly string[]) {
  return z.strictObject({
    kind: z.literal('adapter'), adapter: z.enum(adapterKeys), label, credentialRef,
    endpoint: endpoint.optional(), trustedEndpoint: z.boolean().optional(),
    disabled: z.boolean().optional(), options: options.optional(),
  })
}

interface CommonConnection {
  readonly id: string
  readonly label: string
  readonly disabled: boolean
  readonly remote: boolean
  readonly trustedEndpoint: boolean
  readonly options: Readonly<Record<string, unknown>>
  readonly catalogKey: string
}
export type ResolvedBase = CommonConnection & (
  | { readonly kind: 'local'; readonly access: 'keyless' }
  | { readonly kind: 'native' | 'adapter'; readonly access: AccessMode; readonly credentialRef: string; readonly endpoint: string }
)
export interface ResolvedDocument<D, C = ResolvedBase> {
  readonly version: number
  readonly defaultConnection: string
  readonly showSelector: boolean
  readonly defaults: D
  readonly connections: ReadonlyMap<string, C>
}
export type SettingsDescriptor = Descriptor & { readonly endpoint?: string }

/** Resolve the identical document and connection grammar for Host and browser. */
export function resolveDocument<S extends z.ZodRawShape>({ catalog, document, defaults, capabilityLabel, retiredFields = [], migrations = SETTINGS_MIGRATIONS }: {
  readonly catalog: Readonly<Record<string, SettingsDescriptor>>
  readonly document: unknown
  readonly defaults: { readonly schema: z.ZodObject<S>; readonly defaultConnection: string }
  readonly capabilityLabel: string
  readonly retiredFields?: readonly string[]
  readonly migrations?: SettingsMigrations
}): ResolvedDocument<z.output<z.ZodObject<S>>> {
  const fail = (path: string, message: string): never => { throw new Error('invalid ' + capabilityLabel + ' settings: ' + path + ': ' + message) }
  const parse = <T>(schema: z.ZodType<T>, value: unknown, path: string): T => {
    const result = schema.safeParse(value)
    if (result.success) return result.data
    const issues = result.error.issues.map(issue => {
      const field = [path, ...issue.path.map(String)].join('.')
      const retired = issue.code === 'unrecognized_keys' && path === 'settings' && issue.path.length === 0
        ? issue.keys.filter(key => retiredFields.includes(key)) : []
      const retirement = retired.map(key => key + ' is a 0.1.x setting this release does not read; remove it or use Reset')
      return field + ': ' + [...retirement, issue.message].join('; ') + (issue.code === 'unrecognized_keys' ? '; ' + SETTINGS_RESET_HINT : '')
    })
    return fail(path, issues.join('; '))
  }
  const settings = parse(documentSchema(defaults.schema, migrations.currentVersion), migrateDocument(document, migrations), 'settings')
  const overrides = settings.connections ?? {}
  const adapterKeys = Object.keys(catalog).filter(key => catalog[key]!.kind === 'adapter')
  const customSchema = customConnectionSchema(adapterKeys)
  const connections = new Map<string, ResolvedBase>()
  const rejectId = (id: string, path: string): never => fail(path, 'unknown connection id "' + id + '"; ' + SETTINGS_RESET_HINT)
  const resolve = (id: string, key: string, override: z.infer<typeof builtinOverrideSchema>, customEndpoint?: string): ResolvedBase => {
    const info = catalog[key]!
    const path = 'connections.' + id
    const access = override.access ?? defaultAccess(info.access)
    if (access === 'keyless' && !info.access.keyless) fail(path + '.access', 'no keyless access')
    if (access === 'api-key' && !info.access.apiKey) fail(path + '.access', 'no API-key access')
    if (override.credentialRef !== undefined && !info.access.apiKey) fail(path + '.credentialRef', 'this connection does not accept credentials')
    const values = override.options ?? {}
    const problems = validateOptions(info.label, info.options, values, access)
    if (problems.length > 0) fail(path + '.options', problems.join('; ') + '; ' + SETTINGS_RESET_HINT)
    const trustedEndpoint = override.trustedEndpoint ?? false
    for (const [name, rule] of Object.entries(info.options)) {
      if (rule.kind === 'url' && values[name] !== undefined && values[name] !== info.endpoint && !trustedEndpoint) {
        fail(path + '.trustedEndpoint', 'a non-official ' + name + ' needs trustedEndpoint: true')
      }
    }
    const base = { id, catalogKey: key, label: override.label ?? info.label, disabled: override.disabled ?? false, remote: info.remote, trustedEndpoint, options: values }
    if (info.kind === 'local') return { ...base, kind: 'local', access: 'keyless' }
    if (info.kind !== 'native' && info.kind !== 'adapter') return fail(path + '.kind', 'unsupported catalog kind')
    if (!info.access.apiKey || info.endpoint === undefined) return fail(path, 'remote catalog entry needs credentials and an endpoint')
    const url = customEndpoint ?? info.endpoint
    if (url !== info.endpoint && !trustedEndpoint) fail(path + '.trustedEndpoint', 'a custom endpoint needs trustedEndpoint: true')
    return { ...base, kind: info.kind, access, credentialRef: override.credentialRef ?? info.access.apiKey.credentialRef, endpoint: url }
  }
  for (const key of Object.keys(catalog)) {
    const id = builtinId(key)
    const override = overrides[id] === undefined ? {} : parse(builtinOverrideSchema, overrides[id], 'connections.' + id)
    connections.set(id, resolve(id, key, override))
  }
  for (const [id, raw] of Object.entries(overrides)) {
    if (connections.has(id)) continue
    // A custom connection takes its format from an adapter entry; a catalog without one has no custom connections.
    if (adapterKeys.length === 0 || !CUSTOM_CONNECTION_ID.test(id) || builtinKey(id) !== undefined) rejectId(id, 'connections.' + id)
    const custom = parse(customSchema, raw, 'connections.' + id)
    connections.set(id, resolve(id, custom.adapter, { ...custom, access: 'api-key' }, custom.endpoint))
  }
  const defaultConnection = settings.defaultConnection ?? defaults.defaultConnection
  if (!connections.has(defaultConnection)) rejectId(defaultConnection, 'defaultConnection')
  return { version: migrations.currentVersion, defaultConnection, showSelector: settings.showSelector ?? true, defaults: settings.defaults ?? parse(defaults.schema, {}, 'defaults'), connections }
}

/** Bound traversal and cloning before parsing even unknown fields. */
function validateDocumentBounds(value: unknown): void {
  const pending = [{ value, path: 'settings', depth: 0 }]
  const visited = new Set<object>()
  let nodes = 1
  while (pending.length > 0) {
    const current = pending.pop()!
    if (typeof current.value === 'string' && current.value.length > TEXT_MAX_LENGTH) throw new Error(current.path + ': text must contain at most ' + TEXT_MAX_LENGTH + ' characters')
    if (current.value === null || typeof current.value !== 'object') continue
    if (current.depth > 20) throw new Error(current.path + ': settings depth exceeds 20')
    if (visited.has(current.value)) continue
    visited.add(current.value)
    if (Array.isArray(current.value) && current.value.length > 200) throw new Error(current.path + ': must contain at most 200 entries')
    let entries = 0
    for (const key in current.value) {
      if (!Object.hasOwn(current.value, key)) continue
      entries += 1
      if (entries > 200) throw new Error(current.path + ': must contain at most 200 entries')
      if (key.length > TEXT_MAX_LENGTH) throw new Error(current.path + ': key must contain at most ' + TEXT_MAX_LENGTH + ' characters')
      const path = current.path + '.' + key
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error(path + ': unsafe key; ' + SETTINGS_RESET_HINT)
      nodes += 1
      if (nodes > 100_000) throw new Error('settings: node budget exceeds 100000')
      pending.push({ value: (current.value as Record<string, unknown>)[key], path, depth: current.depth + 1 })
    }
  }
}
