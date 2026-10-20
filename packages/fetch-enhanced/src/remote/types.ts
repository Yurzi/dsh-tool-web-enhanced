/** The fetch side of the shared adapter wire; adding an adapter starts in src/catalog.ts. */
import type { AdapterWire, KeylessBound } from 'dsh-tool-web-enhanced-core/host'
import type { AdapterKey, CATALOG } from '../catalog.ts'
import type { PageOutcome } from './page.ts'

export interface FetchInput {
  /** The URL exactly as requested; remote services own target access policy. */
  readonly url: string
  /** Options already validated against the catalog rules for this access. */
  readonly options: Readonly<Record<string, unknown>>
}

export type FetchWire = AdapterWire<FetchInput, PageOutcome>

/** A keyless catalog entry cannot compile without its anonymous route. */
export type FetchWireFor<K extends AdapterKey> = KeylessBound<typeof CATALOG[K]['access'], FetchWire>
