import { Context } from '@deepseek-ai/cordis'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { WebError } from '@deepseek-ai/dsh-web'
import { expect, it } from 'vitest'
import { nativeAuth, nativeBackend, restateNative } from '../src/host/index.ts'

it('shares native launch-plane auth without doing I/O at construction', async () => {
  const ctx = new Context()
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: { CUSTOM_KEY: 'test-key' } }]))
  try {
    const auth = nativeAuth(ctx, 'CUSTOM_KEY')
    expect(auth.apiKeyEnv).toBe('CUSTOM_KEY')
    await expect(auth.resolveApiKey()).resolves.toBe('test-key')
    await expect(auth.resolveAccountToken('https://example.test')).resolves.toBeUndefined()
  } finally { await ctx.fiber.dispose() }
})

it('restates only known native codes and never leaks original details', () => {
  const restate = restateNative({ WEB_PROVIDER_ERROR: 'safe failure', WEB_ABORTED: 'cancelled' })
  expect(restate(new WebError('secret', 'WEB_ABORTED'))).toMatchObject({ code: 'WEB_ABORTED', message: 'cancelled' })
  for (const error of [new WebError('secret', 'UNKNOWN'), new Error('secret'), 'secret']) {
    expect(restate(error)).toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'safe failure' })
    expect(restate(error).cause).toBeUndefined()
  }
})

it('shares native availability and execution error handling without retries', async () => {
  let calls = 0
  const diagnostics: unknown[] = []
  const cause = new Error('private detail')
  const restate = restateNative({ WEB_PROVIDER_ERROR: 'safe failure' })
  const backend = nativeBackend({ id: 'fixture', available: () => true }, async (_request: string, signal?: AbortSignal) => {
    calls += 1
    expect(signal).toBe(controller.signal)
    throw cause
  }, restate, error => { diagnostics.push(error) })
  const controller = new AbortController()
  expect(backend.available()).toBe(true)
  expect(calls).toBe(0)
  await expect(backend.execute('request', controller.signal)).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'safe failure' })
  expect(calls).toBe(1)
  expect(diagnostics).toEqual([cause])
})
