import type { BuiltinOverride as SharedBuiltinOverride, CustomConnection as SharedCustomConnection } from 'dsh-tool-web-enhanced-core/shared'
import type { AdapterKey, Freshness, ModelProtocol } from '../catalog.ts'
import type { CURRENT_CONFIG_VERSION } from './version.ts'

export type BuiltinOverride = SharedBuiltinOverride
export type CustomConnection = SharedCustomConnection<AdapterKey, ModelProtocol>
export interface SearchSettings {
  version?: typeof CURRENT_CONFIG_VERSION
  defaultConnection?: string
  showSelector?: boolean
  defaults?: { freshness?: Freshness }
  connections?: Record<string, BuiltinOverride | CustomConnection>
}
export type V2Config = SearchSettings
