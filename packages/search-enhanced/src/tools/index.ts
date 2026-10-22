import type { Context } from '@deepseek-ai/cordis'
import type { WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import type { CapabilityEnhanced } from 'dsh-tool-web-enhanced-core/host'
import { SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { searchListing } from '../host/listing.ts'
import type { SearchOptions } from '../host/options.ts'
import type { ResolvedSettings } from '../settings/resolve.ts'
import { searchTools } from './definitions.ts'

/** The search side of the enhanced tools (docs/design.md, "增强工具"). */
export function searchEnhanced(ctx: Context): CapabilityEnhanced<ResolvedSettings, SearchOptions, WebSearchRequest, WebSearchResult> {
  return {
    names: SEARCH.tools,
    tools: searchTools,
    listing: (connection, call) => searchListing(ctx, connection, call),
  }
}
