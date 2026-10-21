import type { WebSearchSource } from '@deepseek-ai/dsh-web'
import type { AdapterWire, KeylessBound, SearchInput } from 'dsh-tool-web-enhanced-core/host'
import type { AdapterKey, CATALOG } from '../../catalog.ts'

export type Adapter = AdapterWire<SearchInput, WebSearchSource[]>
export type AdapterFor<K extends AdapterKey> = KeylessBound<typeof CATALOG[K]['access'], Adapter>
