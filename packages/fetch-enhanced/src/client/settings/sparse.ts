import { createSparseSettings } from 'dsh-tool-web-enhanced-core/client'
import { CURRENT_SETTINGS_VERSION, SETTINGS_FIELDS } from 'dsh-tool-web-enhanced-core/shared'
export type { SettingsLayers, DocumentVersion } from 'dsh-tool-web-enhanced-core/client'

export const { documentVersion, sparseSettingOperations, resetSettingsOperations } = createSparseSettings({
  version: CURRENT_SETTINGS_VERSION, fields: SETTINGS_FIELDS,
})
