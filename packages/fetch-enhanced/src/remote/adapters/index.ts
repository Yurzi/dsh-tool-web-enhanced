import type { AdapterKey } from '../../catalog.ts'
import type { FetchWireFor } from '../types.ts'
import { exa } from './exa.ts'
import { firecrawl } from './firecrawl.ts'
import { tavily } from './tavily.ts'
import { tinyfish } from './tinyfish.ts'

export const ADAPTER_WIRES = { exa, firecrawl, tavily, tinyfish } satisfies { readonly [K in AdapterKey]: FetchWireFor<K> }
