import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { afterEach, expect, it } from 'vitest'
import { settingsRow, type VolatileSettings } from '../src/host/settings-row.ts'
import { SEARCH } from '../src/shared/ids.ts'
import { resolveSettings, type ResolvedSettings } from '../../search-enhanced/src/settings/resolve.ts'
import type { SearchSettings } from '../../search-enhanced/src/settings/types.ts'
import { mountWebSettings } from './fixtures/web-settings.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).toReversed()) await cleanup() })

async function host(initial: SearchSettings = {}) {
  const root = await mkdtemp(join(tmpdir(), 'core-settings-row-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(Loader)
  const row = settingsRow<SearchSettings, ResolvedSettings>({
    identity: SEARCH, capabilityLabel: 'search', retiredFields: [], secretFields: [], resolve: resolveSettings,
  })
  let activation: { scope: Context; config: VolatileSettings<SearchSettings>; settings: () => ResolvedSettings } | undefined
  let activations = 0
  const plugin = {
    name: SEARCH.rowId, Config: row.Config,
    apply(scope: Context, config: VolatileSettings<SearchSettings>) {
      activations++
      row.apply(scope, config, (owner, settings) => { activation = { scope: owner, config, settings } })
    },
  }
  await mountWebSettings(ctx, root, {
    rows: [{ id: SEARCH.rowId, name: 'cordis:settingsRowForTest', config: initial }],
    configure(scope) { scope.loader.builtins.settingsRowForTest = plugin },
  })
  const descriptor = () => ctx.settings.describe().find(item => item.ns === SEARCH.rowId)!
  expect(activation).toBeDefined()
  return { ctx, activation: activation!, descriptor, activations: () => activations }
}

it('reads the activation effective config and retains its volatile references across layered saves', async () => {
  const h = await host({
    enhancedTools: true, showSelector: false,
    connections: { 'builtin:exa': { label: 'Base Exa', disabled: false, credentialRef: 'BASE_KEY' } },
  })
  const { config, scope, settings } = h.activation
  expect(scope.fiber.effectiveConfig).toBe(config)
  const connections = config.connections
  expect(settings()).toMatchObject({ enhancedTools: true, showSelector: false })
  expect(settings().connections.get('builtin:exa')).toMatchObject({ label: 'Base Exa', credentialRef: 'BASE_KEY', disabled: false })
  await h.ctx.settings.mutate(SEARCH.rowId, [{ op: 'set', path: ['connections', 'builtin:exa', 'label'], value: 'User Exa' }])
  expect(h.descriptor()).toMatchObject({
    base: { enhancedTools: true, connections: { 'builtin:exa': { label: 'Base Exa', credentialRef: 'BASE_KEY' } } },
    user: { connections: { 'builtin:exa': { label: 'User Exa' } } },
  })
  expect(settings().connections.get('builtin:exa')).toMatchObject({ label: 'User Exa', credentialRef: 'BASE_KEY', disabled: false })
  expect(settings()).toMatchObject({ enhancedTools: true, showSelector: false })
  expect(scope.fiber.effectiveConfig).toBe(config)
  expect(config.connections).toBe(connections)
  expect(h.activations()).toBe(1)
  await h.ctx.settings.mutate(SEARCH.rowId, [{ op: 'unset', path: ['connections', 'builtin:exa', 'label'] }])
  expect(settings().connections.get('builtin:exa')!.label).toBe('Base Exa')
})

it.each(['showSelector', 'enhancedTools'] as const)('rejects invalid %s before changing files, revision, raw config or volatile references', async field => {
  const h = await host({ showSelector: true, enhancedTools: true })
  const { scope, config, settings } = h.activation
  const reference = config[field]
  const raw = scope.fiber.rawConfig
  const before = h.descriptor()
  const document = await readFile(h.ctx.settings.documentPath, 'utf8')
  const candidate = { showSelector: true, enhancedTools: true, [field]: 0 }
  expect(() => scope.fiber.resolveConfig(candidate)).toThrow()
  await expect(h.ctx.settings.mutate(SEARCH.rowId, [{ op: 'set', path: [field], value: 0 }], before.revision)).rejects.toThrow()
  expect(await readFile(h.ctx.settings.documentPath, 'utf8')).toBe(document)
  expect(h.descriptor()).toMatchObject({ revision: before.revision, value: before.value, base: before.base, user: before.user })
  expect(scope.fiber.rawConfig).toBe(raw)
  expect(scope.fiber.effectiveConfig).toBe(config)
  expect(config[field]).toBe(reference)
  expect(reference.get()).toBe(true)
  expect(settings()).toMatchObject({ showSelector: true, enhancedTools: true })
  expect(h.activations()).toBe(1)
})

it('keeps an invalid initial document mounted and repairs it through the same Settings seam', async () => {
  const h = await host({ showSelector: 0 } as unknown as SearchSettings)
  const { scope, config, settings } = h.activation
  expect(() => settings()).toThrow('settings are invalid')
  const before = h.descriptor()
  await h.ctx.settings.mutate(SEARCH.rowId, [{ op: 'set', path: ['showSelector'], value: false }], before.revision)
  expect(settings().showSelector).toBe(false)
  expect(h.descriptor().revision).toBeGreaterThan(before.revision)
  expect(scope.fiber.effectiveConfig).toBe(config)
  expect(h.activations()).toBe(1)
})
