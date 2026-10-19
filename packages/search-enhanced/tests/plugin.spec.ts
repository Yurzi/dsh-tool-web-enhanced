/**
 * The plugin inside a real `ctx.web`: the `web` row as the profile bundle
 * writes it selects the seat, and the seat serves web_search through the
 * native-parity backend.
 */
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { afterEach, describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function compose() {
  const ctx = new Context()
  contexts.push(ctx)
  // An empty launch environment: no DEEPSEEK_API_KEY leaks in from the developer's shell.
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }]))
  await ctx.plugin(WebRuntime, { searchProvider: SEARCH.providerId })
  const fiber = await ctx.plugin(plugin)
  return { ctx, fiber }
}

describe('search seat', () => {
  it('is the provider the web row selects', async () => {
    const { ctx } = await compose()
    // A missing seat would be WEB_PROVIDER_CONFIGURED_MISSING; reaching the
    // DeepSeek backend without a key is what native search answers too.
    await expect(ctx.web.search({ query: 'deepseek harness' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
  })

  it('never sends the model to the native settings the profile retires', async () => {
    const { ctx } = await compose()
    const search = ctx.web.search({ query: 'q' })
    await expect(search).rejects.toThrow(/DEEPSEEK_API_KEY/)
    await expect(search).rejects.not.toThrow(/web-search-deepseek|Built-in plugin settings/)
  })

  it('leaves with the plugin', async () => {
    const { ctx, fiber } = await compose()
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
  })
})
