import type { Context } from '@deepseek-ai/cordis'
import type { WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import type { CapabilityEnhanced } from 'dsh-tool-web-enhanced-core/host'
import { FETCH } from 'dsh-tool-web-enhanced-core/shared'
import { fetchListing } from '../host/listing.ts'
import type { FetchOptions } from '../host/options.ts'
import type { ResolvedSettings } from '../settings/types.ts'
import { fetchTools } from './definitions.ts'

/** The fetch side of the enhanced tools (docs/design.md, "增强工具"). */
export function fetchEnhanced(_ctx: Context): CapabilityEnhanced<ResolvedSettings, FetchOptions, WebFetchRequest, WebFetchResult> {
  return { names: FETCH.tools, tools: fetchTools, listing: fetchListing }
}
