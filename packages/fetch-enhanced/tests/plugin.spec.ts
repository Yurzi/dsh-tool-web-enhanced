/**
 * The plugin inside a real `ctx.web`: the `web` row as the profile bundle
 * writes it selects the seat, and the seat serves web_fetch through the
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
import { FETCH } from 'dsh-tool-web-enhanced-core/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { providerView, routeFacts } from 'dsh-tool-web-enhanced-core/host'
import * as plugin from '../src/index.ts'
import { RETIRED_FIELDS } from '../src/settings/retired.ts'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'

const currentRoute = (ctx: Context) => routeFacts(ctx, 'fetchProvider', FETCH.providerId)
const routed = (ctx: Context) => currentRoute(ctx).kind === 'this'
const fetchProviderView = () => providerView(FETCH.providerId, 'fetchProvider')

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
  await ctx.plugin(WebRuntime, { fetchProvider: FETCH.providerId })
  const warnings: unknown[][] = []
  ctx.logger.exporter({ levels: { default: 3 }, export: message => { warnings.push(message.args) } })
  const fiber = await ctx.plugin(plugin, config)
  return { ctx, fiber, warnings }
}

describe('fetch seat', () => {
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
    expect(warnings.some(args => args[0] === '%s: invalid initial fetch settings: %s' && args[2] instanceof Error && args[2].message === diagnostic)).toBe(true)
    await expect(ctx.web.fetch({ url: 'https://example.org/' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE', message: 'dsh-web-fetch-enhanced: fetch settings are invalid; ask the user to fix them on the settings page' })
    await expect(ctx.web.fetch({ url: 'https://example.org/' })).rejects.not.toThrow('Reset')
    await fiber.dispose()
    await expect(ctx.web.fetch({ url: 'https://example.org/' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
  })

  it('is the provider the web row selects', async () => {
    const { ctx } = await compose()
    // The unique Seat reaches local public-only policy, not a missing registration.
    await expect(ctx.web.fetch({ url: 'http://127.0.0.1:9/' })).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
  })

  it('leaves with the plugin', async () => {
    const { ctx, fiber } = await compose()
    await fiber.dispose()
    await expect(ctx.web.fetch({ url: 'http://127.0.0.1:9/' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
  })
})

/** Resolve installed transitive public APIs without adding workspace dependencies. */
async function settingsHost(config: Record<string, unknown> = {}, userConfig?: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), 'fetch-settings-'))
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
  await writeFile(profile.installAnchor, JSON.stringify({ name: 'fetch-settings-test' }))
  await writeFile(join(dir, 'cordis.yml'), '[]')
  await writeFile(profile.patchPath, JSON.stringify([{ insert: [
    { id: 'web', name: 'cordis:webForTest', config: { fetchProvider: FETCH.providerId } },
    { id: FETCH.rowId, name: 'cordis:fetchForTest', config },
  ] }, ...(userConfig === undefined ? [] : [{ id: FETCH.rowId, config: userConfig }])]))
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(dir + '/').href
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }]))
  ctx.provide('profileContext', profile)
  await ctx.plugin(Loader)
  ctx.loader.builtins.webForTest = WebRuntime
  ctx.loader.builtins.fetchForTest = plugin
  await ctx.plugin(ConfigEditor)
  await ctx.plugin(Settings)
  await boot.mountRootInclude(ctx, join(dir, 'cordis.yml'), boot.readProfilePatches('dsh', profile))
  await ctx.loader.await()
  return { ctx, profile }
}

describe('live configuration and public route data', () => {
  it.each(RETIRED_FIELDS)('rejects reset-only field %s rather than migrating it', field => {
    expect(() => plugin.resolveSettings({ [field]: 'retired' })).toThrow(field + ' is a 0.1.x setting this release does not read; remove it or use Reset')
  })

  it('exposes retired fields to real Settings and allows revision-fenced Reset removal', async () => {
    const { ctx } = await settingsHost({}, { providerId: 'retired' })
    const row = ctx.settings.describe().find(entry => entry.ns === FETCH.rowId)!
    expect(row.user).toHaveProperty('providerId', 'retired')
    expect(() => plugin.resolveSettings(row.user)).toThrow('providerId is a 0.1.x setting this release does not read; remove it or use Reset')
    await ctx.settings.mutate(FETCH.rowId, [{ op: 'unset', path: ['providerId'] }], row.revision)
    const repaired = ctx.settings.describe().find(entry => entry.ns === FETCH.rowId)!
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
    const before = ctx.settings.describe().find(row => row.ns === FETCH.rowId)!.value
    for (const invalid of [{ version: 1 }, { showSelector: 0 }, { defaults: { unknownOption: true } }, { connections: [] }, { defaultConnection: 'custom:gone' }]) {
      await expect(ctx.settings.update(FETCH.rowId, invalid)).rejects.toThrow()
      expect(ctx.settings.describe().find(row => row.ns === FETCH.rowId)!.value).toEqual(before)
    }
    await ctx.settings.update(FETCH.rowId, { showSelector: true })
    expect(ctx.settings.describe().find(row => row.ns === FETCH.rowId)!.value).toEqual({ showSelector: true })
    await expect(ctx.web.fetch({ url: 'http://127.0.0.1:9/' })).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
  })

  it('rejects unknown raw keys clearly before attempting Volatile reads', async () => {
    const { ctx } = await settingsHost()
    const before = ctx.settings.describe().find(row => row.ns === FETCH.rowId)!.value
    await expect(ctx.settings.update(FETCH.rowId, { unknownFetchOption: true })).rejects.toThrow(/unknownFetchOption/)
    expect(ctx.settings.describe().find(row => row.ns === FETCH.rowId)!.value).toEqual(before)
  })

  it('reads the real Settings web value, with configuration preceding the environment', async () => {
    const { ctx } = await settingsHost()
    expect(ctx.settings.describe().find(row => row.ns === 'web')?.value).toEqual({ fetchProvider: FETCH.providerId })
    vi.stubEnv('DSH_WEB_FETCH_PROVIDER', 'other')
    expect(fetchProviderView()).toEqual({ providerId: FETCH.providerId, envProvider: 'other' })
    expect(currentRoute(ctx)).toEqual({ kind: 'this' })
    expect(routed(ctx)).toBe(true)
    await ctx.settings.update('web', { fetchProvider: 'other' })
    vi.stubEnv('DSH_WEB_FETCH_PROVIDER', FETCH.providerId)
    expect(routed(ctx)).toBe(false)
    await ctx.settings.update('web', { fetchProvider: '' })
    expect(fetchProviderView()).toEqual({ providerId: FETCH.providerId, envProvider: FETCH.providerId })
    expect(currentRoute(ctx)).toEqual({ kind: 'other', provider: '', providerId: FETCH.providerId })
    await expect(ctx.web.fetch({ url: 'https://example.invalid/' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
    vi.stubEnv('DSH_WEB_FETCH_PROVIDER', '')
    expect(routed(ctx)).toBe(false)
  })

  it('rejects invalid Settings candidates before persistence, with all fields volatile', async () => {
    const { ctx } = await settingsHost()
    const before = ctx.settings.describe().find(row => row.ns === FETCH.rowId)!
    expect(before.autoGenerate).toBe(false)
    await expect(ctx.settings.update(FETCH.rowId, { version: 2, connections: { 'builtin:local': { options: { nonexistent: true } } } })).rejects.toThrow()
    expect(ctx.settings.describe().find(row => row.ns === FETCH.rowId)!.value).toEqual(before.value)
    await ctx.settings.update(FETCH.rowId, { version: 2, defaultConnection: 'builtin:local', defaults: {}, showSelector: false, connections: {} })
    expect(ctx.settings.describe().find(row => row.ns === FETCH.rowId)!.value).toMatchObject({ version: 2, defaultConnection: 'builtin:local', defaults: {}, showSelector: false, connections: {} })
    expect(fetchProviderView().providerId).toBe(FETCH.providerId)
  })
})

it('keeps the settings page available for an invalid predecessor document without migrating it', async () => {
  const legacy = { schemaVersion: 1, providerId: 'ignored-legacy-id', allowCidrs: ['127.0.0.1/32'] }
  const { ctx } = await settingsHost(legacy)
  expect(ctx.settings.describe().find(row => row.ns === FETCH.rowId)?.autoGenerate).toBe(false)
  const result = ctx.web.fetch({ url: 'http://127.0.0.1:9/' })
  await expect(result).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' })
  await expect(result).rejects.toThrow('fetch settings are invalid; ask the user to fix them on the settings page')
  await expect(result).rejects.not.toThrow('schemaVersion')
})

it('contributes a notice only for a local plan, nonempty CIDRs, and a confirmed route', async () => {
  const local = { version: 2, connections: { 'builtin:local': { options: { allowCidrs: ['198.18.0.0/15'] } } } }
  const { ctx } = await settingsHost(local)
  await ctx.plugin(SystemPrompt)
  await ctx.fiber.await()
  ctx.systemPrompt.context({ name: 'sandbox-test', order: ctx.systemPrompt.getContextOrder('SANDBOX_POLICY'), text: 'Sandbox policy' })
  const text = async () => (await ctx.systemPrompt.assemble()).contexts.find(context => context.name === 'web-fetch-enhanced:allowlist')!.text
  expect(await text()).toContain('within [198.18.0.0/15]')
  expect((await ctx.systemPrompt.assemble()).contexts.map(context => context.name)).toEqual(['sandbox-test', 'web-fetch-enhanced:allowlist'])
  await ctx.settings.update(FETCH.rowId, { defaultConnection: 'builtin:deepseek-fetch-api' })
  expect(await text()).toBe('')
  await ctx.settings.update(FETCH.rowId, { defaultConnection: 'builtin:local', connections: { 'builtin:local': { options: { allowCidrs: [] } } } })
  expect(await text()).toBe('')
  await ctx.settings.update(FETCH.rowId, { connections: local.connections })
  await ctx.settings.update('web', { fetchProvider: 'other' })
  expect(await text()).toBe('')
  await ctx.settings.update('web', { fetchProvider: FETCH.providerId })
  expect(await text()).toContain('within [198.18.0.0/15]')
})

it('omits the notice when the web row cannot be inspected, even with a matching environment', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  vi.stubEnv('DSH_WEB_FETCH_PROVIDER', FETCH.providerId)
  await ctx.plugin(WebRuntime, { fetchProvider: FETCH.providerId })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(plugin, { version: 2, connections: { 'builtin:local': { options: { allowCidrs: ['198.18.0.0/15'] } } } })
  await ctx.fiber.await()
  expect((await ctx.systemPrompt.assemble()).contexts.find(context => context.name === 'web-fetch-enhanced:allowlist')!.text).toBe('')
})
