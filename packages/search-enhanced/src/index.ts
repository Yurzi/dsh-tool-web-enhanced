/** Session-scoped search connections behind DSH's native web_search tool. */
import type { Context } from '@deepseek-ai/cordis'
import { settingsRow, type VolatileSettings } from 'dsh-tool-web-enhanced-core/host'
import { SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { installSearch } from './host/runtime.ts'
import { resolveSettings, type ResolvedSettings } from './settings/resolve.ts'
import { RETIRED_FIELDS } from './settings/retired.ts'
import type { SearchSettings } from './settings/types.ts'

export const name = SEARCH.rowId
export const inject = ['web']

export type ConfigValues = SearchSettings & Partial<Record<typeof RETIRED_FIELDS[number], unknown>>
export type Config = VolatileSettings<ConfigValues>
const row = settingsRow<ConfigValues, ResolvedSettings>({
  identity: SEARCH, capabilityLabel: 'search', retiredFields: RETIRED_FIELDS,
  secretFields: ['apiKey'], resolve: resolveSettings,
})
export const Config = row.Config

export function apply(ctx: Context, config: Config): void {
  row.apply(ctx, config, installSearch)
}

export { resolveSettings }
export type { ResolvedSettings, SearchSettings }
