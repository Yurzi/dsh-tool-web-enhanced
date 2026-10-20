import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Settings from '@deepseek-ai/dsh-settings'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import WebRuntime from '@deepseek-ai/dsh-web'
import { FETCH } from 'dsh-tool-web-enhanced-core/shared'
import { onTestFinished } from 'vitest'
import * as plugin from '../../src/index.ts'
import type { FetchSettings } from '../../src/settings/types.ts'
import { MemoryCredentials } from './credentials.ts'

export async function composeFetch(config: FetchSettings) {
  const root = await mkdtemp(join(tmpdir(), 'fetch-composition-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }]))
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(TypertRegistry)
  // Upload resolution is outside this suite. Retain its public registration seam.
  const resolvers = new Set<unknown>()
  ctx.provide('fileUploads', { registerAgentResolver: (resolver: unknown) => {
    resolvers.add(resolver)
    return () => { resolvers.delete(resolver) }
  } } as never)
  void new SessionController(ctx, { nativeOpen: false })
  const credentials = new MemoryCredentials(ctx)
  await credentials.set(credentialRef('TEST_KEY'), 'composition-secret')

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
  await writeFile(profile.installAnchor, JSON.stringify({ name: 'fetch-composition-test' }))
  await writeFile(join(dir, 'cordis.yml'), '[]')
  await writeFile(profile.patchPath, JSON.stringify([{ insert: [
    { id: 'web', name: 'cordis:webForTest', config: { fetchProvider: FETCH.providerId } },
    { id: FETCH.rowId, name: 'cordis:fetchForTest', config },
  ] }]))
  ctx.baseUrl = pathToFileURL(dir + '/').href
  ctx.provide('profileContext', profile)
  await ctx.plugin(Loader)
  ctx.loader.builtins.webForTest = WebRuntime
  ctx.loader.builtins.fetchForTest = plugin
  await ctx.plugin(ConfigEditor)
  await ctx.plugin(Settings)
  await boot.mountRootInclude(ctx, join(dir, 'cordis.yml'), boot.readProfilePatches('dsh', profile))
  await ctx.loader.await()
  await ctx.fiber.await()
  const handle = await ctx.agents.create({ sessionId: SessionId('fetch-composition') })
  onTestFinished(() => handle.dispose())
  const agent = handle.agent
  let step = 0
  const request = async () => {
    await ctx.waterfall('agent/request', { agent, turn: 1, step: step++, signal: new AbortController().signal } as never, (async () => ({ provider: 'p', model: 'm' })) as never)
  }
  const select = async (connectionId: string) => {
    const current = await ctx.fetchConnections.get({ sessionId: agent.id })
    await ctx.fetchConnections.set({ sessionId: agent.id, connectionId, expectedRevision: current.selection.revision })
    await request()
  }
  const fetch = (url: string) => ctx.agents.withInitiator(agent, () => ctx.web.fetch({ url }))
  const notice = async () => ctx.agents.withInitiator(agent, async () => (await ctx.systemPrompt.assemble()).contexts.find(context => context.name === 'web-fetch-enhanced:allowlist')!.text)
  return { ctx, agent, credentials, select, request, fetch, notice }
}
