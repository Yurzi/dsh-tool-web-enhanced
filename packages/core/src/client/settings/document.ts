import { useEffect, useMemo, useRef, useState } from 'react'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsDocumentSnapshot } from './secret-diagnostics.ts'
import { CURRENT_SETTINGS_VERSION, SETTINGS_MIGRATIONS, documentVersion, migrateDocument, type SettingsMigrations } from '../../shared/settings.ts'
import { applyOps, SettingsValidationError, type WriteSettings } from './parts.tsx'
import type { SettingsLayers } from './sparse.ts'

type Document = Record<string, unknown>
type ResolveSettings = (document: unknown) => unknown
type Mutate = (operations: SettingsPathOpView[], revision: number) => Promise<boolean>

export type SettingsDocumentView<S> =
  | { readonly kind: 'ready'; readonly config: S; readonly layers: SettingsLayers; readonly needsWriteback: boolean }
  | { readonly kind: 'invalid'; readonly diagnostic: string; readonly layers: SettingsLayers; readonly needsWriteback: false }

/** ConfigForm.value is schema-projected; the raw layers retain unknown fields for validation. */
export function effectiveDocument(snapshot: SettingsLayers): Document {
  return merge(snapshot.base, snapshot.user)
}

/** Validate before exposing normal editors; only successful older migrations need writeback. */
export function editableSettings<S>(raw: unknown, layers: SettingsLayers, writable: boolean, resolve: ResolveSettings, migrations: SettingsMigrations = SETTINGS_MIGRATIONS): SettingsDocumentView<S> {
  try {
    const version = documentVersion(raw, migrations.currentVersion)
    const config = migrateDocument(raw, migrations)
    resolve(config)
    return { kind: 'ready', config: config as S, layers, needsWriteback: writable && version.kind === 'older' }
  } catch (error) {
    return { kind: 'invalid', diagnostic: diagnostic(error), layers, needsWriteback: false }
  }
}

/** Check the exact recursively overlaid candidate that the settings store will persist. */
export function settingsOperations(layers: SettingsLayers, operations: readonly SettingsPathOpView[], resolve: ResolveSettings): SettingsPathOpView[] {
  try {
    const candidate = effectiveDocument({ base: layers.base, user: applyOps(layers.user, operations) })
    const result = [...operations]
    if (result.some(op => op.op === 'set') && candidate.version === undefined) {
      result.push({ op: 'set', path: ['version'], value: CURRENT_SETTINGS_VERSION })
      candidate.version = CURRENT_SETTINGS_VERSION
    }
    resolve(candidate)
    return result
  } catch (error) {
    throw new SettingsValidationError(diagnostic(error))
  }
}

/**
 * Share validation, revision fencing and automatic future migrations between both pages.
 * @param snapshot - the settings snapshot the page renders.
 * @param read - the settings snapshot now, which a write the form accepted has already updated.
 */
export function useSettingsDocument<S>(snapshot: SettingsDocumentSnapshot<S>, read: () => SettingsDocumentSnapshot<S>, resolve: ResolveSettings, mutate: Mutate, migrations: SettingsMigrations = SETTINGS_MIGRATIONS) {
  const view = useMemo((): SettingsDocumentView<S> | undefined => {
    if (snapshot.status === 'unavailable' || snapshot.value === undefined || snapshot.revision === undefined) return undefined
    const result = editableSettings<S>(effectiveDocument(snapshot), { base: snapshot.base, user: snapshot.user }, snapshot.writable, resolve, migrations)
    if (snapshot.diagnostic === undefined) return result
    return { kind: 'invalid', layers: result.layers, needsWriteback: false,
      diagnostic: result.kind === 'invalid' ? result.diagnostic + '; ' + snapshot.diagnostic : snapshot.diagnostic }
  }, [snapshot, resolve, migrations])
  const attemptedRevision = useRef<number | undefined>(undefined)
  const [failure, setFailure] = useState<{ revision: number; diagnostic: string }>()
  const revision = snapshot.revision

  useEffect(() => {
    if (view?.kind !== 'ready' || !view.needsWriteback || revision === undefined || attemptedRevision.current === revision) return
    attemptedRevision.current = revision
    const writeback = async () => {
      try {
        const operations = replaceDocumentOperations(view.layers.user, view.config as Document)
        await mutate(settingsOperations(view.layers, operations, resolve), revision)
      } catch (error) {
        setFailure({ revision, diagnostic: diagnostic(error) })
      }
    }
    void writeback()
  }, [view, revision, resolve, mutate])

  // Sections write independently; one at a time, each on what the one before it left.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const submit = async (change: Parameters<WriteSettings>[0], displayedRevision: number | undefined): Promise<boolean> => {
    if (typeof change !== 'function') {
      if (change.length === 0) return true
      if (view === undefined || !snapshot.writable || displayedRevision === undefined) return false
      return mutate(settingsOperations(view.layers, change, resolve), displayedRevision)
    }
    const current = read()
    if (current.status !== 'ready' || !current.writable || current.revision === undefined) return false
    const layers = { base: current.base, user: current.user }
    const operations = change(layers)
    if (operations.length === 0) return true
    return mutate(settingsOperations(layers, operations, resolve), current.revision)
  }
  const write: WriteSettings = (change, expectedRevision = revision) => {
    const task = queue.current.then(() => submit(change, expectedRevision))
    queue.current = task.then(() => {}, () => {})
    return task
  }
  return { view, write, migrationError: failure?.revision === revision ? failure?.diagnostic : undefined }
}

function replaceDocumentOperations(user: unknown, document: Document): SettingsPathOpView[] {
  const operations: SettingsPathOpView[] = Object.keys(objectOf(user))
    .filter(key => !Object.hasOwn(document, key))
    .map(key => ({ op: 'unset', path: [key] }))
  for (const [key, value] of Object.entries(document)) {
    operations.push({ op: 'set', path: [key], value: value as Extract<SettingsPathOpView, { op: 'set' }>['value'] })
  }
  return operations
}

function diagnostic(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isObject(value: unknown): value is Document {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function objectOf(value: unknown): Document {
  return isObject(value) ? value : {}
}

function merge(base: unknown, user: unknown): Document {
  const result = { ...objectOf(base) }
  for (const [key, value] of Object.entries(objectOf(user))) {
    Object.defineProperty(result, key, { value: isObject(value) && isObject(result[key]) ? merge(result[key], value) : value, enumerable: true, writable: true, configurable: true })
  }
  return result
}
