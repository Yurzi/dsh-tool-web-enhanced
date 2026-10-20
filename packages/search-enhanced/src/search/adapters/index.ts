import type { AdapterKey } from '../../catalog.ts'
import { exa } from './exa.ts'
import { firecrawl } from './firecrawl.ts'
import { openalex } from './openalex.ts'
import { semanticscholar } from './semanticscholar.ts'
import { tavily } from './tavily.ts'
import { tinyfish } from './tinyfish.ts'
import type { AdapterFor } from './types.ts'

export type { Adapter, Auth, McpRoute, SearchInput } from './types.ts'

export const ADAPTER_WIRES = { exa, firecrawl, tavily, tinyfish, openalex, semanticscholar } satisfies { readonly [K in AdapterKey]: AdapterFor<K> }
