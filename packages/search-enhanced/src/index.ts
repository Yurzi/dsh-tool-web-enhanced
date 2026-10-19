/**
 * web_search for DeepSeek Harness from switchable backends. The plugin
 * registers the `search-enhanced` provider in `ctx.web`; the profile bundle
 * selects it in the shared `web` row, and the model keeps DSH's own
 * web_search tool.
 * @module dsh-web-search-enhanced
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-web'
import { SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { deepseekMessages } from './backends/deepseek-messages.ts'
import { createSearchSeat } from './seat.ts'

/** Cordis plugin name used in Loader diagnostics; equal to the row id. */
export const name = SEARCH.rowId

/** The capability seam this plugin contributes to. */
export const inject = ['web']

/**
 * Register the search seat; it leaves with the plugin's fiber.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const backends = { 'deepseek-messages': deepseekMessages(ctx) }
  ctx.web.registerSearchProvider(createSearchSeat(SEARCH.providerId, () => backends['deepseek-messages']))
}
