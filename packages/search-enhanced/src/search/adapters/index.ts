import { exaSearch, firecrawlSearch, tavilySearch, tinyfishSearch, openalexSearch, semanticscholarSearch, mapWire } from 'dsh-tool-web-enhanced-core/host'
import type { AdapterKey } from '../../catalog.ts'
import { searchSources } from '../adapter-result.ts'
import type { AdapterFor } from './types.ts'

export const ADAPTER_WIRES = {
  exa: mapWire(exaSearch, searchSources),
  firecrawl: mapWire(firecrawlSearch, searchSources),
  tavily: mapWire(tavilySearch, searchSources),
  tinyfish: mapWire(tinyfishSearch, searchSources),
  openalex: mapWire(openalexSearch, searchSources),
  semanticscholar: mapWire(semanticscholarSearch, searchSources),
} satisfies { readonly [K in AdapterKey]: AdapterFor<K> }
