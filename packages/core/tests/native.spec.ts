import { Context } from '@deepseek-ai/cordis'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { WebError } from '@deepseek-ai/dsh-web'
import { expect, it } from 'vitest'
import { CredentialProvider, credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { nativeAuth, nativeBackend, restateNative, resolveApiKey, routeApiKey, routeKeyConfigured } from '../src/host/index.ts'

class ReadinessCredentials extends CredentialProvider {
  readonly values = new Map<CredentialRef, string>()
  override async resolve(): Promise<never> { throw new Error('readiness must not resolve secrets') }
  override async describe(ref: CredentialRef) { return { configured: this.values.has(ref), writable: true } }
  override async set(ref: CredentialRef, value: string) { this.values.set(ref, value) }
  override async unset(ref: CredentialRef) { this.values.delete(ref) }
  override readRecord(): never { throw new Error('unused record API') }
  override describeRecord(): never { throw new Error('unused record API') }
  override listRecords(): never { throw new Error('unused record API') }
  override modifyRecord(): never { throw new Error('unused record API') }
  override deleteRecord(): never { throw new Error('unused record API') }
}

it('shares route key readiness without resolving secrets or overriding Credentials authority', async () => {
  const ctx = new Context()
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: { ROUTE_KEY: 'ambient', EMPTY_KEY: '' } }]))
  try {
    expect(await routeKeyConfigured(ctx, 'ROUTE_KEY', 'route')).toBe(true)
    expect(await routeKeyConfigured(ctx, 'ROUTE_KEY', 'credentials')).toBe(false)
    expect(await routeKeyConfigured(ctx, 'EMPTY_KEY', 'route')).toBe(false)
    expect(await routeKeyConfigured(ctx, 'MISSING_KEY', 'route')).toBe(false)
    const mounted = await ctx.plugin(ReadinessCredentials)
    expect(await routeKeyConfigured(ctx, 'ROUTE_KEY', 'route')).toBe(false)
    await ctx.credentials.set(credentialRef('ROUTE_KEY'), 'stored')
    expect(await routeKeyConfigured(ctx, 'ROUTE_KEY', 'route')).toBe(true)
    expect(await routeKeyConfigured(ctx, 'ROUTE_KEY', 'credentials')).toBe(true)
    await ctx.credentials.unset(credentialRef('ROUTE_KEY'))
    expect(await routeKeyConfigured(ctx, 'ROUTE_KEY', 'route')).toBe(false)
    await mounted.dispose()
    expect(await routeKeyConfigured(ctx, 'ROUTE_KEY', 'route')).toBe(true)
  } finally { await ctx.fiber.dispose() }
})

it('shares native launch-plane auth without doing I/O at construction', async () => {
  const ctx = new Context()
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: { CUSTOM_KEY: 'test-key' } }]))
  try {
    const auth = nativeAuth(ctx, 'CUSTOM_KEY')
    expect(auth.apiKeyEnv).toBe('CUSTOM_KEY')
    await expect(auth.resolveApiKey()).resolves.toBe('test-key')
    await expect(routeApiKey(ctx, 'CUSTOM_KEY')).resolves.toBe('test-key')
    await expect(routeApiKey(ctx, 'MISSING_KEY')).resolves.toBeUndefined()
    await expect(resolveApiKey(ctx, 'CUSTOM_KEY')).resolves.toBeUndefined()
    await expect(auth.resolveAccountToken('https://example.test')).resolves.toBeUndefined()
  } finally { await ctx.fiber.dispose() }
})

it('does not treat an empty launch-plane value as a route key', async () => {
  const ctx = new Context()
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: { EMPTY_KEY: '' } }]))
  try {
    await expect(routeApiKey(ctx, 'EMPTY_KEY')).resolves.toBeUndefined()
    await expect(nativeAuth(ctx, 'EMPTY_KEY').resolveApiKey()).resolves.toBeUndefined()
  } finally { await ctx.fiber.dispose() }
})

const messages = {
  WEB_PROVIDER_ERROR: 'service failure; response follows',
  WEB_PROVIDER_CREDENTIAL_MISSING: 'save the key in this plugin',
  WEB_ABORTED: 'operation aborted',
  WEB_PROVIDER_UNAVAILABLE: 'choose another connection',
}
const restate = (error: unknown) => restateNative(messages, 'plugin: ', 'unexpected native failure')(error)

it('keeps service reports but strips subsequent retired DSH settings guidance', () => {
  const error = restate(new WebError('HTTP 404: failed to fetch URL\n\nBuilt-in plugin settings > web-search-deepseek', 'WEB_PROVIDER_ERROR', { cause: new Error('private') }))
  expect(error).toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'plugin: service failure; response follows\n\nDeepSeek responded (untrusted): HTTP 404: failed to fetch URL' })
  expect(error.cause).toBeUndefined()
})

it('recognizes CRLF and whitespace-only blank lines before native settings guidance', () => {
  expect(restate(new WebError(' service report\r\n \t\r\nBuilt-in plugin settings', 'WEB_PROVIDER_ERROR')).message).toBe('plugin: service failure; response follows\n\nDeepSeek responded (untrusted): service report')
})

it('uses only plugin wording for missing credentials and cancellation', () => {
  expect(restate(new WebError('web-search-deepseek config', 'WEB_PROVIDER_CREDENTIAL_MISSING'))).toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING', message: 'plugin: save the key in this plugin' })
  expect(restate(new WebError('private cancellation reason', 'WEB_ABORTED'))).toMatchObject({ code: 'WEB_ABORTED', message: 'plugin: operation aborted' })
})

it('keeps recognized codes and maps unknown WebError codes to provider errors with service details', () => {
  expect(restate(new WebError('upstream unavailable', 'WEB_PROVIDER_UNAVAILABLE'))).toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE', message: 'plugin: choose another connection\n\nDeepSeek responded (untrusted): upstream unavailable' })
  expect(restate(new WebError('unknown upstream failure', 'UNKNOWN'))).toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'plugin: service failure; response follows\n\nDeepSeek responded (untrusted): unknown upstream failure' })
})

it('omits empty service details instead of appending an empty label', () => {
  expect(restate(new WebError(' \n\nretired guidance', 'WEB_PROVIDER_ERROR')).message).toBe('plugin: service failure; response follows')
})

it('bounds native service detail to 2000 characters including the ellipsis', () => {
  expect(restate(new WebError('x'.repeat(2001), 'WEB_PROVIDER_ERROR')).message).toBe('plugin: service failure; response follows\n\nDeepSeek responded (untrusted): ' + 'x'.repeat(1999) + '…')
  expect(restate(new WebError('x'.repeat(2000), 'WEB_PROVIDER_ERROR')).message).toBe('plugin: service failure; response follows\n\nDeepSeek responded (untrusted): ' + 'x'.repeat(2000))
})

it('does not split surrogate pairs while bounding native service detail', () => {
  expect(restate(new WebError('x'.repeat(1998) + '😀more', 'WEB_PROVIDER_ERROR')).message).toBe('plugin: service failure; response follows\n\nDeepSeek responded (untrusted): ' + 'x'.repeat(1998) + '…')
})

it('keeps unexpected failures on their original fixed fallback without details or cause', () => {
  for (const error of [new Error('private'), 'private']) {
    expect(restate(error)).toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'plugin: unexpected native failure' })
    expect(restate(error).cause).toBeUndefined()
  }
})

it('shares native availability and execution error handling without retries', async () => {
  let calls = 0
  const diagnostics: unknown[] = []
  const cause = new Error('private detail')
  const mapError = () => new WebError('safe failure', 'WEB_PROVIDER_ERROR')
  const backend = nativeBackend({ id: 'fixture', available: () => true }, async (_request: string, signal?: AbortSignal) => {
    calls += 1
    expect(signal).toBe(controller.signal)
    throw cause
  }, mapError, error => { diagnostics.push(error) })
  const controller = new AbortController()
  expect(backend.available()).toBe(true)
  expect(calls).toBe(0)
  await expect(backend.execute('request', controller.signal)).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'safe failure' })
  expect(calls).toBe(1)
  expect(diagnostics).toHaveLength(1)
  expect(diagnostics[0]).not.toBe(cause)
  expect(diagnostics[0]).toMatchObject({ name: 'Error', message: 'private detail' })
  expect(diagnostics[0]).not.toHaveProperty('cause')
})

it('withholds an entire native report when any supported credential representation is detected', async () => {
  const secret = '0123456789abcdef'
  const unicode = (value: string) => Array.from(value, character => String.fromCharCode(92) + 'u' + character.charCodeAt(0).toString(16).padStart(4, '0')).join('')
  const details = [
    'Denied ' + secret,
    'Denied ' + secret.slice(2, 12),
    'Denied ' + secret.slice(0, 9) + unicode(secret.slice(9)),
    'Denied ' + unicode(secret.slice(0, 7)) + secret.slice(7),
  ]
  for (const detail of details) {
    const diagnostics: unknown[] = []
    const backend = nativeBackend({ id: 'fixture', available: () => true }, async () => {
      throw new WebError(detail + '\n\nretired settings', 'WEB_PROVIDER_ERROR')
    }, restateNative(messages, 'plugin: ', 'unexpected native failure'), error => { diagnostics.push(error) }, new Set([secret]))
    await expect(backend.execute(undefined)).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: "plugin: service failure; response follows\n\nDeepSeek's response was withheld because it contained this request's credential.",
    })
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ message: "diagnostic message withheld: it contained this request's credential" })
  }
})

it('compiles native credentials once per successful response and reuses the matcher across result strings', async () => {
  const secret = 'a'.repeat(16_000) + 'z'
  let iterations = 0
  const secrets: Iterable<string> = {
    *[Symbol.iterator]() { iterations++; yield secret },
  }
  const backend = nativeBackend({ id: 'fixture', available: () => true }, async () => ({
    rows: Array.from({ length: 1000 }, () => 'ok'),
    text: 'exact ' + secret,
    excerpt: secret.slice(2, 12),
  }), () => new WebError('unexpected', 'WEB_PROVIDER_ERROR'), undefined, secrets)
  const result = await backend.execute(undefined)
  expect(result.rows).toEqual(Array.from({ length: 1000 }, () => 'ok'))
  expect(result.text).toHaveLength('exact [redacted]'.length)
  expect(result.text).toBe('exact [redacted]')
  expect(result.excerpt).toBe('[redacted]')
  expect(iterations).toBe(1)
})

it('compiles native credentials once per failed response for both diagnostics and restating', async () => {
  let iterations = 0
  const secrets: Iterable<string> = {
    *[Symbol.iterator]() { iterations++; yield 'private-native-credential' },
  }
  const diagnostics: unknown[] = []
  const backend = nativeBackend({ id: 'fixture', available: () => true }, async () => {
    throw new WebError('Denied private-native-credential', 'WEB_PROVIDER_ERROR')
  }, restateNative(messages, 'plugin: ', 'unexpected native failure'), error => { diagnostics.push(error) }, secrets)
  await expect(backend.execute(undefined)).rejects.toThrow('response was withheld')
  expect(diagnostics).toHaveLength(1)
  expect(iterations).toBe(1)
})

it.each([
  ['Error-0123456789abcdef', 'E_NATIVE_FAILURE', 'Error', 'E_NATIVE_FAILURE'],
  ['Credential0123456789abcdefError', 'E_NATIVE_FAILURE', 'Error', 'E_NATIVE_FAILURE'],
  ['TypeError', 'E_0123456789ABCDEF', 'TypeError', undefined],
  ['TypeError', 'secret-0123456789abcdef', 'TypeError', undefined],
  ['TypeError', { credential: '0123456789abcdef' }, 'TypeError', undefined],
  ['TypeError', 'E_NATIVE_FAILURE', 'TypeError', 'E_NATIVE_FAILURE'],
] as const)('passes only safe native diagnostic metadata (%s)', async (name, code, safeName, safeCode) => {
  const secret = '0123456789abcdef'
  const original = Object.assign(new Error('Denied ' + secret, { cause: new Error(secret) }), {
    name, code, privateData: { secret }, stack: 'OLD-PRIVATE-STACK ' + secret,
  })
  const diagnostics: unknown[] = []
  const backend = nativeBackend({ id: 'fixture', available: () => true }, async () => { throw original },
    restateNative(messages, 'plugin: ', 'unexpected native failure'), error => { diagnostics.push(error) }, new Set([secret]))
  await expect(backend.execute(undefined)).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'plugin: unexpected native failure' })
  expect(diagnostics).toHaveLength(1)
  const diagnostic = diagnostics[0]
  expect(diagnostic).toBeInstanceOf(Error)
  if (!(diagnostic instanceof Error)) throw new Error('expected diagnostic Error')
  expect(diagnostic).not.toBe(original)
  expect(diagnostic.name).toBe(safeName)
  expect('code' in diagnostic ? diagnostic.code : undefined).toBe(safeCode)
  expect(diagnostic.message).toBe("diagnostic message withheld: it contained this request's credential")
  expect(String(diagnostic)).not.toContain(secret)
  expect(diagnostic.stack).not.toMatch(/0123456789abcdef|OLD-PRIVATE-STACK/)
  expect(diagnostic).not.toHaveProperty('cause')
  expect(diagnostic).not.toHaveProperty('privateData')
})
