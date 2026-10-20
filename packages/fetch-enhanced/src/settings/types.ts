import type { BuiltinOverride, ResolvedDocument } from 'dsh-tool-web-enhanced-core/shared'
import type { CURRENT_CONFIG_VERSION } from './version.ts'
export type { BuiltinOverride } from 'dsh-tool-web-enhanced-core/shared'

export interface LocalSettings {
  readonly allowCidrs: readonly string[]
  readonly allowHostnames: readonly string[]
  readonly userAgent: string
  readonly maxResponseBytes: number
  readonly maxBodyChars: number
  readonly timeoutMs: number
  readonly maxRedirects: number
}

export interface FetchSettings {
  version?: typeof CURRENT_CONFIG_VERSION
  showSelector?: boolean
  defaults?: Record<string, never>
  defaultConnection?: string
  connections?: Record<string, BuiltinOverride>
}

interface ConnectionBase {
  readonly id: string
  readonly label: string
  readonly disabled: boolean
  readonly remote: boolean
  readonly trustedEndpoint: boolean
}

export interface LocalConnection extends ConnectionBase {
  readonly kind: 'local'
  readonly access: 'keyless'
  readonly options: LocalSettings
}

export interface NativeConnection extends ConnectionBase {
  readonly kind: 'native'
  readonly access: 'api-key'
  readonly native: 'deepseek-fetch-api'
  readonly credentialRef: string
  readonly options: Readonly<Record<string, unknown>>
}

export type Connection = LocalConnection | NativeConnection

export type ResolvedSettings = ResolvedDocument<Record<string, never>, Connection>

export type V2Config = FetchSettings
