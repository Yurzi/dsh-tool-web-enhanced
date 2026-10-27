import { exaFetch, firecrawlFetch, tavilyFetch, tinyfishFetch, anysearchFetch } from 'dsh-tool-web-enhanced-core/host'
import type { AdapterKey } from '../../catalog.ts'
import type { FetchWireFor } from '../types.ts'

export const ADAPTER_WIRES = {
  exa: exaFetch,
  firecrawl: firecrawlFetch,
  tavily: tavilyFetch,
  tinyfish: tinyfishFetch,
  anysearch: anysearchFetch,
} satisfies { readonly [K in AdapterKey]: FetchWireFor<K> }
