/**
 * Sparse settings writes. The catalog supplies every default, so a write
 * stores only what differs from the inherited (composition) layer, and
 * returning a value to its inherited state removes the user entry instead of
 * materializing it.
 */
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { documentVersion as inspectDocumentVersion, type DocumentVersion } from '../../shared/settings.ts'
export type { DocumentVersion } from '../../shared/settings.ts'


/** The two layers of a ConfigForm snapshot. */
export interface SettingsLayers {
  readonly base?: unknown
  readonly user?: unknown
}

type Settable = Extract<SettingsPathOpView, { op: 'set' }>['value']
type Json = Record<string, unknown>

const objectOf = (value: unknown): Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}

const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value)

function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => equal(value, b[index]))
  }
  if (!isObject(a) || !isObject(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]))
}

/** Remove what an object value shares with its inherited counterpart, key by key. */
function delta(value: unknown, inherited: unknown): unknown {
  if (equal(value, inherited)) return undefined
  if (!isObject(value)) return value
  const base = objectOf(inherited)
  return Object.fromEntries(Object.entries(value)
    .map(([key, child]) => [key, delta(child, base[key])] as const)
    .filter(([, child]) => child !== undefined))
}

function documentVersion(layers: SettingsLayers): DocumentVersion {
  return inspectDocumentVersion({ ...objectOf(layers.base), ...objectOf(layers.user) })
}

function assertCurrentVersion(layers: SettingsLayers): void {
  const state = documentVersion(layers)
  if (state.kind !== 'current') throw new Error('settings document version is ' + state.kind)
}

/**
 * Operations that make `path` hold `target`, touching only that path.
 * @param fallback - the catalog default used when the base layer has no value.
 * @param target - the desired effective value; undefined returns the path to its inherited value.
 */
function sparseSettingOperations(spec: SparseSettingsSpec, layers: SettingsLayers, path: readonly string[], target: unknown, fallback?: unknown): SettingsPathOpView[] {
  assertCurrentVersion(layers)
  const inherited = valueAt(layers.base, path) ?? fallback
  const user = valueAt(layers.user, path)
  const ops: SettingsPathOpView[] = []
  if (target === undefined || equal(target, inherited)) {
    if (user !== undefined) ops.push({ op: 'unset', path: prunedPath(layers.user, path) })
  } else {
    const sparse = delta(target, inherited)
    if (!equal(sparse, user)) ops.push({ op: 'set', path: [...path], value: sparse as Settable })
  }
  if (ops.some(op => op.op === 'set') && objectOf(layers.user).version !== spec.version) {
    ops.push({ op: 'set', path: ['version'], value: spec.version })
  }
  return ops
}

function valueAt(root: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((value, key) => objectOf(value)[key], root)
}

/**
 * The path to unset so no empty object stays behind: removing the only key of
 * a user-layer object removes that object instead, up to a top-level field.
 */
function prunedPath(user: unknown, path: readonly string[]): string[] {
  let end = path.length
  while (end > 1 && Object.keys(objectOf(valueAt(user, path.slice(0, end - 1)))).length === 1) end -= 1
  return path.slice(0, end)
}



/** Unset every field this plugin stores in the user layer; inherited values and credentials stay. */
function resetSettingsOperations(layers: SettingsLayers): SettingsPathOpView[] {
  return Object.keys(objectOf(layers.user)).map(key => ({ op: 'unset', path: [key] }))
}

export interface SparseSettingsSpec {
  readonly version: number
  readonly fields: readonly string[]
}

/** Bind the current document version and fields; no predecessor schema is inferred. */
export function createSparseSettings(spec: SparseSettingsSpec) {
  return {
    documentVersion: (layers: SettingsLayers) => documentVersion(layers),
    sparseSettingOperations: (layers: SettingsLayers, path: readonly string[], target: unknown, fallback?: unknown) => sparseSettingOperations(spec, layers, path, target, fallback),
    resetSettingsOperations: (layers: SettingsLayers) => resetSettingsOperations(layers),
  }
}
export type SparseSettings = ReturnType<typeof createSparseSettings>
