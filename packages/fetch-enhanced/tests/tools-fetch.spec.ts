/** web_fetch_enhanced and list_web_fetch_providers over a stand-in EnhancedAccess, next to the real tool-web web_fetch. */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import WebRuntime, { WebError, type WebFetchRequest, type WebFetchResult } from '@deepseek-ai/dsh-web'
import type { EnhancedAccess, Explicit, ExplicitCall, ProviderListing, ReadyProviders } from 'dsh-tool-web-enhanced-core/host'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FetchOptions } from '../src/host/options.ts'
import { fetchEnhanced } from '../src/tools/index.ts'

type Access = EnhancedAccess<FetchOptions, WebFetchRequest, WebFetchResult>
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup()
})

const done = (value: WebFetchResult): Explicit<WebFetchResult> => ({ kind: 'done', value })
const unexpected = () => { throw new Error('unexpected access') }

/** Real tool registry and Agent; the enhanced definitions over `access`, the native web_fetch over `provider`. */
async function host(access: Partial<Access>, provider: (request: WebFetchRequest) => Promise<WebFetchResult> = unexpected) {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop)
  await ctx.plugin(WebRuntime, {})
  await ctx.plugin({ inject: ['web'], apply: (scope: Context) => { scope.web.registerFetchProvider({ id: 'fake', available: () => true, fetch: provider }) } })
  await ctx.plugin({ inject: ['tools', 'web', 'systemPrompt'], apply: (scope: Context) => ToolWeb.apply(scope, ToolWeb.Config({ search: false })) })
  await ctx.fiber.await()
  const tools = fetchEnhanced(ctx).tools({ run: unexpected, list: unexpected, ready: unexpected, ...access })
  ctx.tools.register(tools.action)
  ctx.tools.register(tools.list)
  const handle = await ctx.agents.create({ sessionId: SessionId('s'), agentOptions: { provider: 'fixture', model: 'fixture' } })
  cleanups.push(() => handle.dispose())
  const { agent } = handle
  let calls = 0
  const run = (name: string, args: Record<string, unknown>, options: { agent?: Agent | undefined } = { agent }) =>
    ctx.tools.execute({ callId: ToolCallId(`c${++calls}`), name, arguments: args, ...options.agent === undefined ? {} : { agent: options.agent }, signal: new AbortController().signal })
  return { ctx, agent, run }
}

const text = (result: ToolExecutionResult) => (result.content[0] as { text: string }).text
const failure = (result: ToolExecutionResult) => {
  expect(result.isError).toBe(true)
  return result.isError ? result.error : undefined
}

describe('definitions', () => {
  it('match the design text, with the native argument first and provider last', async () => {
    const { ctx } = await host({})
    const schemas = Object.fromEntries(ctx.tools.schemas().map(schema => [schema.name, schema]))
    expect(schemas.web_fetch_enhanced).toMatchObject({
      description: 'Fetch a URL through a provider you choose and return it as text. Use web_fetch unless you need a specific provider: one the user named, or another after web_fetch fails.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The HTTP(S) URL to fetch.' },
          provider: { type: 'string', description: 'Provider id exactly as listed by list_web_fetch_providers.' },
        },
        required: ['url', 'provider'],
      },
    })
    const parameters = schemas.web_fetch_enhanced?.parameters as { properties: object }
    expect(Object.keys(parameters.properties)).toEqual(['url', 'provider'])
    expect(schemas.list_web_fetch_providers).toMatchObject({
      description: 'List the providers web_fetch_enhanced accepts, with who receives the URL and whether each is ready.',
      parameters: { type: 'object', properties: {} },
    })
  })

  it('declare the timeouts and parallel safety', async () => {
    const { ctx } = await host({})
    const action = ctx.tools.get('web_fetch_enhanced')
    const list = ctx.tools.get('list_web_fetch_providers')
    expect(action?.timeoutMs).toBe(130_000)
    expect(list?.timeoutMs).toBeUndefined()
    expect(action?.isConcurrencySafe?.({ url: 'https://example.com', provider: 'builtin:local' })).toBe(true)
    expect(list?.isConcurrencySafe?.({})).toBe(true)
  })
})

describe('arguments', () => {
  it('refuses unknown properties and a blank URL before any access', async () => {
    const ready = vi.fn(async (): Promise<ReadyProviders> => ({ kind: 'read', ids: [] }))
    const { run } = await host({ ready })
    expect(failure(await run('web_fetch_enhanced', { url: 'https://example.com', provider: 'builtin:local', timeoutMs: 1 }))?.message).toBe('invalid arguments: unknown property')
    expect(failure(await run('web_fetch_enhanced', { url: '  ', provider: 'nope' }))?.message).toBe('invalid arguments: url must be a non-empty string')
    expect(failure(await run('list_web_fetch_providers', { all: true }))?.message).toBe('invalid arguments: unknown property')
    expect(ready).not.toHaveBeenCalled()
  })

  it('words a blank URL exactly as tool-web does, behind the argument-error prefix', async () => {
    const { run } = await host({})
    const native = failure(await run('web_fetch', { url: '  ' }))
    const enhanced = failure(await run('web_fetch_enhanced', { url: '  ', provider: 'builtin:local' }))
    expect(enhanced?.message).toBe(`invalid arguments: ${native?.message}`)
  })

  it('names the ready providers for a malformed provider', async () => {
    const { run } = await host({ ready: async () => ({ kind: 'read', ids: ['builtin:local'] }) })
    expect(failure(await run('web_fetch_enhanced', { url: 'https://example.com', provider: 'local' }))?.message)
      .toBe('invalid arguments: provider must be an id such as builtin:<key> or custom:<name>; ready providers: builtin:local')
  })

  it('refuses a call without an Agent', async () => {
    const { run } = await host({})
    expect(failure(await run('web_fetch_enhanced', { url: 'https://example.com', provider: 'builtin:local' }, { agent: undefined }))?.message).toBe('web_fetch_enhanced can only be called by an Agent')
    expect(failure(await run('list_web_fetch_providers', {}, { agent: undefined }))?.message).toBe('list_web_fetch_providers can only be called by an Agent')
  })
})

describe('fetch', () => {
  it('runs the URL once on the named provider as the calling Agent', async () => {
    const runAccess = vi.fn(async (_id: string, _request: WebFetchRequest, _call: ExplicitCall) => done({ url: 'https://example.com/final', statusCode: 404, body: { kind: 'text', content: '' }, truncated: false }))
    const { run, agent } = await host({ run: runAccess })
    const result = await run('web_fetch_enhanced', { url: 'https://example.com/a', provider: 'builtin:firecrawl' })
    expect(runAccess).toHaveBeenCalledTimes(1)
    expect(runAccess.mock.calls[0]?.slice(0, 2)).toEqual(['builtin:firecrawl', { url: 'https://example.com/a' }])
    expect(runAccess.mock.calls[0]?.[2].agent).toBe(agent)
    expect(result.value).toEqual({ provider: 'builtin:firecrawl', url: 'https://example.com/final', statusCode: 404, body: { kind: 'text', content: '' }, truncated: false })
  })

  it('hints a backend failure, but not local URL problems, local allowlist refusals or cancellation', async () => {
    const thrown = (error: WebError) => async () => { throw error }
    const remote = await host({ run: thrown(new WebError('dsh-web-fetch-enhanced: Tinyfish refused the URL as invalid or not allowed\n\nTinyfish responded (untrusted): invalid_url', 'WEB_INVALID_URL')) })
    expect(failure(await remote.run('web_fetch_enhanced', { url: 'https://example.com', provider: 'builtin:tinyfish' }))?.message)
      .toBe('dsh-web-fetch-enhanced: Tinyfish refused the URL as invalid or not allowed. Provider "builtin:tinyfish" failed; list_web_fetch_providers shows the others.\n\nTinyfish responded (untrusted): invalid_url')
    const local = await host({ run: thrown(new WebError('URL scheme must be http or https', 'WEB_INVALID_URL')) })
    const invalid = failure(await local.run('web_fetch_enhanced', { url: 'ftp://example.com', provider: 'builtin:local' }))
    expect(invalid?.message).toBe('URL scheme must be http or https')
    expect(invalid?.info).toMatchObject({ code: 'WEB_INVALID_URL' })
    const blocked = await host({ run: thrown(new WebError('dsh-web-fetch-enhanced: blocked by the allowlist; ask the operator', 'WEB_BLOCKED_URL')) })
    const refused = failure(await blocked.run('web_fetch_enhanced', { url: 'http://10.0.0.1', provider: 'builtin:local' }))
    expect(refused?.message).toBe('dsh-web-fetch-enhanced: blocked by the allowlist; ask the operator')
    expect(refused?.info).toMatchObject({ code: 'WEB_BLOCKED_URL' })
    // A remote service's own refusal of the target is worth another provider.
    const remoteBlocked = await host({ run: thrown(new WebError('dsh-web-fetch-enhanced: Crawl refused the target', 'WEB_BLOCKED_URL')) })
    expect(failure(await remoteBlocked.run('web_fetch_enhanced', { url: 'http://10.0.0.1', provider: 'custom:crawl' }))?.message)
      .toBe('dsh-web-fetch-enhanced: Crawl refused the target. Provider "custom:crawl" failed; list_web_fetch_providers shows the others.')
    const aborted = await host({ run: thrown(new WebError('dsh-web-fetch-enhanced: request aborted', 'WEB_ABORTED')) })
    expect(failure(await aborted.run('web_fetch_enhanced', { url: 'https://example.com', provider: 'builtin:exa' }))?.message).toBe('dsh-web-fetch-enhanced: request aborted')
  })

  it('words refusals', async () => {
    const { run } = await host({ run: async () => ({ kind: 'rejected', reason: { kind: 'unknown', connectionId: 'builtin:exa', ready: { kind: 'read', ids: ['builtin:local'] } } }) })
    const error = failure(await run('web_fetch_enhanced', { url: 'https://example.com', provider: 'builtin:exa' }))
    expect(error?.message).toBe('dsh-web-fetch-enhanced: unknown provider "builtin:exa"; ready providers: builtin:local. Providers added or turned on after this conversation started are available only in new conversations.')
    expect(error?.info).toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
  })
})

describe('byte parity with tool-web web_fetch', () => {
  const pages: Record<string, WebFetchResult> = {
    html: { url: 'https://example.com/html', statusCode: 200, body: { kind: 'html', content: '<h1>Title</h1><p>Body <a href="/x">link</a></p><script>evil()</script>' }, truncated: false },
    text: { url: 'https://example.com/text', statusCode: 503, body: { kind: 'text', content: '# Markdown\n\nfrom a service' }, truncated: true },
    large: { url: 'https://example.com/large', statusCode: 200, body: { kind: 'text', content: 'x'.repeat(250_000) }, truncated: false },
  }

  for (const [name, page] of Object.entries(pages)) {
    it(`differs only by the provider line for a ${name} page`, async () => {
      const { run } = await host({ run: async () => done(page) }, async () => page)
      const native = await run('web_fetch', { url: page.url })
      const enhanced = await run('web_fetch_enhanced', { url: page.url, provider: 'builtin:exa' })
      expect(native.isError).toBe(false)
      expect(text(enhanced)).toBe(`Provider: builtin:exa\n\n${text(native)}`)
      expect(JSON.stringify(enhanced.meta)).toBe(JSON.stringify(native.meta))
      expect(enhanced.value).toEqual({ provider: 'builtin:exa', ...native.value as object })
    })
  }
})

describe('list_web_fetch_providers', () => {
  const notice = 'The operator has authorized this provider to reach non-public addresses within [10.0.0.0/8]. All other URL, DNS, redirect, and transport safety checks still apply.'
  const listing: ProviderListing<FetchOptions> = {
    session: { connectionId: 'builtin:exa', selectable: false },
    options: {},
    providers: [
      { id: 'builtin:local', name: 'Local HTTP', facts: { use: undefined, recipient: { kind: 'this-machine' }, notice }, status: 'ready' },
      { id: 'custom:docs', name: 'Docs', facts: { use: undefined, recipient: { kind: 'service', service: 'Tinyfish', host: 'fetch.docs.example' } }, status: 'needs-credential', credential: 'api-key' },
    ],
  }

  it('returns the canonical value and its text', async () => {
    const { run } = await host({ list: async () => ({ kind: 'done', value: listing }) })
    const result = await run('list_web_fetch_providers', {})
    expect(result.value).toEqual({
      sessionProvider: 'builtin:exa',
      sessionProviderTurnedOff: true,
      providers: [
        { id: 'builtin:local', name: 'Local HTTP', sendsTo: 'this machine', notice, status: 'ready' },
        { id: 'custom:docs', name: 'Docs', sendsTo: 'fetch.docs.example', status: 'needs-key' },
      ],
    })
    expect(text(result)).toBe([
      `builtin:local — Local HTTP · ready · fetches from this machine · ${notice}`,
      'custom:docs — Docs · needs an API key (ask the user) · URLs go to fetch.docs.example',
      "This session's selection, builtin:exa, is turned off; web_fetch will fail until the user changes it.",
    ].join('\n'))
  })

  it('words refusals', async () => {
    const { run } = await host({ list: async () => ({ kind: 'rejected', reason: { kind: 'off' }, ready: [] }) })
    expect(failure(await run('list_web_fetch_providers', {}))?.message).toBe('dsh-web-fetch-enhanced: web fetch is off for this session; only the user can turn it back on (composer menu). Do not retry.')
  })
})
