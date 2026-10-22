/** Credential dependency failures through the real registered enhanced tool, not a backend-only stub. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { inspect } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { WebError } from '@deepseek-ai/dsh-web'
import { SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { mountWebSettings } from '../../core/tests/fixtures/web-settings.ts'
import * as plugin from '../src/index.ts'
import { MemoryCredentials } from './fixtures/credentials.ts'
import { MODEL_SETTINGS_NS, modelSettingsPlugin } from './fixtures/model-host.ts'

const SECRET = 'credential-test-secret-0123456789'
const CAUSE = 'original-credential-cause-0123456789'
const STACK = 'original-credential-stack-0123456789'
const ENDPOINT = 'https://credential-boundary.invalid'
const failures = ['Error', 'WEB_PROVIDER_ERROR', 'WEB_ABORTED'] as const
const paths = [
  { name: 'adapter', provider: 'custom:adapter', account: false },
  { name: 'fixed-model API key', provider: 'custom:fixed', account: false },
  { name: 'session-model account', provider: 'builtin:session-model', account: true },
] as const

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function resolverError(kind: typeof failures[number]) {
  const error = kind === 'Error' ? new Error('resolver failed with ' + SECRET) : new WebError('resolver failed with ' + SECRET, kind)
  Object.defineProperty(error, 'cause', { value: new Error(CAUSE) })
  error.stack = STACK + ': ' + SECRET
  return error
}

function safeFailure(result: ToolExecutionResult, logs: unknown[], code: 'WEB_PROVIDER_ERROR' | 'WEB_ABORTED') {
  expect(result.isError).toBe(true)
  if (!result.isError) throw new Error('expected a tool error')
  expect.soft(result.error.info).toMatchObject({ code })
  if (code === 'WEB_PROVIDER_ERROR') expect(result.error.message).toContain(SEARCH.packageName + ': search failed; check the connection settings or choose another connection')
  for (const output of [inspect(result.content, { depth: null }), result.error.message, inspect(result.error, { depth: null }), inspect(logs, { depth: null })]) {
    for (const secret of [SECRET, CAUSE, STACK]) expect.soft(output).not.toContain(secret)
  }
}

async function host(account: boolean, provider: string) {
  const root = await mkdtemp(join(tmpdir(), 'search-credentials-'))
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
  ctx.provide('fileUploads', { registerAgentResolver: () => () => {} } as never)
  void new SessionController(ctx, { nativeOpen: false })
  const credentials = new MemoryCredentials(ctx)
  await credentials.set(credentialRef('TEST_KEY'), SECRET)
  const accountService = { resolveToken: async (_url: string): Promise<string | undefined> => SECRET }
  ctx.provide('deepseekAccount', accountService as never)
  ctx.baseUrl = pathToFileURL(root + '/').href
  await ctx.plugin(Loader)
  await mountWebSettings(ctx, root, {
    rows: [
      { id: SEARCH.rowId, name: 'cordis:searchForTest', config: {
        enhancedTools: true,
        defaultConnection: provider,
        connections: {
          'custom:adapter': { kind: 'adapter', adapter: 'tavily', label: 'Adapter', credentialRef: 'TEST_KEY', endpoint: ENDPOINT, trustedEndpoint: true },
          'custom:fixed': { kind: 'model', protocol: 'anthropic-messages', model: 'fixture', label: 'Fixed', credentialRef: 'TEST_KEY', endpoint: ENDPOINT, trustedEndpoint: true },
        },
      } },
      { id: MODEL_SETTINGS_NS, name: 'cordis:modelSettingsFixture', config: { routes: { 'deepseek-account': { baseURL: ENDPOINT } } } },
    ],
    configure: scope => {
      scope.loader.builtins.searchForTest = plugin
      scope.loader.builtins.modelSettingsFixture = modelSettingsPlugin
    },
  })
  await ctx.fiber.await()
  ctx.llm.registerConfigurableProviders([{ provider: 'deepseek-account', displayName: 'Account', settingsNs: MODEL_SETTINGS_NS, settingsPath: ['routes', 'deepseek-account'] }])
  const model = { provider: account ? 'deepseek-account' : 'fixture', model: 'fixture' }
  const handle = await ctx.agents.create({ sessionId: SessionId('credential-test'), agentOptions: model })
  onTestFinished(() => handle.dispose())
  const agent = handle.agent
  agent.session.append('request/context', model)
  await ctx.waterfall('agent/request', { agent, turn: 1, step: 0, signal: new AbortController().signal } as never, (async () => model) as never)
  const logs: unknown[] = []
  ctx.logger.exporter({ levels: { default: 3 }, export: entry => logs.push(entry.args) })
  const network = vi.fn(() => { throw new Error('credential failures must not reach the network') })
  vi.stubGlobal('fetch', network)
  const call = (signal: AbortSignal) => ctx.tools.execute({ callId: ToolCallId('credential-call'), name: SEARCH.tools.action, arguments: { queries: ['q'], provider }, agent, signal })
  const resolver = account ? vi.spyOn(accountService, 'resolveToken') : vi.spyOn(credentials, 'resolve')
  return { resolver, call, logs, network }
}

describe.each(paths)('enhanced search $name credential boundary', ({ account, provider }) => {
  it.each(failures)('contains a dependency %s without trusting its WebError code', async kind => {
    const h = await host(account, provider)
    h.resolver.mockRejectedValue(resolverError(kind))
    const result = await h.call(new AbortController().signal)
    expect(h.resolver).toHaveBeenCalledTimes(1)
    safeFailure(result, h.logs, 'WEB_PROVIDER_ERROR')
    expect(h.network).not.toHaveBeenCalled()
  })

  it('retains WEB_ABORTED when the real signal cancels a pending credential read', async () => {
    const h = await host(account, provider)
    const entered = Promise.withResolvers<void>()
    const pending = Promise.withResolvers<never>()
    h.resolver.mockImplementation(() => { entered.resolve(); return pending.promise })
    const controller = new AbortController()
    const result = h.call(controller.signal)
    await entered.promise
    controller.abort(resolverError('WEB_ABORTED'))
    pending.reject(resolverError('WEB_PROVIDER_ERROR'))
    safeFailure(await result, h.logs, 'WEB_ABORTED')
    expect(h.network).not.toHaveBeenCalled()
  })
})
