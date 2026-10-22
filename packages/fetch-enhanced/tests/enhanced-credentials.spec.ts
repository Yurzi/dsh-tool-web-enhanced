/** Credential dependency failures through real Settings, plugin registration and tools.execute. */
import { inspect } from 'node:util'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { WebError } from '@deepseek-ai/dsh-web'
import { FETCH } from 'dsh-tool-web-enhanced-core/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { composeFetch } from './fixtures/composition-host.ts'

const SECRET = 'fetch-credential-test-secret-0123456789'
const CAUSE = 'original-fetch-credential-cause-0123456789'
const STACK = 'original-fetch-credential-stack-0123456789'
const failures = ['Error', 'WEB_PROVIDER_ERROR', 'WEB_ABORTED'] as const

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
  if (code === 'WEB_PROVIDER_ERROR') expect(result.error.message).toContain(FETCH.packageName + ': fetch failed; check the connection settings or choose another connection')
  for (const output of [inspect(result.content, { depth: null }), result.error.message, inspect(result.error, { depth: null }), inspect(logs, { depth: null })]) {
    for (const secret of [SECRET, CAUSE, STACK]) expect.soft(output).not.toContain(secret)
  }
}

async function host() {
  const h = await composeFetch({ enhancedTools: true, connections: {
    'custom:crawl': { kind: 'adapter', adapter: 'firecrawl', label: 'Crawl', credentialRef: 'TEST_KEY', endpoint: 'https://credential-boundary.invalid', trustedEndpoint: true },
  } })
  await h.request()
  await h.credentials.set(credentialRef('TEST_KEY'), SECRET)
  const logs: unknown[] = []
  h.ctx.logger.exporter({ levels: { default: 3 }, export: entry => logs.push(entry.args) })
  const network = vi.fn(() => { throw new Error('credential failures must not reach the network') })
  vi.stubGlobal('fetch', network)
  const call = (signal: AbortSignal) => h.ctx.tools.execute({ callId: ToolCallId('credential-call'), name: FETCH.tools.action, arguments: { url: 'https://example.com/', provider: 'custom:crawl' }, agent: h.agent, signal })
  return { resolver: vi.spyOn(h.credentials, 'resolve'), call, logs, network }
}

describe('enhanced fetch adapter credential boundary', () => {
  it.each(failures)('contains a dependency %s without trusting its WebError code', async kind => {
    const h = await host()
    h.resolver.mockRejectedValue(resolverError(kind))
    const result = await h.call(new AbortController().signal)
    expect(h.resolver).toHaveBeenCalledTimes(1)
    safeFailure(result, h.logs, 'WEB_PROVIDER_ERROR')
    expect(h.network).not.toHaveBeenCalled()
  })

  it('retains WEB_ABORTED when the real signal cancels a pending credential read', async () => {
    const h = await host()
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
