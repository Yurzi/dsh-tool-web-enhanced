/**
 * The plugin inside a real `ctx.web`: the `web` row as the profile bundle
 * writes it selects the seat, and the seat serves web_fetch through the local
 * backend with the native public-only policy.
 */
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import { FETCH } from 'dsh-tool-web-enhanced-core/shared'
import { afterEach, describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function compose() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(WebRuntime, { fetchProvider: FETCH.providerId })
  const fiber = await ctx.plugin(plugin)
  return { ctx, fiber }
}

describe('fetch seat', () => {
  it('is the provider the web row selects, with the native public-only policy', async () => {
    const { ctx } = await compose()
    // The transport refuses the loopback literal before any connection.
    await expect(ctx.web.fetch({ url: 'http://127.0.0.1:9/' })).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
  })

  it('leaves with the plugin', async () => {
    const { ctx, fiber } = await compose()
    await fiber.dispose()
    await expect(ctx.web.fetch({ url: 'https://example.invalid/' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
  })
})
