import type { BuiltinOverride as SharedBuiltinOverride } from 'dsh-tool-web-enhanced-core/shared'
import type { AdapterKey, Freshness } from '../catalog.ts'
import type { CURRENT_CONFIG_VERSION } from './version.ts'

export type BuiltinOverride = SharedBuiltinOverride
export interface CustomConnection {
  kind: 'adapter'
  adapter: AdapterKey
  label: string
  credentialRef: string
  endpoint?: string
  trustedEndpoint?: boolean
  disabled?: boolean
  options?: Record<string, unknown>
}
export interface SearchSettings {
  version?: typeof CURRENT_CONFIG_VERSION
  defaultConnection?: string
  showSelector?: boolean
  defaults?: { freshness?: Freshness }
  connections?: Record<string, BuiltinOverride | CustomConnection>
}
export type V2Config = SearchSettings
