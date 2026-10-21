/** Binds catalog keys to the core Fetch wire types; protocol implementations live in core. */
import type { FetchWire, KeylessBound } from 'dsh-tool-web-enhanced-core/host'
import type { AdapterKey, CATALOG } from '../catalog.ts'

/** A keyless catalog entry cannot compile without its anonymous route. */
export type FetchWireFor<K extends AdapterKey> = KeylessBound<typeof CATALOG[K]['access'], FetchWire>
