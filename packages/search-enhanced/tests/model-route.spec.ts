import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { LlmRuntime, type LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { deepseekRoute } from '../src/model/deepseek.ts'
import { fixedRoute, sessionRoute } from '../src/model/route.ts'
import { resolveSettings } from '../src/settings/resolve.ts'
import { MODEL_SETTINGS_NS, mountModelSettings } from './fixtures/model-host.ts'

const MODEL = { provider: 'chat', model: 'model-a' }
const explicit = (extra: Record<string, unknown> = {}) => ({ api: 'openai-responses', baseURL: 'https://chat.test/v1', apiKeyEnv: 'CHAT_KEY', ...extra })
const environment = (values: Record<string, string> = {}) => createLaunchEnvironmentSnapshot([{ source: 'process', values }])
const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

describe('DeepSeek route defaults (DSH Messages, not the search-only endpoint)', () => {
  it.each(['deepseek-official', 'deepseek-account'] as const)('%s follows each endpoint precedence rule', provider => {
    const resolve = (config: Record<string, unknown>, values: Record<string, string> = {}) => deepseekRoute(provider, config, environment(values), 'deepseek-v4-pro')
    expect(resolve({})).toMatchObject({ kind: 'route', route: { protocol: 'anthropic-messages', dialect: 'deepseek', baseURL: 'https://api.deepseek.com/anthropic', model: 'deepseek-v4-pro' } })
    expect(resolve({}, { DEEPSEEK_BASE_URL: 'http://localhost:1234/anthropic' })).toMatchObject({ route: { baseURL: 'http://localhost:1234/anthropic' } })
    expect(resolve({ baseURL: 'https://configured.test/anthropic' }, { DEEPSEEK_BASE_URL: 'https://environment.test' })).toMatchObject({ route: { baseURL: 'https://configured.test/anthropic' } })
    expect(resolve({}, { DEEPSEEK_SEARCH_BASE_URL: 'https://not-the-session.test' })).toMatchObject({ route: { baseURL: 'https://api.deepseek.com/anthropic' } })
    for (const baseURL of ['', 'bad', 'https://user:secret@invalid.test', 'https://invalid.test?token=secret', 'https://invalid.test#fragment', 'file:///tmp/model']) {
      expect(resolve({ baseURL })).toEqual({ kind: 'unsupported', reason: 'endpoint' })
      expect(resolve({}, { DEEPSEEK_BASE_URL: baseURL })).toEqual({ kind: 'unsupported', reason: 'endpoint' })
    }
    expect(resolve({ baseURL: null })).toMatchObject({ route: { baseURL: 'https://api.deepseek.com/anthropic' } })
  })

  it.each(['deepseek-official', 'deepseek-account'] as const)('%s bounds configured and environment endpoints', provider => {
    const baseURL = 'https://example.invalid/' + '/'.repeat(32_000) + 'x'
    expect(deepseekRoute(provider, { baseURL }, environment(), 'm')).toEqual({ kind: 'unsupported', reason: 'endpoint' })
    expect(deepseekRoute(provider, {}, environment({ DEEPSEEK_BASE_URL: baseURL }), 'm')).toEqual({ kind: 'unsupported', reason: 'endpoint' })
  })

  it('bounds the DeepSeek credential reference before matching it', () => {
    expect(deepseekRoute('deepseek-official', { apiKeyEnv: 'A'.repeat(2001) }, environment(), 'm')).toEqual({ kind: 'unsupported', reason: 'credential' })
  })

  it('official uses the configured credential reference or DEEPSEEK_API_KEY, always with route authentication', () => {
    expect(deepseekRoute('deepseek-official', {}, environment(), 'm')).toMatchObject({ route: { auth: { kind: 'api-key', credentialRef: 'DEEPSEEK_API_KEY', source: 'route' } } })
    expect(deepseekRoute('deepseek-official', { apiKeyEnv: 'TEAM_KEY' }, environment({ DEEPSEEK_API_KEY: 'not-a-reference' }), 'm')).toMatchObject({ route: { auth: { credentialRef: 'TEAM_KEY', source: 'route' } } })
    expect(deepseekRoute('deepseek-official', { apiKeyEnv: null }, environment(), 'm')).toMatchObject({ route: { auth: { credentialRef: 'DEEPSEEK_API_KEY' } } })
    expect(deepseekRoute('deepseek-official', { apiKeyEnv: 'bad ref' }, environment(), 'm')).toEqual({ kind: 'unsupported', reason: 'credential' })
  })

  it('account never takes API-key authentication or model overrides', () => {
    expect(deepseekRoute('deepseek-account', { apiKeyEnv: 'IGNORED_KEY', modelOverrides: { m: { baseURL: 'https://wrong.test', api: 'openai-responses' } } }, environment({ DEEPSEEK_API_KEY: 'ignored' }), 'm')).toEqual({ kind: 'route', route: { dialect: 'deepseek', model: 'm', protocol: 'anthropic-messages', baseURL: 'https://api.deepseek.com/anthropic', auth: { kind: 'account' } } })
  })

  it('ignores inherited endpoint and credential fields', () => {
    const config: Record<string, unknown> = Object.create({ baseURL: 'https://inherited.test', apiKeyEnv: 'INHERITED_KEY' }) as Record<string, unknown>
    expect(deepseekRoute('deepseek-official', config, environment(), 'm')).toMatchObject({ route: { baseURL: 'https://api.deepseek.com/anthropic', auth: { credentialRef: 'DEEPSEEK_API_KEY' } } })
  })
})

describe('sessionRoute over real DSH directory and schema-backed Settings', () => {
  let ctx: Context
  let root: string
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'model-routes-'))
    ctx = new Context()
    ctx.provide('launchEnvironment', environment())
    void new LlmRuntime(ctx)
    await mountModelSettings(ctx, root)
    return async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  })
  const route = async (profile: Record<string, unknown>, extra: Partial<LlmConfigurableProvider> = {}, model = MODEL) => {
    await ctx.settings.replace(MODEL_SETTINGS_NS, { routes: { chat: profile } })
    const registration = ctx.llm.registerConfigurableProviders([{ provider: 'chat', displayName: 'Chat', settingsNs: MODEL_SETTINGS_NS, settingsPath: ['routes', 'chat'], ...extra }])
    try { return sessionRoute(ctx, model) } finally { registration() }
  }

  it.each([
    ['anthropic-messages', 'anthropic-messages'],
    ['openai-responses', 'openai-responses'],
    ['openai-completions', 'openai-chat-completions'],
  ])('maps declared %s to %s', async (api, protocol) => {
    expect(await route(explicit({ api }))).toEqual({ kind: 'route', route: { dialect: 'standard', protocol, model: 'model-a', baseURL: 'https://chat.test/v1', auth: { kind: 'api-key', credentialRef: 'CHAT_KEY', source: 'route' } } })
  })

  it('rejects a 32k slash endpoint at the cross-namespace boundary', async () => {
    const baseURL = 'https://example.invalid/' + '/'.repeat(32_000) + 'x'
    expect(await route(explicit({ baseURL }))).toEqual({ kind: 'unsupported', reason: 'endpoint' })
  })

  it.each([
    [{ apiKeyEnv: 'A'.repeat(2001) }, {}, 'credential'],
    [{ models: Array.from({ length: 201 }, () => ({ id: 'model-a' })) }, {}, 'unknown-route'],
    [{ models: {} }, {}, 'unknown-route'],
    [{ models: [{ id: 'x'.repeat(201) }] }, {}, 'unknown-route'],
    [{ modelOverrides: [] }, {}, 'unknown-route'],
    [{ headers: 'secret' }, {}, 'headers'],
    [{ headers: [] }, {}, 'headers'],
    [{}, { settingsPath: Array.from({ length: 201 }, () => 'routes') }, 'unknown-route'],
    [{}, { settingsPath: ['x'.repeat(2001)] }, 'unknown-route'],
    [{ baseURL: undefined }, { defaultBaseURL: 'https://example.invalid/' + '/'.repeat(32_000) + 'x' }, 'endpoint'],
    [{ apiKeyEnv: undefined }, { nativeAuth: { env: ['A'.repeat(2001)], oauth: false } }, 'credential'],
  ] as const)('rejects oversized or malformed route inputs with only a closed reason', async (profile, extra, reason) => {
    expect(await route(explicit(profile), extra)).toEqual({ kind: 'unsupported', reason })
  })

  it('bounds the session model id before resolving model overrides', async () => {
    expect(await route(explicit(), {}, { ...MODEL, model: 'm'.repeat(201) })).toEqual({ kind: 'unsupported', reason: 'unknown-route' })
  })

  it('uses model entries before route fields and directory defaults', async () => {
    expect(await route(explicit({ models: [{ id: 'other', api: 'unsupported' }, { id: 'model-a', api: 'anthropic-messages', baseURL: 'https://model.test' }] }))).toMatchObject({ route: { protocol: 'anthropic-messages', baseURL: 'https://model.test' } })
    expect(await route(explicit({ modelOverrides: { 'model-a': { api: 'openai-completions', baseURL: 'https://override.test' } } }))).toMatchObject({ route: { protocol: 'openai-chat-completions', baseURL: 'https://override.test' } })
    expect(await route({ api: 'openai-responses' }, { defaultBaseURL: 'https://default.test', nativeAuth: { env: ['NATIVE_KEY'], oauth: false } })).toMatchObject({ route: { baseURL: 'https://default.test', auth: { credentialRef: 'NATIVE_KEY' } } })
    expect(await route(explicit(), { defaultBaseURL: 'https://default.test', nativeAuth: { env: ['OTHER_KEY'], oauth: true } })).toMatchObject({ route: { baseURL: 'https://chat.test/v1', auth: { credentialRef: 'CHAT_KEY' } } })
    expect(await route(explicit({ headers: {}, models: [{ id: 'model-a', headers: {} }] }))).toMatchObject({ kind: 'route' })
  })

  it.each<[Record<string, unknown>, Partial<LlmConfigurableProvider>, string]>([
    [{ api: undefined }, {}, 'protocol'],
    [{ api: 'google-generative-ai' }, {}, 'protocol'],
    [{ models: [{ id: 'model-a', api: 'unknown' }] }, {}, 'protocol'],
    [{ baseURL: undefined }, {}, 'endpoint'],
    [{ baseURL: 'https://user:secret@invalid.test' }, {}, 'endpoint'],
    [{ baseURL: 'bad' }, { defaultBaseURL: 'https://fallback.test' }, 'endpoint'],
    [{}, { baseURLEnv: ['PROVIDER_BASE_URL'] }, 'endpoint'],
    [{}, { baseURLEnv: [] }, 'endpoint'],
    [{ headers: { authorization: 'SECRET' } }, {}, 'headers'],
    [{ models: [{ id: 'model-a', headers: { secret: 'SECRET' } }] }, {}, 'headers'],
    [{ modelOverrides: { 'model-a': { headers: { secret: 'SECRET' } } } }, {}, 'headers'],
    [{ apiKeyEnv: undefined }, {}, 'credential'],
    [{ apiKeyEnv: 'bad ref' }, {}, 'credential'],
    [{ apiKeyEnv: undefined }, { nativeAuth: { env: [], oauth: false } }, 'credential'],
    [{ apiKeyEnv: undefined }, { nativeAuth: { env: ['A', 'B'], oauth: false } }, 'credential'],
    [{ apiKeyEnv: undefined }, { nativeAuth: { env: ['A'], oauth: true } }, 'credential'],
    [{ apiKeyEnv: undefined }, { nativeAuth: { env: ['bad ref'], oauth: false } }, 'credential'],
  ])('refuses unsupported route facts %j %j with only reason %s', async (profile, entry, reason) => {
    expect(await route(explicit(profile), entry)).toEqual({ kind: 'unsupported', reason })
  })

  it('reports no model and unknown routes without guessing a namespace', async () => {
    expect(sessionRoute(ctx, undefined)).toEqual({ kind: 'unsupported', reason: 'no-model' })
    expect(sessionRoute(ctx, MODEL)).toEqual({ kind: 'unsupported', reason: 'unknown-route' })
    expect(await route(explicit(), { settingsNs: 'not-mounted' })).toEqual({ kind: 'unsupported', reason: 'unknown-route' })
    expect(await route(explicit(), { settingsPath: ['routes', 'absent'] })).toEqual({ kind: 'unsupported', reason: 'unknown-route' })
    const bare = new Context()
    contexts.push(bare)
    void new LlmRuntime(bare)
    bare.llm.registerConfigurableProviders([{ provider: 'chat', displayName: 'Chat', settingsNs: MODEL_SETTINGS_NS, settingsPath: [] }])
    expect(sessionRoute(bare, MODEL)).toEqual({ kind: 'unsupported', reason: 'unknown-route' })
    const noLlm = new Context()
    contexts.push(noLlm)
    expect(sessionRoute(noLlm, MODEL)).toEqual({ kind: 'unsupported', reason: 'unknown-route' })
  })

  it.each(['deepseek-official', 'deepseek-account'])('finds %s by directory namespace and path, not a hardcoded row id', async provider => {
    expect(await route({ baseURL: 'https://session.test/anthropic', apiKeyEnv: 'RENAMED_KEY' }, { provider }, { provider, model: 'pro' })).toMatchObject({ kind: 'route', route: { protocol: 'anthropic-messages', baseURL: 'https://session.test/anthropic', model: 'pro' } })
  })

  it('never follows inherited path segments, model ids, or routing fields', async () => {
    expect(await route(explicit(), { settingsPath: ['routes', 'toString'] })).toEqual({ kind: 'unsupported', reason: 'unknown-route' })
    expect(await route(explicit({ modelOverrides: {} }), {}, { ...MODEL, model: 'toString' })).toMatchObject({ kind: 'route' })
    // Real Settings returns ordinary objects. A non-enumerable inherited field is
    // still reachable through them; none may supply routing facts.
    // oxlint-disable-next-line eslint/no-extend-native -- Deliberately exercise inherited route facts; always remove the fixture in finally.
    Object.defineProperty(Object.prototype, 'api', { configurable: true, writable: true, value: 'anthropic-messages' })
    try {
      expect(await route({ baseURL: 'https://chat.test', apiKeyEnv: 'CHAT_KEY' })).toEqual({ kind: 'unsupported', reason: 'protocol' })
    } finally { Reflect.deleteProperty(Object.prototype, 'api') }
  })

  it.each([
    ['baseURL', 'https://inherited.test', { api: 'openai-responses', apiKeyEnv: 'CHAT_KEY' }, {}, { kind: 'unsupported', reason: 'endpoint' }],
    ['apiKeyEnv', 'INHERITED_KEY', { api: 'openai-responses', baseURL: 'https://chat.test' }, {}, { kind: 'unsupported', reason: 'credential' }],
    ['headers', { authorization: 'inherited-secret' }, explicit(), {}, { kind: 'route' }],
    ['models', [{ id: 'model-a', api: 'unknown' }], explicit(), {}, { kind: 'route' }],
    ['modelOverrides', { 'model-a': { api: 'unknown' } }, explicit(), {}, { kind: 'route' }],
    ['model-a', { api: 'unknown' }, explicit({ modelOverrides: {} }), {}, { kind: 'route' }],
  ] as const)('does not inherit %s from an object prototype', async (key, value, profile, extra, expected) => {
    // oxlint-disable-next-line eslint/no-extend-native -- Real Settings snapshots are plain objects; deliberately supply inherited facts and always restore the prototype.
    Object.defineProperty(Object.prototype, key, { configurable: true, writable: true, value })
    try { expect(await route(profile, extra)).toMatchObject(expected) }
    finally { Reflect.deleteProperty(Object.prototype, key) }
  })

  it('reads a fresh matching namespace once per call, without credential or network I/O', async () => {
    const registration = ctx.llm.registerConfigurableProviders([{ provider: 'chat', displayName: 'Chat', settingsNs: MODEL_SETTINGS_NS, settingsPath: ['routes', 'chat'] }])
    try {
      await ctx.settings.replace(MODEL_SETTINGS_NS, { routes: { chat: explicit() } })
      expect(sessionRoute(ctx, MODEL)).toMatchObject({ route: { baseURL: 'https://chat.test/v1', auth: { credentialRef: 'CHAT_KEY' } } })
      await ctx.settings.replace(MODEL_SETTINGS_NS, { routes: { chat: explicit({ baseURL: 'https://changed.test', apiKeyEnv: 'CHANGED_KEY' }) } })
      expect(sessionRoute(ctx, MODEL)).toMatchObject({ route: { baseURL: 'https://changed.test', auth: { credentialRef: 'CHANGED_KEY' } } })
    } finally { registration() }
  })
})

it('builds fixed model routes using only Credentials', () => {
  const connection = resolveSettings({ connections: { 'custom:search': { kind: 'model', label: 'Fixed', protocol: 'openai-responses', model: 'fixed-model', endpoint: 'https://fixed.test/v1', credentialRef: 'FIXED_KEY', trustedEndpoint: true } } }).connections.get('custom:search')!
  if (connection.kind !== 'model' || connection.route.kind !== 'fixed') throw new Error('expected fixed model fixture')
  expect(fixedRoute(connection.route)).toEqual({ dialect: 'standard', protocol: 'openai-responses', model: 'fixed-model', baseURL: 'https://fixed.test/v1', auth: { kind: 'api-key', credentialRef: 'FIXED_KEY', source: 'credentials' } })
})