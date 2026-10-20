import type { OptionsCodec } from 'dsh-tool-web-enhanced-core/host'
import type { ResolvedSettings } from '../settings/types.ts'

export type FetchOptions = Record<string, never>

/** Fetch has no per-session options; historical extra fields are ignored. */
export const optionsCodec: OptionsCodec<FetchOptions, ResolvedSettings> = {
  initial: () => ({}),
  fromRecord: () => ({}),
  toRecord: () => ({}),
}
