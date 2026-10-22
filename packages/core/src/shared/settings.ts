import { z } from 'zod'
import { builtinId, builtinKey, CREDENTIAL_REF, CUSTOM_CONNECTION_ID, defaultAccess, TEXT_MAX_LENGTH, validateOptions, type AccessMode, type Descriptor, type ProtocolDescriptor } from './connections.ts'
import { isEndpoint } from './url.ts'

// Unversioned documents are permanently the first unified grammar, not the latest release.
export const UNVERSIONED_SETTINGS_VERSION = 2 as const
export const CURRENT_SETTINGS_VERSION = 2 as const
export const SETTINGS_RESET_HINT = 'this release does not read 0.1.x settings; remove the field or use Reset on the settings page'
export const SETTINGS_FIELDS = ['version', 'defaultConnection', 'showSelector', 'enhancedTools', 'defaults', 'connections'] as const

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

/**
 * Operator text shown as one line (a label in menus, error messages and the
 * Agent's provider list): control characters and line or paragraph separators
 * become spaces, runs of whitespace one space, the ends trimmed.
 */
export function singleLine(value: string): string {
  return value.replaceAll(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replaceAll(/\s+/gu, ' ').trim()
}

const text = z.string().trim().min(1).max(TEXT_MAX_LENGTH)
const label = z.string().transform(singleLine).pipe(z.string().min(1).max(200))
const credentialRef = text.regex(CREDENTIAL_REF, 'must be a credential reference such as EXA_API_KEY')
const endpoint = text.refine(isEndpoint, 'must be an absolute http(s) URL without credentials, query or fragment')
const options = z.record(z.string(), z.unknown())

export function documentSchema<S extends z.ZodRawShape>(defaults: z.ZodObject<S>, currentVersion: number = CURRENT_SETTINGS_VERSION) {
  return z.strictObject({
    version: z.literal(currentVersion).optional(),
    defaultConnection: z.string().min(1).max(200).optional(),
    showSelector: z.boolean().optional(),
    enhancedTools: z.boolean().optional(),
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
export interface CustomAdapterConnection<A extends string = string> {
  readonly kind: 'adapter'
  readonly adapter: A
  readonly label: string
  readonly credentialRef: string
  readonly endpoint?: string | undefined
  readonly trustedEndpoint?: boolean | undefined
  readonly disabled?: boolean | undefined
  readonly options?: Record<string, unknown> | undefined
}

export interface CustomModelConnection<P extends string = string> {
  readonly kind: 'model'
  readonly protocol: P
  readonly model: string
  readonly label: string
  readonly credentialRef: string
  readonly endpoint: string
  readonly trustedEndpoint: true
  readonly disabled?: boolean | undefined
  readonly options?: Record<string, unknown> | undefined
}
export type CustomConnection<A extends string = string, P extends string = string> = CustomAdapterConnection<A> | CustomModelConnection<P>

export function customConnectionSchema<A extends string, P extends string>(adapterKeys: readonly A[], protocolKeys: readonly P[]) {
  const adapterSchema = z.strictObject({
    kind: z.literal('adapter'), adapter: z.enum(adapterKeys), label, credentialRef,
    endpoint: endpoint.optional(), trustedEndpoint: z.boolean().optional(),
    disabled: z.boolean().optional(), options: options.optional(),
  })
  const modelSchema = z.strictObject({
    kind: z.literal('model'), protocol: z.enum(protocolKeys),
    model: z.string().min(1).max(200).regex(/^[^\p{Cc}]+$/u, 'must not contain control characters').trim().min(1),
    label, credentialRef, endpoint, trustedEndpoint: z.literal(true),
    disabled: z.boolean().optional(), options: options.optional(),
  })
  if (adapterKeys.length === 0 && protocolKeys.length === 0) return z.never()
  if (adapterKeys.length === 0) return z.discriminatedUnion('kind', [modelSchema])
  if (protocolKeys.length === 0) return z.discriminatedUnion('kind', [adapterSchema])
  return z.discriminatedUnion('kind', [adapterSchema, modelSchema])
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
export type ResolvedModel<P extends string = string> =
  | { readonly kind: 'session' }
  | { readonly kind: 'fixed'; readonly protocol: P; readonly model: string; readonly endpoint: string; readonly credentialRef: string }
export type ResolvedBase<P extends string = string> = CommonConnection & (
  | { readonly kind: 'local'; readonly access: 'keyless' }
  | { readonly kind: 'model'; readonly route: ResolvedModel<P> }
  | { readonly kind: 'native' | 'adapter'; readonly access: AccessMode; readonly credentialRef: string; readonly endpoint: string }
)
export interface ResolvedDocument<D, C = ResolvedBase> {
  readonly version: number
  readonly defaultConnection: string
  readonly showSelector: boolean
  /** Whether the operator turned on this capability's two enhanced model tools (docs/design.md, "增强工具"). */
  readonly enhancedTools: boolean
  readonly defaults: D
  readonly connections: ReadonlyMap<string, C>
}
export type SettingsDescriptor = Descriptor & { readonly endpoint?: string }

/**
 * Where a resolved connection comes from. A built-in connection without a
 * `disabled` override takes the catalog's `optIn` (remote services start off);
 * an operator-defined one starts enabled (docs/design.md, "远程服务缺省停用").
 */
type ConnectionOrigin =
  | { readonly kind: 'builtin' }
  | { readonly kind: 'custom'; readonly endpoint: string | undefined }

/** Resolve the identical document and connection grammar for Host and browser. */
export function resolveDocument<S extends z.ZodRawShape, P extends string = never>({ catalog, document, defaults, capabilityLabel, protocols, retiredFields = [], migrations = SETTINGS_MIGRATIONS }: {
  readonly catalog: Readonly<Record<string, SettingsDescriptor>>
  readonly protocols?: Readonly<Record<P, ProtocolDescriptor>>
  readonly document: unknown
  readonly defaults: { readonly schema: z.ZodObject<S>; readonly defaultConnection: string }
  readonly capabilityLabel: string
  readonly retiredFields?: readonly string[]
  readonly migrations?: SettingsMigrations
}): ResolvedDocument<z.output<z.ZodObject<S>>, ResolvedBase<P>> {
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
  const protocolKeys = protocols === undefined ? [] : Object.keys(protocols) as P[]
  const customSchema = customConnectionSchema(adapterKeys, protocolKeys)
  const connections = new Map<string, ResolvedBase<P>>()
  const rejectId = (id: string, path: string): never => fail(path, 'unknown connection id "' + id + '"; ' + SETTINGS_RESET_HINT)
  const resolve = (id: string, key: string, override: z.infer<typeof builtinOverrideSchema>, origin: ConnectionOrigin): ResolvedBase<P> => {
    const info = catalog[key]!
    const path = 'connections.' + id
    const access = info.kind === 'model' ? 'api-key' : override.access ?? defaultAccess(info.access)
    if (access === 'keyless' && !info.access.keyless) fail(path + '.access', 'no keyless access')
    if (info.kind !== 'model' && access === 'api-key' && !info.access.apiKey) fail(path + '.access', 'no API-key access')
    if (override.credentialRef !== undefined && !info.access.apiKey) fail(path + '.credentialRef', 'this connection does not accept credentials')
    const values = override.options ?? {}
    const problems = validateOptions(info.label, info.options, values, access, info.exclusive)
    if (problems.length > 0) fail(path + '.options', problems.join('; ') + '; ' + SETTINGS_RESET_HINT)
    const trustedEndpoint = override.trustedEndpoint ?? false
    for (const [name, rule] of Object.entries(info.options)) {
      if (rule.kind === 'url' && values[name] !== undefined && values[name] !== info.endpoint && !trustedEndpoint) {
        fail(path + '.trustedEndpoint', 'a non-official ' + name + ' needs trustedEndpoint: true')
      }
    }
    const disabled = override.disabled ?? (origin.kind === 'builtin' ? info.optIn : false)
    const base = { id, catalogKey: key, label: override.label ?? info.label, disabled, remote: info.remote, trustedEndpoint, options: values }
    if (info.kind === 'model') return { ...base, kind: 'model', route: { kind: 'session' } }
    if (info.kind === 'local') return { ...base, kind: 'local', access: 'keyless' }
    if (info.kind !== 'native' && info.kind !== 'adapter') return fail(path + '.kind', 'unsupported catalog kind')
    if (!info.access.apiKey || info.endpoint === undefined) return fail(path, 'remote catalog entry needs credentials and an endpoint')
    const url = origin.kind === 'custom' && origin.endpoint !== undefined ? origin.endpoint : info.endpoint
    if (url !== info.endpoint && !trustedEndpoint) fail(path + '.trustedEndpoint', 'a custom endpoint needs trustedEndpoint: true')
    return { ...base, kind: info.kind, access, credentialRef: override.credentialRef ?? info.access.apiKey.credentialRef, endpoint: url }
  }
  for (const key of Object.keys(catalog)) {
    const id = builtinId(key)
    const raw = overrides[id]
    if (catalog[key]!.kind === 'model' && raw !== null && typeof raw === 'object') {
      for (const field of ['access', 'credentialRef', 'trustedEndpoint']) {
        if (Object.hasOwn(raw, field)) fail('connections.' + id + '.' + field, 'this connection takes its route from the Session model')
      }
    }
    const override = raw === undefined ? {} : parse(builtinOverrideSchema, raw, 'connections.' + id)
    connections.set(id, resolve(id, key, override, { kind: 'builtin' }))
  }
  for (const [id, raw] of Object.entries(overrides)) {
    if (connections.has(id)) continue
    if ((adapterKeys.length === 0 && protocolKeys.length === 0) || !CUSTOM_CONNECTION_ID.test(id) || builtinKey(id) !== undefined) rejectId(id, 'connections.' + id)
    const path = 'connections.' + id
    const custom = parse(customSchema, raw, path)
    if (custom.kind === 'adapter') {
      connections.set(id, resolve(id, custom.adapter, { ...custom, access: 'api-key' }, { kind: 'custom', endpoint: custom.endpoint }))
    } else {
      const info = protocols![custom.protocol]
      const values = custom.options ?? {}
      const problems = validateOptions(info.label, info.options, values, 'api-key', info.exclusive)
      if (problems.length > 0) fail(path + '.options', problems.join('; ') + '; ' + SETTINGS_RESET_HINT)
      connections.set(id, {
        id, catalogKey: custom.protocol, kind: 'model', label: custom.label, disabled: custom.disabled ?? false,
        remote: true, trustedEndpoint: true, options: values,
        route: { kind: 'fixed', protocol: custom.protocol, model: custom.model, endpoint: custom.endpoint, credentialRef: custom.credentialRef },
      })
    }
  }
  const defaultConnection = settings.defaultConnection ?? defaults.defaultConnection
  if (!connections.has(defaultConnection)) rejectId(defaultConnection, 'defaultConnection')
  return { version: migrations.currentVersion, defaultConnection, showSelector: settings.showSelector ?? true, enhancedTools: settings.enhancedTools ?? false, defaults: settings.defaults ?? parse(defaults.schema, {}, 'defaults'), connections }
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
