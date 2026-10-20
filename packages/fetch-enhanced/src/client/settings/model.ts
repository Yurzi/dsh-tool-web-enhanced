import { builtinId, type OptionRule } from 'dsh-tool-web-enhanced-core/shared'
import type { OptionField } from 'dsh-tool-web-enhanced-core/client'
import { CATALOG, type CatalogKey } from '../../catalog.ts'
import type { BuiltinOverride, FetchSettings } from '../../settings/types.ts'
import type { LocaleKey } from '../locales.ts'
import type { Translate } from '../connections.ts'

export function builtinOverride(config: FetchSettings, key: CatalogKey): BuiltinOverride {
  return config.connections === undefined ? {} : config.connections[builtinId(key)] ?? {}
}

export function credentialRefs(config: FetchSettings): string[] {
  const ref = builtinOverride(config, 'deepseek-fetch-api').credentialRef
  return [ref === undefined ? CATALOG['deepseek-fetch-api'].access.apiKey.credentialRef : ref]
}

export function connectionChoices(config: FetchSettings, t: Translate) {
  return (Object.keys(CATALOG) as CatalogKey[]).map(key => ({ id: builtinId(key), label: builtinOverride(config, key).label ?? (key === 'local' ? t('connection.local') : CATALOG[key].label) }))
}

export function optionFields(key: CatalogKey): { fields: OptionField<LocaleKey>[]; restricted: boolean } {
  if (key !== 'local') return { fields: [], restricted: false }
  const fields: OptionField<LocaleKey>[] = []
  for (const [name, rule] of Object.entries(CATALOG.local.options) as [keyof typeof CATALOG.local.options, OptionRule][]) {
    // The allowlist and User-Agent have their own editors: empty UA is a real value.
    if (rule.kind !== 'integer') continue
    fields.push({ name, label: ('option.local.' + name) as LocaleKey, kind: 'integer', values: [], min: rule.min, max: rule.max, placeholder: () => undefined })
  }
  return { fields, restricted: false }
}
