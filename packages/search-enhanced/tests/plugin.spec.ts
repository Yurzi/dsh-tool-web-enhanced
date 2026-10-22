/**
 * The plugin inside a real `ctx.web`: the `web` row as the profile bundle
 * writes it selects the seat, and the seat serves web_search through the
 * native-parity backend.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import Settings from '@deepseek-ai/dsh-settings'
import WebRuntime from '@deepseek-ai/dsh-web'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentRoute, providerView, routed } from './fixtures/core-host.ts'
import * as plugin from '../src/index.ts'
import { RETIRED_FIELDS } from '../src/settings/retired.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

async function compose(config: Record<string, unknown> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  // An empty launch environment: no DEEPSEEK_API_KEY leaks in from the developer's shell.
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }]))
  await ctx.plugin(WebRuntime, { searchProvider: SEARCH.providerId })
  const warnings: unknown[][] = []
  ctx.logger.exporter({ levels: { default: 3 }, export: message => { warnings.push(message.args) } })
  const fiber = await ctx.plugin(plugin, config)
  return { ctx, fiber, warnings }
}

describe('search seat', () => {
  it.each([
    { version: 1 },
    { providerId: 'retired' },
    { unknownOption: true },
    { showSelector: 'invalid' },
    { defaults: { unknownOption: true } },
    { connections: [] },
  ])('logs invalid settings %j and gives the model a short repair instruction', async config => {
    const { ctx, fiber, warnings } = await compose(config)
    let diagnostic = ''
    try { plugin.resolveSettings(config) } catch (error) { diagnostic = (error as Error).message }
    expect(diagnostic).not.toBe('')
    expect(warnings.some(args => args[0] === '%s: invalid initial search settings: %s' && args[2] instanceof Error && args[2].message === diagnostic)).toBe(true)
    await expect(ctx.web.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE', message: 'dsh-web-search-enhanced: search settings are invalid; ask the user to fix them on the settings page' })
    await expect(ctx.web.search({ query: 'q' })).rejects.not.toThrow('Reset')
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
  })

  it('is the provider the web row selects', async () => {
    const { ctx } = await compose()
    // A missing seat would be WEB_PROVIDER_CONFIGURED_MISSING; reaching the
    // DeepSeek backend without a key is what native search answers too.
    await expect(ctx.web.search({ query: 'deepseek harness' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
  })

  it('never sends the model to the native settings the profile retires', async () => {
    const { ctx } = await compose()
    const search = ctx.web.search({ query: 'q' })
    await expect(search).rejects.toThrow(/DEEPSEEK_API_KEY/)
    await expect(search).rejects.not.toThrow(/web-search-deepseek|Built-in plugin settings/)
  })

  it('leaves with the plugin', async () => {
    const { ctx, fiber } = await compose()
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
  })
})

/** Resolve installed transitive public APIs without adding workspace dependencies. */
async function settingsHost(config: Record<string, unknown> = {}, userConfig?: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), 'search-settings-'))
  roots.push(root)
  const requireSettings = createRequire(import.meta.resolve('@deepseek-ai/dsh-settings'))
  const editorPath = requireSettings.resolve('@deepseek-ai/dsh-config-editor')
  const { default: ConfigEditor } = await import(pathToFileURL(editorPath).href) as { default: Plugin }
  const requireEditor = createRequire(editorPath)
  const boot = await import(pathToFileURL(requireEditor.resolve('@deepseek-ai/dsh-app-boot')).href) as {
    initProfile(dir: string, bundles: string[]): void
    readProfilePatches(bin: string, profile: object): PatchOptions[]
    mountRootInclude(ctx: Context, path: string, patches: PatchOptions[]): Promise<unknown>
  }
  const dir = join(root, 'profile')
  boot.initProfile(dir, [])
  const profile = { name: 'test', startedBundles: [], dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(root, 'package.json'), cwd: root, home: root, overlays: [], telemetryDisabledEnv: undefined }
  // All files belong to this disposable test profile, never the user's DSH home or project manifest.
  await writeFile(profile.installAnchor, JSON.stringify({ name: 'search-settings-test' }))
  await writeFile(join(dir, 'cordis.yml'), '[]')
  await writeFile(profile.patchPath, JSON.stringify([{ insert: [
    { id: 'web', name: 'cordis:webForTest', config: { searchProvider: SEARCH.providerId } },
    { id: SEARCH.rowId, name: 'cordis:searchForTest', config },
  ] }, ...(userConfig === undefined ? [] : [{ id: SEARCH.rowId, config: userConfig }])]))
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(dir + '/').href
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }]))
  ctx.provide('profileContext', profile)
  await ctx.plugin(Loader)
  ctx.loader.builtins.webForTest = WebRuntime
  ctx.loader.builtins.searchForTest = plugin
  await ctx.plugin(ConfigEditor)
  await ctx.plugin(Settings)
  await boot.mountRootInclude(ctx, join(dir, 'cordis.yml'), boot.readProfilePatches('dsh', profile))
  await ctx.loader.await()
  return { ctx, profile }
}

describe('live configuration and public route data', () => {
  it('redacts retired apiKey values while retaining only public secret-presence metadata', async () => {
    const { ctx } = await settingsHost({}, { apiKey: 'fixture-not-real-secret' })
    const row = ctx.settings.describe({ redactSecrets: true }).find(entry => entry.ns === SEARCH.rowId)!
    for (const value of [row.value, row.base, row.user]) expect(value).not.toHaveProperty('apiKey')
    expect(row.secrets).toContainEqual({ path: ['apiKey'], set: true })
    expect(JSON.stringify(row)).not.toContain('fixture-not-real-secret')
  })

  it.each(RETIRED_FIELDS)('rejects reset-only field %s rather than migrating it', field => {
    expect(() => plugin.resolveSettings({ [field]: 'retired' })).toThrow(field + ' is a 0.1.x setting this release does not read; remove it or use Reset')
  })

  it('exposes retired fields to real Settings and allows revision-fenced Reset removal', async () => {
    const { ctx } = await settingsHost({}, { providerId: 'retired' })
    const row = ctx.settings.describe().find(entry => entry.ns === SEARCH.rowId)!
    expect(row.user).toHaveProperty('providerId', 'retired')
    expect(() => plugin.resolveSettings(row.user)).toThrow('providerId is a 0.1.x setting this release does not read; remove it or use Reset')
    await ctx.settings.mutate(SEARCH.rowId, [{ op: 'unset', path: ['providerId'] }], row.revision)
    const repaired = ctx.settings.describe().find(entry => entry.ns === SEARCH.rowId)!
    expect(repaired.user).not.toHaveProperty('providerId')
    expect(() => plugin.resolveSettings(repaired.value)).not.toThrow()
  })

  it('exposes current and reset-only retired volatile fields and accepts an omitted version', () => {
    const config = plugin.Config({})
    expect(Object.keys(config).toSorted()).toEqual(['connections', 'defaultConnection', 'defaults', 'enhancedTools', 'showSelector', 'version', ...RETIRED_FIELDS].toSorted())
    for (const field of Object.values(config)) expect(field.get()).toBeUndefined()
    expect(() => plugin.resolveSettings({})).not.toThrow()
  })

  it('rejects invalid writes before persistence and repairs a malformed live field', async () => {
    const { ctx } = await settingsHost({ showSelector: 'invalid' })
    const before = ctx.settings.describe().find(row => row.ns === SEARCH.rowId)!.value
    for (const invalid of [{ version: 1 }, { showSelector: 0 }, { defaults: { unknownOption: true } }, { connections: [] }, { defaultConnection: 'custom:gone' }]) {
      await expect(ctx.settings.update(SEARCH.rowId, invalid)).rejects.toThrow()
      expect(ctx.settings.describe().find(row => row.ns === SEARCH.rowId)!.value).toEqual(before)
    }
    await ctx.settings.update(SEARCH.rowId, { showSelector: true })
    expect(ctx.settings.describe().find(row => row.ns === SEARCH.rowId)!.value).toEqual({ showSelector: true })
    await expect(ctx.web.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
  })

  it('rejects unknown raw keys clearly before attempting Volatile reads', async () => {
    const { ctx } = await settingsHost()
    const before = ctx.settings.describe().find(row => row.ns === SEARCH.rowId)!.value
    await expect(ctx.settings.update(SEARCH.rowId, { unknownSearchOption: true })).rejects.toThrow(/unknownSearchOption/)
    expect(ctx.settings.describe().find(row => row.ns === SEARCH.rowId)!.value).toEqual(before)
  })

  it('reads the real Settings web value, with configuration preceding the environment', async () => {
    const { ctx } = await settingsHost()
    expect(ctx.settings.describe().find(row => row.ns === 'web')?.value).toEqual({ searchProvider: SEARCH.providerId })
    vi.stubEnv('DSH_WEB_SEARCH_PROVIDER', 'other')
    expect(providerView()).toEqual({ providerId: SEARCH.providerId, envProvider: 'other' })
    expect(currentRoute(ctx)).toEqual({ kind: 'this' })
    expect(routed(ctx)).toBe(true)
    await ctx.settings.update('web', { searchProvider: 'other' })
    vi.stubEnv('DSH_WEB_SEARCH_PROVIDER', SEARCH.providerId)
    expect(routed(ctx)).toBe(false)
    await ctx.settings.update('web', { searchProvider: '' })
    expect(providerView()).toEqual({ providerId: SEARCH.providerId, envProvider: SEARCH.providerId })
    expect(currentRoute(ctx)).toEqual({ kind: 'other', provider: '', providerId: SEARCH.providerId })
    await expect(ctx.web.search({ query: 'empty configured provider' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
    vi.stubEnv('DSH_WEB_SEARCH_PROVIDER', '')
    expect(routed(ctx)).toBe(false)
  })

  it('rejects invalid Settings candidates before persistence, with all fields volatile', async () => {
    const { ctx } = await settingsHost()
    const before = ctx.settings.describe().find(row => row.ns === SEARCH.rowId)!
    expect(before.autoGenerate).toBe(false)
    await expect(ctx.settings.update(SEARCH.rowId, { connections: { 'builtin:exa': { options: { nonexistent: true } } } })).rejects.toThrow()
    expect(ctx.settings.describe().find(row => row.ns === SEARCH.rowId)!.value).toEqual(before.value)
    await ctx.settings.update(SEARCH.rowId, { version: 2, defaultConnection: 'builtin:openalex', defaults: { freshness: 'fresh' }, showSelector: false, connections: {} })
    expect(ctx.settings.describe().find(row => row.ns === SEARCH.rowId)!.value).toMatchObject({ version: 2, defaultConnection: 'builtin:openalex', defaults: { freshness: 'fresh' }, showSelector: false, connections: {} })
    expect(providerView().providerId).toBe(SEARCH.providerId)
  })
})
