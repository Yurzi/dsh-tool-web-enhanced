/** web_search_enhanced and list_web_search_providers over a stand-in EnhancedAccess, next to the real tool-web web_search. */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import WebRuntime, { WebError, type WebSearchRequest, type WebSearchResult } from '@deepseek-ai/dsh-web'
import type { EnhancedAccess, Explicit, ExplicitCall, ProviderListing, ReadyProviders } from 'dsh-tool-web-enhanced-core/host'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchOptions } from '../src/host/options.ts'
import { searchEnhanced } from '../src/tools/index.ts'

type Access = EnhancedAccess<SearchOptions, WebSearchRequest, WebSearchResult>
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const done = (value: WebSearchResult): Explicit<WebSearchResult> => ({ kind: 'done', value })
const unexpected = () => { throw new Error('unexpected access') }

/** Real tool registry and Agent; the enhanced definitions over `access`, the native web_search over `provider`. */
async function host(access: Partial<Access>, provider: (request: WebSearchRequest) => Promise<WebSearchResult> = unexpected) {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop)
  await ctx.plugin(WebRuntime, {})
  await ctx.plugin({ inject: ['web'], apply: (scope: Context) => { scope.web.registerSearchProvider({ id: 'fake', available: () => true, search: provider }) } })
  await ctx.plugin({ inject: ['tools', 'web', 'systemPrompt'], apply: (scope: Context) => ToolWeb.apply(scope, ToolWeb.Config({ fetch: false })) })
  await ctx.fiber.await()
  const tools = searchEnhanced(ctx).tools({ run: unexpected, list: unexpected, ready: unexpected, ...access })
  ctx.tools.register(tools.action)
  ctx.tools.register(tools.list)
  const handle = await ctx.agents.create({ sessionId: SessionId('s'), agentOptions: { provider: 'fixture', model: 'fixture' } })
  cleanups.push(() => handle.dispose())
  const { agent } = handle
  let calls = 0
  const run = (name: string, args: Record<string, unknown>, options: { agent?: Agent | undefined; signal?: AbortSignal } = { agent }) =>
    ctx.tools.execute({ callId: ToolCallId(`c${++calls}`), name, arguments: args, ...options.agent === undefined ? {} : { agent: options.agent }, signal: options.signal ?? new AbortController().signal })
  return { ctx, agent, run }
}

const text = (result: ToolExecutionResult) => (result.content[0] as { text: string }).text
const failure = (result: ToolExecutionResult) => {
  expect(result.isError).toBe(true)
  return result.isError ? result.error : undefined
}

const sources = (site: string, count: number) => Array.from({ length: count }, (_, index) => ({ url: `https://${site}/${index}`, title: `${site} ${index}`, snippet: `s${index}` }))

describe('definitions', () => {
  it('match the design text, with the native argument first and provider last', async () => {
    const { ctx } = await host({})
    const schemas = Object.fromEntries(ctx.tools.schemas().map(schema => [schema.name, schema]))
    expect(schemas.web_search_enhanced).toMatchObject({
      description: 'Search the web through a provider you choose. Use web_search unless you need a specific provider: one the user named, a specialized index, or another after web_search fails.',
      parameters: {
        type: 'object',
        properties: {
          queries: { type: 'array', items: { type: 'string' }, description: '1–4 search queries; their results are merged.' },
          provider: { type: 'string', description: 'Provider id exactly as listed by list_web_search_providers.' },
        },
        required: ['queries', 'provider'],
      },
    })
    const parameters = schemas.web_search_enhanced?.parameters as { properties: object }
    expect(Object.keys(parameters.properties)).toEqual(['queries', 'provider'])
    expect(schemas.list_web_search_providers).toMatchObject({
      description: 'List the providers web_search_enhanced accepts, with what each is for and whether it is ready.',
      parameters: { type: 'object', properties: {} },
    })
  })

  it('declare the timeouts and parallel safety', async () => {
    const { ctx } = await host({})
    const action = ctx.tools.get('web_search_enhanced')
    const list = ctx.tools.get('list_web_search_providers')
    expect(action?.timeoutMs).toBe(100_000)
    expect(list?.timeoutMs).toBeUndefined()
    expect(action?.isConcurrencySafe?.({ queries: ['q'], provider: 'builtin:exa' })).toBe(true)
    expect(list?.isConcurrencySafe?.({})).toBe(true)
  })
})

describe('arguments', () => {
  it('refuses unknown properties, then malformed queries, before any access', async () => {
    const ready = vi.fn(async (): Promise<ReadyProviders> => ({ kind: 'read', ids: [] }))
    const { run } = await host({ ready })
    expect(failure(await run('web_search_enhanced', { queries: ['q'], provider: 'builtin:exa', note: 'x' }))?.message).toBe('invalid arguments: unknown property')
    expect(failure(await run('list_web_search_providers', { verbose: true }))?.message).toBe('invalid arguments: unknown property')
    expect(failure(await run('web_search_enhanced', { queries: [], provider: 'bad' }))?.message).toBe('invalid arguments: queries must contain at least one query')
    expect(failure(await run('web_search_enhanced', { queries: ['a', 'b', 'c', 'd', 'e'], provider: 'builtin:exa' }))?.message).toBe('invalid arguments: queries must contain at most 4 queries')
    expect(failure(await run('web_search_enhanced', { queries: ['a', '  '], provider: 'builtin:exa' }))?.message).toBe('invalid arguments: each query must be a non-empty string')
    expect(failure(await run('web_search_enhanced', { queries: ['a'] }))?.message).toBe('invalid arguments: missing required property "provider"')
    expect(ready).not.toHaveBeenCalled()
  })

  it('words query problems exactly as tool-web does, behind the argument-error prefix', async () => {
    const { run } = await host({})
    for (const queries of [[], ['a', 'b', 'c', 'd', 'e'], ['a', ' \t ']]) {
      const native = failure(await run('web_search', { queries }))
      const enhanced = failure(await run('web_search_enhanced', { queries, provider: 'builtin:exa' }))
      expect(enhanced?.message).toBe(`invalid arguments: ${native?.message}`)
    }
  })

  it('names the ready providers for a malformed provider, never echoing it', async () => {
    const ready = vi.fn(async (_call: ExplicitCall): Promise<ReadyProviders> => ({ kind: 'read', ids: ['builtin:deepseek-messages', 'builtin:exa'] }))
    const { run, agent } = await host({ ready })
    const error = failure(await run('web_search_enhanced', { queries: ['q'], provider: 'Exa<script>' }))
    expect(error?.message).toBe('invalid arguments: provider must be an id such as builtin:<key> or custom:<name>; ready providers: builtin:deepseek-messages, builtin:exa')
    expect(ready.mock.calls[0]?.[0].agent).toBe(agent)
  })

  it('refuses a call without an Agent instead of using a default connection', async () => {
    const run = vi.fn()
    const list = vi.fn()
    const { run: execute } = await host({ run, list })
    expect(failure(await execute('web_search_enhanced', { queries: ['q'], provider: 'builtin:exa' }, { agent: undefined }))?.message).toBe('web_search_enhanced can only be called by an Agent')
    expect(failure(await execute('list_web_search_providers', {}, { agent: undefined }))?.message).toBe('list_web_search_providers can only be called by an Agent')
    expect(run).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
  })
})

describe('search', () => {
  it('runs each distinct query once, concurrently, as the calling Agent with at most 8 sources', async () => {
    const pending = new Map<string, ReturnType<typeof deferred<Explicit<WebSearchResult>>>>()
    const started = deferred<void>()
    const runAccess = vi.fn((_id: string, request: WebSearchRequest, _call: ExplicitCall) => {
      const next = deferred<Explicit<WebSearchResult>>()
      pending.set(request.query, next)
      if (pending.size === 2) started.resolve()
      return next.promise
    })
    const { run, agent } = await host({ run: runAccess })
    const result = run('web_search_enhanced', { queries: ['alpha', 'beta', 'alpha'], provider: 'builtin:exa' })
    await started.promise
    expect(runAccess.mock.calls.map(([id, request, call]) => [id, request, call.agent])).toEqual([
      ['builtin:exa', { query: 'alpha', maxResults: 8 }, agent],
      ['builtin:exa', { query: 'beta', maxResults: 8 }, agent],
    ])
    pending.get('beta')?.resolve(done({ sources: sources('b', 1), truncated: false }))
    pending.get('alpha')?.resolve(done({ sources: sources('a', 1), truncated: false }))
    const value = (await result).value as { provider: string; sources: Array<{ url: string }> }
    expect(value.provider).toBe('builtin:exa')
    expect(value.sources.map(source => source.url)).toEqual(['https://a/0', 'https://b/0'])
  })

  it('caps each result before merging, as the seam does for web_search', async () => {
    const { run } = await host({ run: async (_id, request) => done({ sources: [{ url: 'https://shared/x' }, ...sources(request.query, 12)], truncated: false }) })
    const single = (await run('web_search_enhanced', { queries: ['one'], provider: 'builtin:exa' })).value as { sources: unknown[]; truncated: boolean }
    expect(single.sources).toHaveLength(8)
    expect(single.truncated).toBe(true)
    const merged = (await run('web_search_enhanced', { queries: ['a', 'b'], provider: 'builtin:exa' })).value as { sources: Array<{ url: string }>; truncated: boolean }
    // Rank 0: the shared URL once, then a/0 and b/0 in turn; the cut at 8 drops later ranks.
    expect(merged.sources.map(source => source.url)).toEqual(['https://shared/x', 'https://a/0', 'https://b/0', 'https://a/1', 'https://b/1', 'https://a/2', 'https://b/2', 'https://a/3'])
    expect(merged.truncated).toBe(true)
  })

  it('aborts the other queries on the first failure and reports it, hinted, once all have settled', async () => {
    const beta = deferred<Explicit<WebSearchResult>>()
    const aborted = deferred<void>()
    const events: string[] = []
    const { run } = await host({
      run: async (_id, request, call) => {
        if (request.query === 'alpha') throw new WebError('dsh-web-search-enhanced: Exa failed (HTTP 500)\n\nExa responded (untrusted): nope', 'WEB_PROVIDER_ERROR')
        call.signal.addEventListener('abort', () => { aborted.resolve() }, { once: true })
        return beta.promise
      },
    })
    const result = run('web_search_enhanced', { queries: ['alpha', 'beta'], provider: 'builtin:exa' }).then(outcome => { events.push('tool settled'); return outcome })
    await aborted.promise
    await new Promise(setImmediate)
    events.push('beta settled')
    beta.reject(new WebError('dsh-web-search-enhanced: request aborted', 'WEB_ABORTED'))
    const error = failure(await result)
    expect(events).toEqual(['beta settled', 'tool settled'])
    expect(error?.message).toBe('dsh-web-search-enhanced: Exa failed (HTTP 500). Provider "builtin:exa" failed; list_web_search_providers shows the others.\n\nExa responded (untrusted): nope')
    expect(error?.info).toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })

  it('reports a refusal in core wording without the hint', async () => {
    const { run } = await host({ run: async () => ({ kind: 'rejected', reason: { kind: 'removed', connectionId: 'custom:lab', ready: { kind: 'read', ids: ['builtin:deepseek-messages', 'custom:lab'] } } }) })
    const error = failure(await run('web_search_enhanced', { queries: ['q'], provider: 'custom:lab' }))
    expect(error?.message).toBe('dsh-web-search-enhanced: provider "custom:lab" was removed by the user; ready providers: builtin:deepseek-messages')
    expect(error?.info).toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
    const off = await host({ run: async () => ({ kind: 'rejected', reason: { kind: 'off' }, ready: [] }) })
    expect(failure(await off.run('web_search_enhanced', { queries: ['q'], provider: 'builtin:exa' }))?.message).not.toContain('list_web_search_providers')
  })

  it('keeps the execution layer wording and leaves cancellation unhinted', async () => {
    const { run } = await host({ run: async () => { throw new WebError('dsh-web-search-enhanced: request aborted', 'WEB_ABORTED') } })
    expect(failure(await run('web_search_enhanced', { queries: ['q'], provider: 'builtin:exa' }))?.message).toBe('dsh-web-search-enhanced: request aborted')
    const connection = await host({ run: async () => { throw new WebError('dsh-web-search-enhanced: the session model cannot run web search: no session model is available; choose another search connection', 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE') } })
    expect(failure(await connection.run('web_search_enhanced', { queries: ['q'], provider: 'builtin:session-model' }))?.message)
      .toBe('dsh-web-search-enhanced: the session model cannot run web search: no session model is available; choose another search connection. Provider "builtin:session-model" failed; list_web_search_providers shows the others.')
  })
})

describe('byte parity with tool-web web_search', () => {
  const answers = (request: WebSearchRequest): WebSearchResult => {
    if (request.query === 'empty') return { sources: [], truncated: false }
    if (request.query === 'blank answer') return { content: '', sources: sources('blank', 2), truncated: false }
    return { content: `answer for ${request.query}`, sources: [{ url: 'https://shared/x', title: 'shared' }, ...sources(request.query, 9), { url: 'https://dated/0', publishedAt: '2026-01-02' }], truncated: false }
  }

  for (const queries of [['alpha'], ['alpha', 'beta', 'alpha'], ['empty'], ['blank answer'], ['empty', 'alpha']]) {
    it(`differs only by the provider line for ${JSON.stringify(queries)}`, async () => {
      const { run } = await host({ run: async (_id, request) => done(answers(request)) }, async request => answers(request))
      const native = await run('web_search', { queries })
      const enhanced = await run('web_search_enhanced', { queries, provider: 'custom:lab' })
      expect(native.isError).toBe(false)
      expect(text(enhanced)).toBe(`Provider: custom:lab\n\n${text(native)}`)
      expect(enhanced.meta).toEqual(native.meta)
      expect(JSON.stringify(enhanced.meta)).toBe(JSON.stringify(native.meta))
      expect(enhanced.value).toEqual({ provider: 'custom:lab', ...native.value as object })
    })
  }
})

describe('list_web_search_providers', () => {
  const listing: ProviderListing<SearchOptions> = {
    session: { connectionId: 'builtin:deepseek-messages', selectable: true },
    options: { freshness: 'realtime' },
    providers: [
      { id: 'builtin:deepseek-messages', name: 'DeepSeek Messages', facts: { use: 'answers with a summary and sources', recipient: { kind: 'service', service: 'DeepSeek Messages', host: undefined }, appliesFreshness: false }, status: 'ready' },
      { id: 'builtin:exa', name: 'Exa', facts: { use: undefined, recipient: { kind: 'service', service: 'Exa', host: undefined }, appliesFreshness: true }, status: 'needs-credential', credential: 'api-key' },
    ],
  }

  it('returns the canonical value and its text as the calling Agent', async () => {
    const list = vi.fn(async (_call: ExplicitCall): Promise<Explicit<ProviderListing<SearchOptions>>> => ({ kind: 'done', value: listing }))
    const { run, agent } = await host({ list })
    const result = await run('list_web_search_providers', {})
    expect(list.mock.calls[0]?.[0].agent).toBe(agent)
    expect(result.value).toEqual({
      sessionProvider: 'builtin:deepseek-messages',
      sessionProviderTurnedOff: false,
      freshness: 'realtime',
      providers: [
        { id: 'builtin:deepseek-messages', name: 'DeepSeek Messages', use: 'answers with a summary and sources', sendsTo: 'DeepSeek Messages', appliesFreshness: false, status: 'ready' },
        { id: 'builtin:exa', name: 'Exa', sendsTo: 'Exa', appliesFreshness: true, status: 'needs-key' },
      ],
    })
    expect(text(result)).toBe([
      'The user asked for uncached (fresh) page content; only providers marked "uncached" apply it.',
      'builtin:deepseek-messages — DeepSeek Messages · ready · selected for this session · answers with a summary and sources',
      'builtin:exa — Exa · needs an API key (ask the user) · uncached',
    ].join('\n'))
  })

  it('words refusals and passes core errors through', async () => {
    const withdrawn = await host({ list: async () => ({ kind: 'rejected', reason: { kind: 'withdrawn' }, ready: [] }) })
    expect(failure(await withdrawn.run('list_web_search_providers', {}))?.message).toBe('dsh-web-search-enhanced: web_search_enhanced is unavailable now; use web_search.')
    const unreadable = new WebError('dsh-web-search-enhanced: provider availability could not be read; retry the request', 'WEB_PROVIDER_ERROR')
    const failing = await host({ list: async () => { throw unreadable } })
    expect(failure(await failing.run('list_web_search_providers', {}))?.message).toBe(unreadable.message)
  })
})
