import { Context } from '@deepseek-ai/cordis'
import { CredentialProvider, credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import DeepSeekAccount from '@deepseek-ai/dsh-deepseek-account'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { WebError, type WebSearchProvider } from '@deepseek-ai/dsh-web'
import { DEEPSEEK_DEFAULT_BASE_URL, DEEPSEEK_DEFAULT_MODEL } from '@deepseek-ai/dsh-web-search-deepseek'
import { DEEPSEEK_WEB_API_BASE_URL } from '@deepseek-ai/dsh-web-deepseek-api'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nativeAuth, nativeBackend, restateNativeError } from '../src/backends/common.ts'
import { executeSearch } from '../src/search/execute.ts'
import { messagesOptions } from '../src/backends/deepseek-messages.ts'
import { searchApiOptions } from '../src/backends/deepseek-search-api.ts'
import { createNativeBackend, type NativeOverrides } from '../src/backends/native.ts'

// Public service implementations for the seam; only their outbound network is mocked.
class MemoryCredentials extends CredentialProvider {
  readonly values = new Map<CredentialRef, string>()
  override async resolve(ref: CredentialRef) {
    const value = this.values.get(ref)
    return value === undefined ? undefined : { value, source: 'memory' }
  }
  override async describe(ref: CredentialRef) { return { configured: this.values.has(ref), writable: true } }
  override async set(ref: CredentialRef, value: string) { this.values.set(ref, value) }
  override async unset(ref: CredentialRef) { this.values.delete(ref) }
  override readRecord(): never { throw new Error('record API not used') }
  override describeRecord(): never { throw new Error('record API not used') }
  override listRecords(): never { throw new Error('record API not used') }
  override modifyRecord(): never { throw new Error('record API not used') }
  override deleteRecord(): never { throw new Error('record API not used') }
}

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
  it('reports the raw native failure only through the diagnostic callback', async () => {
    const failure = new Error('private-native-detail')
    const diagnostics: unknown[] = []
    const provider = nativeBackend({ id: 'fixture', available: () => true, search: async () => { throw failure } }, cause => { diagnostics.push(cause) })
    const pending = provider.search({ query: 'q' })
    await expect(pending).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    await expect(pending).rejects.not.toHaveProperty('cause')
    await expect(pending).rejects.not.toThrow('private-native-detail')
    expect(diagnostics).toEqual([failure])
  })

  it('asks the user to supply missing native credentials', () => {
    expect(restateNativeError(new WebError('private', 'WEB_PROVIDER_CREDENTIAL_MISSING')).message).toContain('ask the user to')
  })
  it.each(['WEB_PROVIDER_ERROR', 'WEB_PROVIDER_CREDENTIAL_MISSING', 'WEB_ABORTED'])('restates %s without endpoint, upstream body, cause or retired settings guidance', code => {
    const error = restateNativeError(new WebError('https://private.test?key=secret; upstream-body; Built-in plugin settings web-search-deepseek', code))
    expect(error).toBeInstanceOf(WebError)
    expect(error.code).toBe(code)
    expect(error.message).toMatch(/^dsh-web-search-enhanced: /)
    expect(error.message).not.toMatch(/https?:|private|secret|upstream-body|Built-in|web-search-deepseek/)
    expect(error.cause).toBeUndefined()
  })

  it('sanitizes unknown errors and unrecognized error codes', () => {
    for (const failure of [new Error('secret endpoint'), new WebError('private body', 'UNKNOWN_CODE'), new WebError('private body', 'WEB_FETCH_TIMEOUT'), new WebError('private body', 'WEB_INVALID_URL')]) {
      const error = restateNativeError(failure)
      expect(error.code).toBe('WEB_PROVIDER_ERROR')
      expect(error.message).not.toMatch(/secret|private|endpoint/)
      expect(error.cause).toBeUndefined()
    }
  })

  it.each(['deepseek-messages', 'deepseek-search-api'] as const)('%s restates a real provider transport error (network mocked)', async key => {
    const ctx = context({ DEEPSEEK_API_KEY: 'fixture-secret' })
    const fetch = vi.fn(async () => { throw new Error('https://private.test; fixture-secret; upstream-body') })
    vi.stubGlobal('fetch', fetch)
    const provider = createNativeBackend(ctx, key, () => overrides())
    const pending = provider.search({ query: 'q' })
    await expect(pending).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    await expect(pending).rejects.not.toThrow(/https?:|private|fixture-secret|upstream-body|web-search-deepseek/)
    expect(fetch).toHaveBeenCalledOnce()
  })
})
