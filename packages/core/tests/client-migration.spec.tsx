// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { z } from 'zod'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { resolveDocument, type SettingsMigrations } from '../src/shared/settings.ts'
import { editableSettings, useSettingsDocument } from '../src/client/settings/document.ts'
import { applyOps } from '../src/client/settings/parts.tsx'
import type { SettingsDocumentSnapshot } from '../src/client/settings/secret-diagnostics.ts'

const migrations: SettingsMigrations = { currentVersion: 3, steps: new Map([[2, document => ({ ...document, showSelector: false })]]) }
const resolve = (document: unknown) => resolveDocument({ document, migrations, catalog: { local: { kind: 'local', label: 'Local', remote: false, optIn: false, access: { keyless: true, apiKey: false, account: false }, options: {} } }, defaults: { schema: z.strictObject({}), defaultConnection: 'builtin:local' }, capabilityLabel: 'test' })
const snapshot = (user: Record<string, unknown>, writable = true): SettingsDocumentSnapshot<Record<string, unknown>> => ({ status: 'ready', value: user, base: {}, user, revision: 7, writable })
afterEach(cleanup)

describe('actual client future migration writeback', () => {
  it.each([{}, { version: 2 }])('writes migrated %j once using the snapshot revision', async user => {
    let stored: Record<string, unknown> = user
    const writes: { operations: SettingsPathOpView[]; revision: number }[] = []
    const mutate = async (operations: SettingsPathOpView[], revision: number) => { writes.push({ operations, revision }); stored = applyOps(stored, operations); return true }
    const source = snapshot(user)
    const { result, rerender } = renderHook(props => useSettingsDocument(props.source, () => props.source, resolve, mutate, migrations), { initialProps: { source } })
    await waitFor(() => { expect(writes).toHaveLength(1) })
    expect(writes[0]?.revision).toBe(7)
    expect(stored).toEqual({ version: 3, showSelector: false })
    expect(user).not.toHaveProperty('showSelector')
    expect(result.current.view).toMatchObject({ kind: 'ready', needsWriteback: true })
    rerender({ source: { ...source } })
    expect(writes).toHaveLength(1)
    rerender({ source: { ...snapshot(stored), revision: 8 } })
    expect(result.current.view).toMatchObject({ kind: 'ready', needsWriteback: false })
    expect(writes).toHaveLength(1)
  })

  it('does not persist read-only or invalid migrations', () => {
    const writes: unknown[] = []
    const mutate = async (...args: unknown[]) => { writes.push(args); return true }
    const { result, rerender } = renderHook(({ source }) => useSettingsDocument(source, () => source, resolve, mutate, migrations), { initialProps: { source: snapshot({}, false) } })
    expect(result.current.view).toMatchObject({ kind: 'ready', config: { version: 3 }, needsWriteback: false })
    rerender({ source: snapshot({ version: 4 }) })
    expect(result.current.view).toMatchObject({ kind: 'invalid', needsWriteback: false })
    expect(writes).toEqual([])
    const invalid: SettingsMigrations = { currentVersion: 3, steps: new Map([[2, document => ({ ...document, showSelector: 'bad' })]]) }
    expect(editableSettings({}, {}, true, resolve, invalid)).toMatchObject({ kind: 'invalid', needsWriteback: false })
  })

  it('surfaces writeback failure and does not retry the same revision', async () => {
    let attempts = 0
    const mutate = async () => { attempts += 1; throw new Error('revision conflict') }
    const { result, rerender } = renderHook(() => {
      const source = snapshot({})
      return useSettingsDocument(source, () => source, resolve, mutate, migrations)
    })
    await waitFor(() => { expect(result.current.migrationError).toBe('revision conflict') })
    rerender()
    expect(attempts).toBe(1)
  })
})
