/**
 * web_fetch for DeepSeek Harness from switchable backends. The plugin
 * registers the `fetch-enhanced` provider in `ctx.web`; the profile bundle
 * selects it in the shared `web` row, and the model keeps DSH's own
 * web_fetch tool.
 * @module dsh-web-fetch-enhanced
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-web'
import { FETCH } from 'dsh-tool-web-enhanced-core/shared'
import { localBackend } from './backends/local.ts'
import { createFetchSeat } from './seat.ts'

/** Cordis plugin name used in Loader diagnostics; equal to the row id. */
export const name = FETCH.rowId

/** The capability seam this plugin contributes to. */
export const inject = ['web']

/**
 * Register the fetch seat; it leaves with the plugin's fiber.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const backends = { local: localBackend() }
  ctx.web.registerFetchProvider(createFetchSeat(FETCH.providerId, () => backends.local))
}
