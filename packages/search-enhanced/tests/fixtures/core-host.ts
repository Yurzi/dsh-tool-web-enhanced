/** Search parameters for legacy regression tests; production imports core directly. */
import type { Context } from '@deepseek-ai/cordis'
import { Sessions, SessionStorage, ToolRestriction, Snapshots as CoreSnapshots, selectionDomain, providerView as view, routeFacts, type Plan } from 'dsh-tool-web-enhanced-core/host'
import { SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import type { Freshness } from '../../src/catalog.ts'
import type { SearchConnectionView } from '../../src/contract.ts'
import { optionsCodec, type SearchOptions } from '../../src/host/options.ts'
import { searchError } from '../../src/search/errors.ts'
import type { ResolvedSettings } from '../../src/settings/resolve.ts'
import type { StoredSelection as CoreStoredSelection } from 'dsh-tool-web-enhanced-core/host'

export const providerView = () => view(SEARCH.providerId, 'searchProvider')
export const currentRoute = (ctx: Context) => routeFacts(ctx, 'searchProvider', SEARCH.providerId)
export const routed = (ctx: Context): boolean => currentRoute(ctx).kind === 'this'
export const searchDomain = selectionDomain('web_search_enhanced')
export type StoredSelection = CoreStoredSelection & { readonly freshness?: Freshness }
export const SearchSessions = Sessions<SearchOptions, ResolvedSettings, SearchConnectionView>
export type SearchSessions = Sessions<SearchOptions, ResolvedSettings, SearchConnectionView>

export class SearchStorage extends SessionStorage<SearchOptions, ResolvedSettings> {
  constructor(ctx: Context) { super(ctx, 'web_search_enhanced', optionsCodec, () => searchError('WEB_PROVIDER_ERROR', 'search selection storage is unavailable; retry or ask the user to check the DSH storage backend')) }
}
export class SearchRestriction extends ToolRestriction {
  constructor(ctx: Context) { super(ctx, { tool: 'web_search', routed: () => routed(ctx) }) }
}

/** Generic snapshot tests deliberately include a payload that is not a runtime Plan. */
export type SearchPlan = Plan<SearchOptions> | { readonly kind: 'invalid'; readonly connectionId: string }
export const Snapshots = CoreSnapshots<SearchPlan>
