/** Keep runtime services and plugin rows under non-root Cordis fibers, like the DSH loader. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import type { PeerId, PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import WebRuntime from '@deepseek-ai/dsh-web'
import { afterEach, expect, it } from 'vitest'
import { SEARCH, FETCH } from '../src/shared/index.ts'
import * as searchPlugin from '../../search-enhanced/src/index.ts'
import * as fetchPlugin from '../../fetch-enhanced/src/index.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).toReversed()) await cleanup() })

async function host() {
  const root = await mkdtemp(join(tmpdir(), 'nested-remote-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const diagnostics: string[] = []
  ctx.logger.exporter({ levels: { default: 3 }, export: message => {
    for (const value of message.args) if (value instanceof Error) diagnostics.push(value.message)
  } })
  let invoke!: (namespace: string, method: string, request: Record<string, unknown>) => Promise<unknown>
  await ctx.plugin({
    name: 'fixture-runtime',
    async apply(runtime: Context) {
      await mountAgentLoopTestDependencies(runtime, { tools: { mode: 'native' } })
      await runtime.plugin(Projections)
      await runtime.plugin(AgentLoop)
      await runtime.plugin(Storage)
      await runtime.plugin(StorageJson, { root })
      await runtime.plugin(StorageDomain, { backend: 'json' })
      await runtime.plugin(WebRuntime, { searchProvider: SEARCH.providerId, fetchProvider: FETCH.providerId })
      await runtime.plugin(TypertRegistry)
      await runtime.inject(['typert'], gateway => { void new Gateway(gateway, {}) })
      const uploadResolvers = new Set<unknown>()
      runtime.provide('fileUploads', { registerAgentResolver: (resolver: unknown) => {
        uploadResolvers.add(resolver)
        return () => { uploadResolvers.delete(resolver) }
      } } as never)
      void new SessionController(ctx, { nativeOpen: false })
      // Unlike root-level fixture installation, service providers are not ancestors
      // of this row scope. Each nested Remote must declare its own required services.
      await runtime.plugin({
        name: 'fixture-plugin-rows',
        async apply(rows: Context) {
          await rows.plugin(searchPlugin, {})
          await rows.plugin(fetchPlugin, {})
        },
      })
      await runtime.plugin({
        name: 'fixture-transport', inject: ['typertGateway'],
        apply(transport: Context) {
          // Calling the gateway from root bypasses Cordis's runtime-scoped access guard.
          // The real Web transport calls it from a plugin, so keep that seam nested too.
          const peer: PeerScope = {
            id: 'owner' as PeerId, ctx: transport, principal: { kind: 'owner' }, interactions: 'answer',
            signal: new AbortController().signal, dispose: async () => {},
          }
          invoke = (namespace, method, request) => transport.typertGateway.invoke({ peer, namespace, method, args: { request } })
        },
      })
    },
  })
  await ctx.fiber.await()
  const handle = await ctx.agents.create({ sessionId: SessionId('nested-session'), agentOptions: { provider: 'fixture', model: 'm' } })
  cleanups.push(() => handle.dispose())
  return { agent: handle.agent, invoke, diagnostics }
}

it.each([
  { namespace: 'searchConnections', connectionId: 'builtin:deepseek-messages' },
  { namespace: 'fetchConnections', connectionId: 'builtin:local' },
].flatMap(row => ['get', 'set'].map(method => ({ ...row, method }))))(
  '$namespace/$method works across nested runtime, row and transport fibers', async ({ namespace, connectionId, method }) => {
    const h = await host()
    const request = { sessionId: h.agent.id, ...(method === 'set' ? { connectionId: null, expectedRevision: 0 } : {}) }
    const result = await h.invoke(namespace, method, request).then(
      value => ({ kind: 'done' as const, value }),
      (error: unknown) => ({ kind: 'failed' as const, error }),
    )
    // Missing injection is logged as cannot-get-property before the Remote boundary sanitizes it.
    expect(h.diagnostics).toEqual([])
    if (result.kind === 'failed') throw result.error
    expect(result.value).toMatchObject(method === 'set'
      ? { selection: { connectionId: null, revision: 1 }, source: 'session' }
      : { selection: { connectionId, revision: 0 }, source: 'default' })
    if (method === 'get') {
      expect(await h.invoke(namespace, 'set', { sessionId: h.agent.id, connectionId: null, expectedRevision: 0 }))
        .toMatchObject({ selection: { connectionId: null, revision: 1 }, source: 'session' })
    }
    expect(await h.invoke(namespace, 'get', { sessionId: h.agent.id }))
      .toMatchObject({ selection: { connectionId: null, revision: 1 }, source: 'session' })
    expect(h.diagnostics).toEqual([])
  },
)
