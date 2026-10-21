import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { MemoryCredentials } from './fixtures/credentials.ts'
import DeepSeekAccount from '@deepseek-ai/dsh-deepseek-account'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { WebError, type WebSearchProvider } from '@deepseek-ai/dsh-web'
import { DEEPSEEK_DEFAULT_BASE_URL, DEEPSEEK_DEFAULT_MODEL, DeepSeekSearchProvider } from '@deepseek-ai/dsh-web-search-deepseek'
import { DEEPSEEK_WEB_API_BASE_URL, DeepSeekSearchApiProvider } from '@deepseek-ai/dsh-web-deepseek-api'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { nativeAuth, nativeBackend, restateNativeError } from '../src/backends/common.ts'
import { executeSearch } from '../src/search/execute.ts'
import { messagesOptions } from '../src/backends/deepseek-messages.ts'
import { searchApiOptions } from '../src/backends/deepseek-search-api.ts'
import { createNativeBackend, type NativeOverrides } from '../src/backends/native.ts'


class NetworkAccount extends DeepSeekAccount {
  override async resolveToken(endpoint: string) { return (await fetch(endpoint)).text() }
  override getState(): never { throw new Error('account state not used') }
  override getProfile(): never { throw new Error('account profile not used') }
  override getBalance(): never { throw new Error('account balance not used') }
  override getUnnotifiedBonuses(): never { throw new Error('account bonuses not used') }
  override ackBonusNotified(): never { throw new Error('account bonuses not used') }
  override startSignIn(): never { throw new Error('account sign-in not used') }
  override cancelSignIn(): never { throw new Error('account sign-in not used') }
  override signOut(): never { throw new Error('account sign-out not used') }
  override watch(): never { throw new Error('account watch not used') }
  override rejectToken(): never { throw new Error('account rejection not used') }
  override getPlatformSession(): never { throw new Error('platform not used') }
  override getDeviceIdentity(): never { throw new Error('identity not used') }
}

const contexts: Context[] = []
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

function context(environment: Record<string, string> = {}): Context {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: environment }]))
  return ctx
}

const overrides = (options: Readonly<Record<string, unknown>> = {}): NativeOverrides => ({ credentialRef: 'DEEPSEEK_API_KEY', options })
const serviceMessage = "dsh-web-search-enhanced: DeepSeek search failed. If every query fails, ask the user to check search connection settings, the API key or DeepSeek account sign-in. Do not retry in a loop."
const missingMessage = 'dsh-web-search-enhanced: DeepSeek search has no API key; ask the user to save the configured credential (DEEPSEEK_API_KEY by default) in search connection settings or use a DeepSeek account model.'
const responded = (detail: string): string => serviceMessage + '\n\nDeepSeek responded (untrusted): ' + detail
const withheld = serviceMessage + "\n\nDeepSeek's response was withheld because it contained this request's credential."


async function securityAccountSession(ctx: Context) {
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop)
  const handle = await ctx.agents.create({ sessionId: SessionId('security-native-search'), agentOptions: { provider: 'deepseek-account', model: 'fixture' } })
  cleanups.push(() => handle.dispose())
  handle.agent.session.append('request/context', { provider: 'deepseek-account', model: 'fixture' })
  return handle.agent
}

async function serve(handler: (incoming: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  const server = createServer(handler)
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  onTestFinished(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => { server.close(error => { if (error === undefined) resolve(); else reject(error) }) })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected TCP address')
  return 'http://127.0.0.1:' + address.port
}


describe.each(['deepseek-messages', 'deepseek-search-api'] as const)('%s per-invocation security', key => {
  it.each(['api-key', 'account'] as const)('withholds actual %s credentials echoed by local service and diagnostics', async access => {
    const secret = 'native-fetch-private-credential'
    let resolves = 0
    let dispatches = 0
    const baseURL = await serve((incoming, response) => {
      if (incoming.method === 'GET') { resolves++; response.end(secret); return }
      dispatches++
      const sent = incoming.headers['x-dsh-auth-token'] ?? incoming.headers.authorization
      response.statusCode = 401
      response.end(JSON.stringify({ error: { message: 'Denied request ' + sent } }))
    })
    const ctx = context({ DEEPSEEK_API_KEY: secret })
    const debug = vi.spyOn(ctx.logger, 'debug').mockImplementation(() => {})
    const agent = access === 'account' ? await securityAccountSession(ctx) : undefined
    if (agent !== undefined) void new NetworkAccount(ctx)
    const backend = createNativeBackend(ctx, key, () => overrides({ baseURL }))
    const pending = agent === undefined ? backend.search({ query: 'q' }) : ctx.agents.withInitiator(agent, () => backend.search({ query: 'q' }))
    const error: unknown = await pending.catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(WebError)
    if (!(error instanceof WebError)) throw new Error('expected WebError')
    expect(error.message).toBe(withheld)
    expect(error.message).not.toMatch(/Denied request|responded|\[redacted\]/)
    expect(error.message).not.toContain(secret)
    expect(error.message).not.toMatch(/Built-in plugin settings|web-deepseek-api/)
    const diagnostic = debug.mock.calls.map(call => call.map(value => value instanceof Error ? value.stack : String(value)).join(' ')).join(' ')
    expect(diagnostic).toContain("diagnostic message withheld: it contained this request's credential")
    expect(diagnostic).not.toContain('Denied request')
    expect(diagnostic).not.toContain(secret)
    expect(dispatches).toBe(1)
    expect(resolves).toBe(access === 'account' ? 1 : 0)
  })

  it.each(['api-key', 'account'] as const)('redacts successful native strings using the actual %s credential', async access => {
    const secret = 'sk-Z1X2C3V4B5N6M7K8J9H0'
    const excerpt = secret.slice(4, 14)
    let dispatches = 0
    const baseURL = await serve((incoming, response) => {
      if (incoming.method === 'GET') { response.end(secret); return }
      dispatches++
      response.setHeader('content-type', 'application/json')
      const payload = key === 'deepseek-search-api'
        ? { results: [{ url: 'https://example.com/page', title: 'Report ' + secret, snippet: excerpt, date: null }] }
        : { content: [
            { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://example.com/page', title: 'Report ' + secret, snippet: excerpt }] },
            { type: 'text', citations: [{ url: 'https://example.com/page', cited_text: excerpt }] },
          ] }
      response.end(JSON.stringify(payload))
    })
    const ctx = context({ DEEPSEEK_API_KEY: secret })
    const agent = access === 'account' ? await securityAccountSession(ctx) : undefined
    if (agent !== undefined) void new NetworkAccount(ctx)
    const backend = createNativeBackend(ctx, key, () => overrides({ baseURL }))
    const result = await (agent === undefined ? backend.search({ query: 'q' }) : ctx.agents.withInitiator(agent, () => backend.search({ query: 'q' })))
    const text = JSON.stringify(result)
    expect(text).toContain('Report [redacted]')
    expect(text).not.toContain(secret)
    expect(text).not.toContain(excerpt)
    expect(dispatches).toBe(1)
  })

  it.each(['api-key', 'account'] as const)('keeps a local %s resolver exception out of service reports and logs', async access => {
    const privateDetail = 'secret-key-at-https://user:password@private.test/config'
    class FailingCredentials extends MemoryCredentials {
      override async resolve(): Promise<never> { throw new Error(privateDetail) }
    }
    class FailingAccount extends NetworkAccount {
      override async resolveToken(): Promise<never> { throw new Error(privateDetail) }
    }
    let dispatches = 0
    const baseURL = await serve((_incoming, response) => { dispatches++; response.end('{}') })
    const ctx = context()
    const debug = vi.spyOn(ctx.logger, 'debug').mockImplementation(() => {})
    const agent = access === 'account' ? await securityAccountSession(ctx) : undefined
    if (agent === undefined) void new FailingCredentials(ctx)
    else void new FailingAccount(ctx)
    const backend = createNativeBackend(ctx, key, () => overrides({ baseURL }))
    const pending = agent === undefined ? backend.search({ query: 'q' }) : ctx.agents.withInitiator(agent, () => backend.search({ query: 'q' }))
    await expect(pending).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    await expect(pending).rejects.not.toThrow(/responded|secret-key|private.test/)
    expect(debug).toHaveBeenCalled()
    expect(debug.mock.calls.map(call => call.map(value => value instanceof Error ? value.stack : String(value)).join(' ')).join(' ')).not.toContain(privateDetail)
    expect(dispatches).toBe(0)
  })

  it('withholds DSH malformed-JSON body excerpts and diagnostic credential fragments', async () => {
    const secret = 'sk-native-long-private-credential-abcdefghijklmno'
    const fragment = secret.slice(12, 22)
    const baseURL = await serve((_incoming, response) => { response.end(fragment + ' !') })
    const ctx = context({ DEEPSEEK_API_KEY: secret })
    const debug = vi.spyOn(ctx.logger, 'debug').mockImplementation(() => {})
    const pending = createNativeBackend(ctx, key, () => overrides({ baseURL })).search({ query: 'q' })
    await expect(pending).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: withheld })
    await expect(pending).rejects.not.toThrow(/unprocessable response body|\[redacted\]/)
    await expect(pending).rejects.not.toThrow(fragment)
    expect(debug.mock.calls.map(call => call.map(value => value instanceof Error ? value.stack : String(value)).join(' ')).join(' ')).not.toContain(fragment)
  })

  it.each(['api-key', 'account'] as const)('isolates concurrent %s credentials and retains the actual value across rotation without rereading', async access => {
    const first = 'sk-A1B2C3D4E5F6G7H8I9J0'
    const second = 'tk-z9y8x7w6v5u4t3s2r1q0'
    let accountValue = first
    let accountReads = 0
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const ctx = context()
    class CountingCredentials extends MemoryCredentials {
      reads = 0
      override async resolve(ref: Parameters<MemoryCredentials['resolve']>[0]) { this.reads++; return super.resolve(ref) }
    }
    const credentials = new CountingCredentials(ctx)
    await credentials.set(credentialRef('FIRST_KEY'), first)
    await credentials.set(credentialRef('SECOND_KEY'), second)
    const agent = access === 'account' ? await securityAccountSession(ctx) : undefined
    if (agent !== undefined) void new NetworkAccount(ctx)
    const baseURL = await serve((incoming, response) => {
      if (incoming.method === 'GET') { accountReads++; response.end(accountValue); return }
      const sent = String(incoming.headers['x-dsh-auth-token'] ?? incoming.headers.authorization)
      if (sent.includes(first)) {
        entered.resolve()
        void release.promise.then(() => { response.statusCode = 401; response.end(JSON.stringify({ error: 'Rejected ' + sent })) })
      } else { response.statusCode = 500; response.end(JSON.stringify({ error: 'Rejected ' + sent })) }
    })
    let current = { credentialRef: 'FIRST_KEY', options: { baseURL } }
    const backend = createNativeBackend(ctx, key, () => current)
    const invoke = () => agent === undefined ? backend.search({ query: 'q' }) : ctx.agents.withInitiator(agent, () => backend.search({ query: 'q' }))
    const pendingFirst = invoke().catch((error: unknown) => error)
    await entered.promise
    await credentials.set(credentialRef('FIRST_KEY'), 'rotated-value-must-not-be-reread')
    accountValue = second
    current = { credentialRef: 'SECOND_KEY', options: { baseURL } }
    const secondError: unknown = await invoke().catch((error: unknown) => error)
    release.resolve()
    const firstError = await pendingFirst
    for (const error of [firstError, secondError]) {
      expect(error).toBeInstanceOf(WebError)
      if (!(error instanceof WebError)) throw new Error('expected WebError')
      expect(error.message).toBe(withheld)
      expect(error.message).not.toContain('Rejected')
      expect(error.message).not.toContain(first)
      expect(error.message).not.toContain(second)
    }
    expect(credentials.reads).toBe(access === 'account' ? 0 : 2)
    expect(accountReads).toBe(access === 'account' ? 2 : 0)
  })
})

describe('native credential and option resolution', () => {
  it.each([undefined, 'stored-key'] as const)('treats a present credential service as authoritative (%s)', async value => {
    const ctx = context({ DEEPSEEK_API_KEY: 'ambient-must-not-win' })
    const credentials = new MemoryCredentials(ctx)
    if (value !== undefined) await credentials.set(credentialRef('DEEPSEEK_API_KEY'), value)
    await expect(nativeAuth(ctx, 'DEEPSEEK_API_KEY').resolveApiKey()).resolves.toBe(value)
    await credentials.set(credentialRef('DEEPSEEK_API_KEY'), 'rotated-key')
    await expect(nativeAuth(ctx, 'DEEPSEEK_API_KEY').resolveApiKey()).resolves.toBe('rotated-key')
  })

  it.each([
    ['deepseek-account', true], ['deepseek-account', false], ['other-provider', true], ['other-provider', false],
  ] as const)('resolves an account token only for an account Session (%s, service: %s)', async (provider, hasAccount) => {
    const ctx = context()
    await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
    await ctx.plugin(Projections)
    await ctx.plugin(AgentLoop)
    if (hasAccount) void new NetworkAccount(ctx)
    const handle = await ctx.agents.create({ sessionId: SessionId('native-auth'), agentOptions: { provider, model: 'fixture' } })
    cleanups.push(() => handle.dispose())
    handle.agent.session.append('request/context', { provider, model: 'fixture' })
    expect(handle.agent.session.requestContext()).toMatchObject({ provider })
    const network = vi.fn(async () => new Response('account-token'))
    vi.stubGlobal('fetch', network)
    const endpoint = 'https://api.deepseek.com/v1/tools/search'
    const auth = nativeAuth(ctx, 'DEEPSEEK_API_KEY')
    await expect(auth.resolveAccountToken(endpoint)).resolves.toBeUndefined()
    const expected = provider === 'deepseek-account' && hasAccount ? 'account-token' : undefined
    await expect(ctx.agents.withInitiator(handle.agent, () => auth.resolveAccountToken(endpoint))).resolves.toBe(expected)
    if (expected === undefined) expect(network).not.toHaveBeenCalled()
    else expect(network).toHaveBeenCalledExactlyOnceWith(endpoint)
  })
  it.each([
    [{ DEEPSEEK_API_KEY: 'default-key' }, 'DEEPSEEK_API_KEY', 'default-key'],
    [{ SEARCH_KEY: 'custom-key' }, 'SEARCH_KEY', 'custom-key'],
    [{ DEEPSEEK_API_KEY: '' }, 'DEEPSEEK_API_KEY', undefined],
    [{}, 'DEEPSEEK_API_KEY', undefined],
  ] as const)('resolves the launch credential plane without a credential service (%s)', async (environment, ref, expected) => {
    const auth = nativeAuth(context(environment), ref)
    expect(auth.apiKeyEnv).toBe(ref)
    await expect(auth.resolveApiKey()).resolves.toBe(expected)
    await expect(auth.resolveAccountToken('https://api.deepseek.com/v1/tools/search')).resolves.toBeUndefined()
  })

  it('preserves the native endpoint difference: only Messages reads DEEPSEEK_SEARCH_BASE_URL', () => {
    const ctx = context({ DEEPSEEK_BASE_URL: 'https://conversation.test', DEEPSEEK_SEARCH_BASE_URL: 'https://messages.test/base' })
    expect(messagesOptions(ctx, overrides()).baseURL).toBe('https://messages.test/base')
    expect(searchApiOptions(ctx, overrides()).baseURL).toBe(DEEPSEEK_WEB_API_BASE_URL)
    expect(messagesOptions(context(), overrides()).baseURL).toBe(DEEPSEEK_DEFAULT_BASE_URL)
    expect(messagesOptions(ctx, overrides({ baseURL: 'https://operator.test/base' })).baseURL).toBe('https://operator.test/base')
    expect(searchApiOptions(ctx, overrides({ baseURL: 'https://operator.test/api' })).baseURL).toBe('https://operator.test/api')
  })

  it('projects all Messages and Search API operator options without imposing new limits', () => {
    const ctx = context()
    expect(messagesOptions(ctx, overrides({ model: 'chosen', apiVersion: 'v-next', maxTokens: 20_000, maxUses: 100 }))).toMatchObject({
      model: 'chosen', apiVersion: 'v-next', maxTokens: 20_000, maxUses: 100,
    })
    expect(messagesOptions(ctx, overrides()).model).toBe(DEEPSEEK_DEFAULT_MODEL)
    expect(searchApiOptions(ctx, overrides({ count: 23, sendOriginalQuestion: false }))).toMatchObject({ count: 23 })
    expect(searchApiOptions(ctx, overrides({ sendOriginalQuestion: false })).originalQuestion).toBeUndefined()
    expect(searchApiOptions(ctx, overrides()).originalQuestion!()).toBeUndefined()
  })

  it.each(['deepseek-messages', 'deepseek-search-api'] as const)('%s uses a changed credential reference on its next call (network mocked)', async key => {
    const ctx = context({ FIRST_KEY: 'first-secret', SECOND_KEY: 'second-secret' })
    let current: NativeOverrides = { credentialRef: 'FIRST_KEY', options: {} }
    const authorization: (string | null)[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      authorization.push(new Headers(init.headers).get('authorization'))
      throw new Error('private network detail')
    }))
    const provider = createNativeBackend(ctx, key, () => current)
    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    current = { credentialRef: 'SECOND_KEY', options: {} }
    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(authorization).toEqual(['Bearer first-secret', 'Bearer second-secret'])
  })

  it.each(['deepseek-messages', 'deepseek-search-api'] as const)('%s reads the credentialRef and options getter for every call, without network on a missing key', async key => {
    const ctx = context()
    let current: NativeOverrides = { credentialRef: 'FIRST_KEY', options: {} }
    let reads = 0
    const provider = createNativeBackend(ctx, key, () => { reads++; return current })
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)
    expect(provider.available()).toBe(true)
    expect(reads).toBe(1)
    await expect(provider.search({ query: 'first' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
    current = { credentialRef: 'SECOND_KEY', options: { baseURL: 'https://other.test/base' } }
    await expect(provider.search({ query: 'second' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
    expect(reads).toBe(3)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('native source boundary', () => {
  const invalidUrls = ['javascript:alert(1)', 'https://user:password@example.com/page', 'https://example.com/' + 'x'.repeat(8195)]
  const valid = { url: 'https://example.com/page', title: ' Page ', snippet: ' Evidence ', publishedAt: '2025-01-02' }
  const normalized = { ...valid, title: 'Page', snippet: 'Evidence', publishedAt: '2025-01-02T00:00:00.000Z' }

  it.each(['deepseek-messages', 'deepseek-search-api'] as const)('%s filters each invalid URL after a real provider response', async key => {
    const ctx = context({ DEEPSEEK_API_KEY: 'fixture-secret' })
    for (const url of invalidUrls) {
      const rows = [valid, { ...valid, url }]
      const payload = key === 'deepseek-search-api'
        ? { results: rows.map(row => ({ ...row, date: row.publishedAt })) }
        : { content: [
            { type: 'web_search_tool_result', content: rows.map(row => ({ type: 'web_search_result', ...row, page_age: row.publishedAt })) },
            { type: 'text', citations: rows.map(row => ({ url: row.url, cited_text: row.snippet })) },
          ] }
      vi.stubGlobal('fetch', async () => Response.json(payload))
      await expect(createNativeBackend(ctx, key, () => overrides()).search({ query: 'q' })).resolves.toEqual({ sources: [normalized], truncated: false })
    }
  })

  it('normalizes an arbitrary native execute target and preserves truncated', async () => {
    const provider: WebSearchProvider = { id: 'fixture', available: () => true, search: async () => ({ sources: [valid, ...invalidUrls.map(url => ({ url }))], truncated: true }) }
    await expect(executeSearch({ kind: 'native', provider }, { query: 'q' }, { credential: async () => undefined })).resolves.toEqual({ sources: [normalized], truncated: true })
  })
})

describe('native errors', () => {
  it('reports a safe native failure copy only through the diagnostic callback', async () => {
    const failure = new Error('private-native-detail')
    const diagnostics: unknown[] = []
    const provider = nativeBackend({ id: 'fixture', available: () => true, search: async () => { throw failure } }, cause => { diagnostics.push(cause) })
    const pending = provider.search({ query: 'q' })
    await expect(pending).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'dsh-web-search-enhanced: DeepSeek search failed; check the connection settings, API key or DeepSeek account sign-in. Do not retry in a loop.' })
    await expect(pending).rejects.not.toHaveProperty('cause')
    await expect(pending).rejects.not.toThrow('private-native-detail')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).not.toBe(failure)
    expect(diagnostics[0]).toMatchObject({ name: 'Error', message: 'private-native-detail' })
    expect(diagnostics[0]).not.toHaveProperty('cause')
  })

  it.each([
    ['WEB_PROVIDER_ERROR', 'WEB_PROVIDER_ERROR', responded('DeepSeek API error (HTTP 403): upstream search detail')],
    ['WEB_PROVIDER_CREDENTIAL_MISSING', 'WEB_PROVIDER_CREDENTIAL_MISSING', missingMessage],
    ['WEB_ABORTED', 'WEB_ABORTED', 'dsh-web-search-enhanced: search aborted'],
    ['UNKNOWN_CODE', 'WEB_PROVIDER_ERROR', responded('DeepSeek API error (HTTP 403): upstream search detail')],
    ['WEB_FETCH_TIMEOUT', 'WEB_PROVIDER_ERROR', responded('DeepSeek API error (HTTP 403): upstream search detail')],
    ['WEB_INVALID_URL', 'WEB_PROVIDER_ERROR', responded('DeepSeek API error (HTTP 403): upstream search detail')],
  ])('restates %s with only the service report and no retired native guidance', async (code, expectedCode, message) => {
    const failure = new WebError('DeepSeek API error (HTTP 403): upstream search detail\n\nBuilt-in plugin settings > web-search-deepseek', code, { cause: new Error('private cause') })
    const error = restateNativeError(failure)
    expect(error).toBeInstanceOf(WebError)
    expect(error).not.toBe(failure)
    expect(error.code).toBe(expectedCode)
    expect(error.message).toBe(message)
    expect(error.message).not.toMatch(/Built-in plugin settings|web-search-deepseek/)
    expect(error.cause).toBeUndefined()
    const provider = createNativeBackend(context(), 'deepseek-search-api', () => { throw failure })
    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({ code: expectedCode, message })
  })

  it('sanitizes only non-WebError values', () => {
    for (const failure of [new Error('secret endpoint'), 'private body']) {
      const error = restateNativeError(failure)
      expect(error.code).toBe('WEB_PROVIDER_ERROR')
      expect(error.message).toBe('dsh-web-search-enhanced: DeepSeek search failed; check the connection settings, API key or DeepSeek account sign-in. Do not retry in a loop.')
      expect(error.cause).toBeUndefined()
    }
  })

  describe.each(['deepseek-messages', 'deepseek-search-api'] as const)('%s native failures', key => {
    it.each([
      ['transport', 200, undefined],
      ['HTTP JSON', 403, JSON.stringify({ error: { message: 'upstream search detail' } })],
      ['HTTP text', 502, 'upstream gateway detail'],
      ['malformed JSON', 200, '{invalid'],
    ] as const)('reports a real provider %s error without retired guidance over local HTTP', async (_kind, status, body) => {
      let calls = 0
      const server = createServer((incoming, response) => {
        calls++
        if (body === undefined) { incoming.socket.destroy(); return }
        response.statusCode = status
        response.end(body)
      })
      await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
      onTestFinished(async () => {
        server.closeAllConnections()
        await new Promise<void>((resolve, reject) => { server.close(error => { if (error === undefined) resolve(); else reject(error) }) })
      })
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('expected TCP address')
      const settings = overrides({ baseURL: 'http://127.0.0.1:' + address.port })
      const ctx = context({ DEEPSEEK_API_KEY: 'fixture-secret' })
      const upstream = key === 'deepseek-messages'
        ? new DeepSeekSearchProvider(() => messagesOptions(ctx, settings))
        : new DeepSeekSearchApiProvider(() => searchApiOptions(ctx, settings))
      const nativeError: unknown = await upstream.search({ query: 'q' }).catch((error: unknown) => error)
      expect(nativeError).toBeInstanceOf(WebError)
      if (!(nativeError instanceof WebError)) throw new Error('expected native WebError')
      if (status === 403) expect(nativeError.message).toContain('upstream search detail')
      const pending = createNativeBackend(ctx, key, () => settings).search({ query: 'q' })
      await expect(pending).rejects.toBeInstanceOf(WebError)
      await expect(pending).rejects.toMatchObject({ code: nativeError.code, message: responded(nativeError.message.split('\n\n')[0]!) })
      await expect(pending).rejects.not.toThrow(/Built-in plugin settings|web-search-deepseek|web-deepseek-api|endpoint configuration/)
      await expect(pending).rejects.not.toHaveProperty('cause')
      expect(calls).toBe(2)
    })

    it('uses plugin cancellation wording without dispatch', async () => {
      const controller = new AbortController()
      const reason = new Error('caller cancellation')
      controller.abort(reason)
      const network = vi.fn<typeof fetch>()
      vi.stubGlobal('fetch', network)
      const pending = createNativeBackend(context(), key, () => overrides()).search({ query: 'q' }, controller.signal)
      await expect(pending).rejects.toMatchObject({
        code: 'WEB_ABORTED', message: 'dsh-web-search-enhanced: search aborted',
      })
      expect(network).not.toHaveBeenCalled()
    })
  })
})
