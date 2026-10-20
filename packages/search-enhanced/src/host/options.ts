import type { OptionsCodec } from 'dsh-tool-web-enhanced-core/host'
import { z } from 'zod'
import { FRESHNESS, type Freshness } from '../catalog.ts'
import type { ResolvedSettings } from '../settings/resolve.ts'

export type SearchOptions = { freshness: Freshness }
/** Preserve the predecessor's flat freshness field; old records materialize the current default. */
export const optionsCodec: OptionsCodec<SearchOptions, ResolvedSettings> = {
  initial: settings => ({ freshness: settings.defaults.freshness }),
  fromRecord: (record, settings) => ({ freshness: record.freshness === undefined ? settings.defaults.freshness : z.enum(FRESHNESS).parse(record.freshness) }),
  toRecord: options => options.freshness === undefined ? {} : { freshness: options.freshness },
}
