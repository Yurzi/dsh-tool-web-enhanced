/**
 * The menu row must never wait on a plugin row: it injects no service, so it
 * activates in a context that has neither plugin, nor even `ctx.web`.
 */
import { Context } from '@deepseek-ai/cordis'
import { UI } from 'dsh-tool-web-enhanced-core/shared'
import { afterEach, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

it('activates without any service from the plugins', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  const fiber = await ctx.plugin(plugin)
  expect(fiber.name).toBe(UI.rowId)
  expect(fiber.uid).not.toBeNull()
})
