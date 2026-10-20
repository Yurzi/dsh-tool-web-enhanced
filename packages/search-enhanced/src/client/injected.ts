import type { SettingsPageInjected as CoreSettingsPageInjected } from 'dsh-tool-web-enhanced-core/client'
import type { SearchSettings } from '../settings/types.ts'
export type { CredentialStatusMap, PairingsState } from 'dsh-tool-web-enhanced-core/client'
export type SettingsPageInjected = CoreSettingsPageInjected<SearchSettings>
