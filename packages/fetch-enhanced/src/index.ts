/** Session-scoped fetch connections behind DSH's native web_fetch tool. */
import type { Context } from '@deepseek-ai/cordis'
import { settingsRow, type VolatileSettings } from 'dsh-tool-web-enhanced-core/host'
import { FETCH } from 'dsh-tool-web-enhanced-core/shared'
import { installFetch } from './host/runtime.ts'
import { resolveSettings, type ResolvedSettings } from './settings/resolve.ts'
import { RETIRED_FIELDS } from './settings/retired.ts'
import type { FetchSettings } from './settings/types.ts'

export const name = FETCH.rowId
export const inject = ['web']

export type ConfigValues = FetchSettings & Partial<Record<typeof RETIRED_FIELDS[number], unknown>>
export type Config = VolatileSettings<ConfigValues>
const row = settingsRow<ConfigValues, ResolvedSettings>({
  identity: FETCH, capabilityLabel: 'fetch', retiredFields: RETIRED_FIELDS,
  secretFields: [], resolve: resolveSettings,
})
export const Config = row.Config

export function apply(ctx: Context, config: Config): void {
  row.apply(ctx, config, installFetch)
}

export { resolveSettings }
export type { ResolvedSettings, FetchSettings }
