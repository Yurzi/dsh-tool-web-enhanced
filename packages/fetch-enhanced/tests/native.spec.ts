import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { MemoryCredentials } from './fixtures/credentials.ts'
import DeepSeekAccount from '@deepseek-ai/dsh-deepseek-account'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { WebError } from '@deepseek-ai/dsh-web'
import { DEEPSEEK_WEB_API_BASE_URL, DeepSeekFetchApiProvider } from '@deepseek-ai/dsh-web-deepseek-api'
import { serve } from './fixtures/http.ts'
import { FETCH } from 'dsh-tool-web-enhanced-core/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nativeAuth, restateNativeError } from '../src/backends/common.ts'
import { fetchApiOptions } from '../src/backends/deepseek-fetch-api.ts'
import { createNativeFetchBackend, type NativeOverrides } from '../src/backends/native.ts'

// Public service implementations for the seam; only their outbound network is mocked.
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
const request = { url: 'https://example.com/page' }
const failureMessage = 'DeepSeek fetch failed; ask the user to check fetch connection settings, the API key or DeepSeek account sign-in. Do not retry in a loop.'
const missingMessage = 'DeepSeek fetch has no API key; ask the user to save the configured credential (DEEPSEEK_API_KEY by default) in fetch connection settings or use a DeepSeek account model.'
const serviceMessage = "DeepSeek fetch failed. If every URL fails, ask the user to check fetch connection settings, the API key or DeepSeek account sign-in. Do not retry in a loop."
const responded = (detail: string): string => prefixed(serviceMessage) + '\n\nDeepSeek responded (untrusted): ' + detail
const prefixed = (message: string): string => FETCH.packageName + ': ' + message
const withheld = prefixed(serviceMessage) + "\n\nDeepSeek's response was withheld because it contained this request's credential."

async function accountSession(ctx: Context, provider: string) {
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop)
  const handle = await ctx.agents.create({ sessionId: SessionId('native-fetch-auth'), agentOptions: { provider, model: 'fixture' } })
  cleanups.push(() => handle.dispose())
  handle.agent.session.append('request/context', { provider, model: 'fixture' })
  expect(handle.agent.session.requestContext()).toMatchObject({ provider })
  return handle.agent
}



describe('native fetch per-invocation security', () => {
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
    const agent = access === 'account' ? await accountSession(ctx, 'deepseek-account') : undefined
    if (agent !== undefined) void new NetworkAccount(ctx)
    const backend = createNativeFetchBackend(ctx, () => overrides({ baseURL }))
    const pending = agent === undefined ? backend.fetch(request) : ctx.agents.withInitiator(agent, () => backend.fetch(request))
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
      const payload = { content: 'Report ' + secret + ' excerpt ' + excerpt }
      response.end(JSON.stringify(payload))
    })
    const ctx = context({ DEEPSEEK_API_KEY: secret })
    const agent = access === 'account' ? await accountSession(ctx, 'deepseek-account') : undefined
    if (agent !== undefined) void new NetworkAccount(ctx)
    const backend = createNativeFetchBackend(ctx, () => overrides({ baseURL }))
    const result = await (agent === undefined ? backend.fetch(request) : ctx.agents.withInitiator(agent, () => backend.fetch(request)))
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
    const agent = access === 'account' ? await accountSession(ctx, 'deepseek-account') : undefined
    if (agent === undefined) void new FailingCredentials(ctx)
    else void new FailingAccount(ctx)
    const backend = createNativeFetchBackend(ctx, () => overrides({ baseURL }))
    const pending = agent === undefined ? backend.fetch(request) : ctx.agents.withInitiator(agent, () => backend.fetch(request))
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
    const pending = createNativeFetchBackend(ctx, () => overrides({ baseURL })).fetch(request)
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
    const agent = access === 'account' ? await accountSession(ctx, 'deepseek-account') : undefined
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
    const backend = createNativeFetchBackend(ctx, () => current)
    const invoke = () => agent === undefined ? backend.fetch(request) : ctx.agents.withInitiator(agent, () => backend.fetch(request))
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

describe('native fetch credential and endpoint resolution', () => {
  it.each([undefined, '', 'stored-key'] as const)('treats the credential service as authoritative (%s)', async value => {
    const ctx = context({ DEEPSEEK_API_KEY: 'ambient-must-not-win' })
    const credentials = new MemoryCredentials(ctx)
    const ref = credentialRef('DEEPSEEK_API_KEY')
    if (value !== undefined) await credentials.set(ref, value)
    const auth = nativeAuth(ctx, ref)
    await expect(auth.resolveApiKey()).resolves.toBe(value)
    await credentials.set(ref, 'rotated-key')
    await expect(auth.resolveApiKey()).resolves.toBe('rotated-key')
  })

  it.each([
    [{ DEEPSEEK_API_KEY: 'default-key' }, 'DEEPSEEK_API_KEY', 'default-key'],
    [{ FETCH_KEY: 'custom-key' }, 'FETCH_KEY', 'custom-key'],
    [{ DEEPSEEK_API_KEY: '' }, 'DEEPSEEK_API_KEY', undefined],
    [{}, 'DEEPSEEK_API_KEY', undefined],
  ] as const)('uses the launch credential plane only without the service (%s)', async (environment, ref, expected) => {
    const auth = nativeAuth(context(environment), ref)
    expect(auth.apiKeyEnv).toBe(ref)
    await expect(auth.resolveApiKey()).resolves.toBe(expected)
    await expect(auth.resolveAccountToken(DEEPSEEK_WEB_API_BASE_URL + '/fetch')).resolves.toBeUndefined()
  })

  it('uses the official API base, not chat or Messages environment overrides', () => {
    const ctx = context({ DEEPSEEK_BASE_URL: 'https://chat.test', DEEPSEEK_SEARCH_BASE_URL: 'https://messages.test' })
    expect(fetchApiOptions(ctx, overrides()).baseURL).toBe(DEEPSEEK_WEB_API_BASE_URL)
    expect(fetchApiOptions(ctx, overrides({ baseURL: 'https://operator.test/api' })).baseURL).toBe('https://operator.test/api')
    expect(fetchApiOptions(ctx, overrides()).apiKeyEnv).toBe('DEEPSEEK_API_KEY')
  })

  it.each([
    ['deepseek-account', true, 'account-token'], ['deepseek-account', true, ''],
    ['deepseek-account', false, 'account-token'], ['other-provider', true, 'account-token'],
    ['other-provider', false, 'account-token'],
  ] as const)('uses account headers only on an account Session (%s, service %s, token %s)', async (provider, hasAccount, token) => {
    const ctx = context({ DEEPSEEK_API_KEY: 'api-secret' })
    const agent = await accountSession(ctx, provider)
    if (hasAccount) void new NetworkAccount(ctx)
    const tokenEndpoints: string[] = []
    const headers: Headers[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (init === undefined) {
        tokenEndpoints.push(url)
        return new Response(token)
      }
      headers.push(new Headers(init.headers))
      return Response.json({ content: 'page' })
    })
    const backend = createNativeFetchBackend(ctx, () => overrides({ baseURL: 'https://operator.test/api/' }))
    await expect(nativeAuth(ctx, 'DEEPSEEK_API_KEY').resolveAccountToken('https://outside.test')).resolves.toBeUndefined()
    await ctx.agents.withInitiator(agent, () => backend.fetch(request))
    const usesAccount = provider === 'deepseek-account' && hasAccount && token.length > 0
    expect(headers).toHaveLength(1)
    expect(headers[0]!.get('x-dsh-auth-token')).toBe(usesAccount ? token : null)
    expect(headers[0]!.get('authorization')).toBe(usesAccount ? null : 'Bearer api-secret')
    expect(tokenEndpoints).toEqual(provider === 'deepseek-account' && hasAccount ? ['https://operator.test/api/fetch'] : [])
  })

  it('uses the current request route rather than the Agent default route', async () => {
    const ctx = context({ DEEPSEEK_API_KEY: 'api-secret' })
    const agent = await accountSession(ctx, 'other-provider')
    void new NetworkAccount(ctx)
    agent.session.append('request/context', { provider: 'deepseek-account', model: 'fixture' })
    const network = vi.fn(async () => new Response('account-token'))
    vi.stubGlobal('fetch', network)
    await expect(ctx.agents.withInitiator(agent, () => nativeAuth(ctx, 'DEEPSEEK_API_KEY').resolveAccountToken('https://operator.test/fetch'))).resolves.toBe('account-token')
    expect(network).toHaveBeenCalledExactlyOnceWith('https://operator.test/fetch')
  })

  it('reads operator overrides once per call and forwards the same signal', async () => {
    const ctx = context({ FIRST_KEY: 'first-secret', SECOND_KEY: 'second-secret' })
    let current: NativeOverrides = { credentialRef: 'FIRST_KEY', options: {} }
    const read = vi.fn(() => current)
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return Response.json({ content: 'page' })
    })
    const backend = createNativeFetchBackend(ctx, read)
    const signal = new AbortController().signal
    expect(backend.id).toBe('deepseek-fetch-api')
    expect(backend.available()).toBe(true)
    expect(calls).toHaveLength(0)
    await backend.fetch(request, signal)
    current = { credentialRef: 'SECOND_KEY', options: { baseURL: 'https://operator.test/v2///' } }
    await backend.fetch(request, signal)
    expect(read).toHaveBeenCalledTimes(3)
    expect(calls.map(call => call.url)).toEqual([DEEPSEEK_WEB_API_BASE_URL + '/fetch', 'https://operator.test/v2/fetch'])
    expect(calls.map(call => new Headers(call.init.headers).get('authorization'))).toEqual(['Bearer first-secret', 'Bearer second-secret'])
    for (const { init } of calls) {
      expect(init.redirect).toBe('error')
      expect(init.method).toBe('POST')
      expect(init.body).toBe(JSON.stringify(request))
      expect(init.signal).toBe(signal)
    }
  })

  it('does no I/O in available and never sends a missing credential', async () => {
    const ctx = context({ DEEPSEEK_API_KEY: 'ambient-must-not-win' })
    void new MemoryCredentials(ctx)
    const network = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', network)
    const backend = createNativeFetchBackend(ctx, () => overrides())
    expect(backend.available()).toBe(true)
    await expect(backend.fetch(request)).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING', message: prefixed(missingMessage) })
    expect(network).not.toHaveBeenCalled()
  })
})

describe('native fetch service error reporting', () => {
  it.each([
    ['WEB_PROVIDER_ERROR', 'WEB_PROVIDER_ERROR', responded('DeepSeek API error (HTTP 404): failed to fetch URL')],
    ['WEB_PROVIDER_CREDENTIAL_MISSING', 'WEB_PROVIDER_CREDENTIAL_MISSING', prefixed(missingMessage)],
    ['WEB_ABORTED', 'WEB_ABORTED', prefixed('fetch aborted')],
    ['UNKNOWN', 'WEB_PROVIDER_ERROR', responded('DeepSeek API error (HTTP 404): failed to fetch URL')],
  ])('restates %s without retired native settings guidance or cause', (code, expectedCode, message) => {
    const failure = new WebError('DeepSeek API error (HTTP 404): failed to fetch URL\n\nBuilt-in plugin settings > web-deepseek-api', code, { cause: new Error('private cause') })
    const error = restateNativeError(failure)
    expect(error).toBeInstanceOf(WebError)
    expect(error).not.toBe(failure)
    expect(error.code).toBe(expectedCode)
    expect(error.message).toBe(message)
    expect(error.message).not.toMatch(/Built-in plugin settings|web-deepseek-api/)
    expect(error.cause).toBeUndefined()
  })

  it('sanitizes unexpected thrown values', () => {
    for (const error of [new Error('secret'), 'private']) {
      expect(restateNativeError(error)).toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: prefixed(failureMessage) })
    }
  })

  it('logs unexpected exceptions and exposes only the fixed provider error', async () => {
    const ctx = context()
    const error = new Error('private settings detail')
    const debug = vi.spyOn(ctx.logger, 'debug').mockImplementation(() => {})
    const backend = createNativeFetchBackend(ctx, () => { throw error })
    const pending = backend.fetch(request)
    await expect(pending).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: prefixed(failureMessage) })
    await expect(pending).rejects.not.toHaveProperty('cause')
    expect(debug).toHaveBeenCalledExactlyOnceWith('Native fetch failed', expect.objectContaining({ name: 'Error', message: error.message }))
    expect(debug.mock.calls[0]![1]).not.toBe(error)
    expect(debug.mock.calls[0]![1]).not.toHaveProperty('cause')
    debug.mockRestore()
  })

  it.each([
    ['transport', 200, undefined, 'DeepSeek web request failed:'],
    ['HTTP JSON', 403, JSON.stringify({ error: { message: 'upstream body' } }), 'DeepSeek API error (HTTP 403): upstream body'],
    ['HTTP 404', 404, JSON.stringify({ error: { message: 'failed to fetch URL' } }), 'DeepSeek API error (HTTP 404): failed to fetch URL'],
    ['HTTP text', 502, 'gateway body', 'DeepSeek API error (HTTP 502)'],
    ['malformed JSON', 200, '{private', 'DeepSeek returned an unprocessable response body:'],
    ['invalid payload', 200, JSON.stringify({ content: 123 }), 'DeepSeek returned an invalid response body'],
  ] as const)('reports a real native %s error without retired guidance over local HTTP', async (_kind, status, body, message) => {
    let calls = 0
    const baseURL = await serve((incoming, response) => {
      calls++
      if (body === undefined) { incoming.socket.destroy(); return }
      response.statusCode = status
      response.end(body)
    })
    const ctx = context({ DEEPSEEK_API_KEY: 'fixture-secret' })
    const settings = overrides({ baseURL })
    const upstream = new DeepSeekFetchApiProvider(() => fetchApiOptions(ctx, settings))
    const nativeError: unknown = await upstream.fetch(request).catch((error: unknown) => error)
    expect(nativeError).toBeInstanceOf(WebError)
    if (!(nativeError instanceof WebError)) throw new Error('expected native WebError')
    expect(nativeError.message).toContain(message)
    const pending = createNativeFetchBackend(ctx, () => settings).fetch(request)
    await expect(pending).rejects.toBeInstanceOf(WebError)
    await expect(pending).rejects.toMatchObject({ code: nativeError.code, message: responded(nativeError.message.split('\n\n')[0]!) })
    await expect(pending).rejects.not.toThrow(/Built-in plugin settings|web-deepseek-api|endpoint configuration/)
    await expect(pending).rejects.not.toHaveProperty('cause')
    expect(calls).toBe(2)
  })

  it('passes through account rejection without API-key fallback or retry', async () => {
    const ctx = context({ DEEPSEEK_API_KEY: 'must-not-fallback' })
    const agent = await accountSession(ctx, 'deepseek-account')
    void new NetworkAccount(ctx)
    const network = vi.fn(async (_url: string, init?: RequestInit) => init === undefined
      ? new Response('account-token')
      : Response.json({ error: 'private account error' }, { status: 401 }))
    vi.stubGlobal('fetch', network)
    await expect(ctx.agents.withInitiator(agent, () => createNativeFetchBackend(ctx, () => overrides()).fetch(request))).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR', message: responded('DeepSeek API error (HTTP 401): private account error'),
    })
    expect(network).toHaveBeenCalledTimes(2)
  })

  it('reports credential resolver failure with fixed plugin wording', async () => {
    const ctx = context()
    const agent = await accountSession(ctx, 'deepseek-account')
    void new NetworkAccount(ctx)
    const network = vi.fn(async () => { throw new Error('private credential error') })
    vi.stubGlobal('fetch', network)
    await expect(ctx.agents.withInitiator(agent, () => createNativeFetchBackend(ctx, () => overrides()).fetch(request))).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR', message: prefixed(failureMessage),
    })
    expect(network).toHaveBeenCalledOnce()
  })

  it('preserves cancellation before credential resolution or dispatch', async () => {
    const ctx = context()
    const controller = new AbortController()
    controller.abort(new Error('private cancellation reason'))
    const network = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', network)
    await expect(createNativeFetchBackend(ctx, () => overrides()).fetch(request, controller.signal)).rejects.toMatchObject({
      code: 'WEB_ABORTED', message: prefixed('fetch aborted'),
    })
    expect(network).not.toHaveBeenCalled()
  })

  it('preserves cancellation during account-token resolution without API dispatch', async () => {
    const ctx = context({ DEEPSEEK_API_KEY: 'must-not-fallback' })
    const agent = await accountSession(ctx, 'deepseek-account')
    void new NetworkAccount(ctx)
    const controller = new AbortController()
    const entered = Promise.withResolvers<void>()
    const token = Promise.withResolvers<Response>()
    const network = vi.fn(() => { entered.resolve(); return token.promise })
    vi.stubGlobal('fetch', network)
    const pending = ctx.agents.withInitiator(agent, () => createNativeFetchBackend(ctx, () => overrides()).fetch(request, controller.signal))
    await entered.promise
    controller.abort(new Error('private cancel'))
    await expect(pending).rejects.toMatchObject({ code: 'WEB_ABORTED', message: prefixed('fetch aborted') })
    token.resolve(new Response('late-token'))
    expect(network).toHaveBeenCalledOnce()
  })

  it('preserves native dispatch AbortError', async () => {
    const ctx = context({ DEEPSEEK_API_KEY: 'fixture-secret' })
    vi.stubGlobal('fetch', async () => { throw new DOMException('private abort', 'AbortError') })
    await expect(createNativeFetchBackend(ctx, () => overrides()).fetch(request)).rejects.toMatchObject({
      code: 'WEB_ABORTED', message: prefixed('fetch aborted'),
    })
  })
})
