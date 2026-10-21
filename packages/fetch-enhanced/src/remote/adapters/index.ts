import { exaFetch, firecrawlFetch, tavilyFetch, tinyfishFetch } from 'dsh-tool-web-enhanced-core/host'
import type { AdapterKey } from '../../catalog.ts'
import type { FetchWireFor } from '../types.ts'

export const ADAPTER_WIRES = {
  exa: exaFetch,
  firecrawl: firecrawlFetch,
  tavily: tavilyFetch,
  tinyfish: tinyfishFetch,
} satisfies { readonly [K in AdapterKey]: FetchWireFor<K> }
