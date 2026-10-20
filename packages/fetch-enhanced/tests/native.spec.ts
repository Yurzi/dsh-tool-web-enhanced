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
import { DEEPSEEK_WEB_API_BASE_URL } from '@deepseek-ai/dsh-web-deepseek-api'
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
const prefixed = (message: string): string => FETCH.packageName + ': ' + message

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

describe('native fetch error rewriting', () => {
  it.each([
    ['WEB_PROVIDER_ERROR', failureMessage], ['WEB_PROVIDER_CREDENTIAL_MISSING', missingMessage], ['WEB_ABORTED', 'fetch aborted'],
  ])('restates %s without endpoint, body, secret, cause or retired guidance', (code, message) => {
    const failure = new WebError('https://private.test; fixture-secret; upstream-body; Built-in plugin settings 网页搜索', code, { cause: new Error('private') })
    const error = restateNativeError(failure)
    expect(error).toBeInstanceOf(WebError)
    expect(error.code).toBe(code)
    expect(error.message).toBe(prefixed(message))
    expect(error.cause).toBeUndefined()
  })

  it('sanitizes unexpected thrown values', () => {
    for (const error of [new Error('secret'), new WebError('private', 'UNKNOWN'), 'private']) {
      expect(restateNativeError(error)).toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: prefixed(failureMessage) })
    }
  })

  it.each([
    ['transport', async (): Promise<Response> => { throw new Error('private transport detail') }],
    ['HTTP JSON', async () => Response.json({ error: { message: 'private upstream body' } }, { status: 403 })],
    ['HTTP text', async () => new Response('private gateway body', { status: 502 })],
    ['malformed JSON', async () => new Response('{private')],
    ['invalid payload', async () => Response.json({ content: 123 })],
  ] as const)('rewrites a real native %s error', async (_kind, network) => {
    const ctx = context({ DEEPSEEK_API_KEY: 'fixture-secret' })
    const mocked = vi.fn(network)
    vi.stubGlobal('fetch', mocked)
    const backend = createNativeFetchBackend(ctx, () => overrides({ baseURL: 'https://private.test/base' }))
    const pending = backend.fetch(request)
    await expect(pending).rejects.toBeInstanceOf(WebError)
    await expect(pending).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: prefixed(failureMessage) })
    await expect(pending).rejects.not.toHaveProperty('cause')
    expect(mocked).toHaveBeenCalledOnce()
  })

  it('rewrites account rejection without API-key fallback or retry', async () => {
    const ctx = context({ DEEPSEEK_API_KEY: 'must-not-fallback' })
    const agent = await accountSession(ctx, 'deepseek-account')
    void new NetworkAccount(ctx)
    const network = vi.fn(async (_url: string, init?: RequestInit) => init === undefined
      ? new Response('account-token')
      : Response.json({ error: 'private account error' }, { status: 401 }))
    vi.stubGlobal('fetch', network)
    await expect(ctx.agents.withInitiator(agent, () => createNativeFetchBackend(ctx, () => overrides()).fetch(request))).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR', message: prefixed(failureMessage),
    })
    expect(network).toHaveBeenCalledTimes(2)
  })

  it('rewrites credential resolver failure', async () => {
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
