/** Read-only facts the settings page derives from the effective settings and the catalog. */
import {
  builtinId, CUSTOM_CONNECTION_ID, type AccessMode, type OptionRule,
} from 'dsh-tool-web-enhanced-core/shared'
import {
  CATALOG, type CatalogKey,
} from '../../catalog.ts'
import type { BuiltinOverride, CustomConnection, SearchSettings } from '../../settings/types.ts'
import type { Translate } from '../connections.ts'
import type { LocaleKey } from '../locales.ts'
import type { OptionField, ClientTranslate } from 'dsh-tool-web-enhanced-core/client'
export { fieldText, fieldValue, isValidText, applyFields, type FieldTexts } from 'dsh-tool-web-enhanced-core/client'

export const builtinOverride = (config: SearchSettings, key: CatalogKey): BuiltinOverride =>
  config.connections?.[builtinId(key)] ?? {}

export function customConnections(config: SearchSettings): [string, CustomConnection][] {
  return Object.entries(config.connections ?? {})
    .filter(([id]) => CUSTOM_CONNECTION_ID.test(id))
    .map(([id, connection]) => [id, connection as CustomConnection])
}

/** Built-in connections default to the anonymous route where one exists. */
export function builtinAccess(key: CatalogKey, override: BuiltinOverride): AccessMode {
  const info = CATALOG[key]
  return info.access.keyless ? (override.access ?? 'keyless') : 'api-key'
}

export const builtinCredentialRef = (key: CatalogKey, override: BuiltinOverride): string => {
  const info = CATALOG[key]
  const defaultRef = info.access.apiKey ? info.access.apiKey.credentialRef : ''
  return override.credentialRef ?? defaultRef
}

export const customCredentialRef = (connection: CustomConnection): string =>
  connection.credentialRef

/** Every credential reference the page reports on. */
export function credentialRefs(config: SearchSettings): string[] {
  return [...new Set([
    ...(Object.keys(CATALOG) as CatalogKey[]).map(key => builtinCredentialRef(key, builtinOverride(config, key))),
    ...customConnections(config).map(([, connection]) => customCredentialRef(connection)),
  ])].filter(ref => ref !== '')
}

export interface Choice { readonly id: string; readonly label: string }

/** Connections a default can name, in catalog order. */
export function connectionChoices(config: SearchSettings, _t: Translate): Choice[] {
  return [
    ...(Object.keys(CATALOG) as CatalogKey[]).map(key => ({
      id: builtinId(key),
      label: builtinOverride(config, key).label ?? CATALOG[key].label,
    })),
    ...customConnections(config).map(([id, connection]) => ({ id, label: connection.label })),
  ]
}

export type FieldSpec = OptionField<LocaleKey>

interface OptionCopy { readonly label: LocaleKey; readonly placeholder?: LocaleKey }

const OPTION_COPY: Record<string, Record<string, OptionCopy>> = {
  'deepseek-messages': {
    baseURL: { label: 'option.native.baseURL' },
    model: { label: 'option.native.model' },
    apiVersion: { label: 'option.native.apiVersion' },
    maxTokens: { label: 'option.native.maxTokens' },
    maxUses: { label: 'option.native.maxUses' },
  },
  'deepseek-search-api': {
    baseURL: { label: 'option.native.baseURL' },
    count: { label: 'option.native.count' },
    sendOriginalQuestion: { label: 'option.native.sendOriginalQuestion' },
  },
  exa: {
    type: { label: 'option.exa.type' },
  },
  firecrawl: {
    country: { label: 'option.firecrawl.country', placeholder: 'option.firecrawl.country.placeholder' },
    location: { label: 'option.firecrawl.location', placeholder: 'option.firecrawl.location.placeholder' },
    safe: { label: 'option.firecrawl.safe' },
  },
  tavily: {
    search_depth: { label: 'option.tavily.search_depth' },
    topic: { label: 'option.tavily.topic' },
  },
  tinyfish: {
    location: { label: 'option.tinyfish.location', placeholder: 'option.tinyfish.location.placeholder' },
    language: { label: 'option.tinyfish.language', placeholder: 'option.tinyfish.language.placeholder' },
    purpose: { label: 'option.tinyfish.purpose', placeholder: 'option.tinyfish.purpose.placeholder' },
    domain_type: { label: 'option.tinyfish.domain_type' },
  },
  openalex: {
    sort: { label: 'option.openalex.sort', placeholder: 'option.openalex.sort.placeholder' },
    filter: { label: 'option.openalex.filter', placeholder: 'option.openalex.filter.placeholder' },
    is_oa: { label: 'option.openalex.is_oa' },
    mailto: { label: 'option.openalex.mailto', placeholder: 'option.openalex.mailto.placeholder' },
  },
  semanticscholar: {
    year: { label: 'option.semanticscholar.year', placeholder: 'option.semanticscholar.year.placeholder' },
    fieldsOfStudy: { label: 'option.semanticscholar.fieldsOfStudy', placeholder: 'option.semanticscholar.fieldsOfStudy.placeholder' },
    publicationTypes: { label: 'option.semanticscholar.publicationTypes', placeholder: 'option.semanticscholar.publicationTypes.placeholder' },
  },
}

/** Options an adapter or native route accepts; the anonymous route drops or narrows some of them. */
export function adapterFields(key: CatalogKey, access: AccessMode): { fields: FieldSpec[]; restricted: boolean } {
  const descriptor = CATALOG[key]
  const copyMap = OPTION_COPY[key] ?? {}
  const fields: FieldSpec[] = []
  let restricted = false

  for (const [name, rule] of Object.entries(descriptor.options) as [string, OptionRule][]) {
    const isKeylessForbidden = 'keyless' in rule && rule.keyless === false
    if (access === 'keyless' && isKeylessForbidden) {
      restricted = true
      continue
    }
    let values: readonly string[] = []
    if (rule.kind === 'enum') {
      const keylessValues = 'keyless' in rule && Array.isArray(rule.keyless) ? rule.keyless : undefined
      values = access === 'keyless' && keylessValues ? keylessValues : rule.values
      if (values.length < rule.values.length) restricted = true
    }
    const copy = copyMap[name]
    const label: LocaleKey = copy ? copy.label : 'options.title'
    const placeholderValue = copy?.placeholder

    const fieldSpec: FieldSpec = {
      name,
      label,
      kind: rule.kind === 'list' ? 'text' : rule.kind,
      values,
      placeholder: t => placeholderValue ? t(placeholderValue) : undefined,
      ...(rule.kind === 'text' && rule.pattern ? { pattern: rule.pattern } : {}),
      ...(rule.kind === 'integer' ? { min: rule.min, max: rule.max } : {}),
    }
    fields.push(fieldSpec)
  }
  return { fields, restricted }
}

const VALUE_LABELS: Readonly<Record<string, LocaleKey>> = {
  'auto': 'value.auto', 'fast': 'value.fast', 'instant': 'value.instant', 'basic': 'value.basic', 'advanced': 'value.advanced',
  'ultra-fast': 'value.ultra-fast', 'general': 'value.general', 'news': 'value.news', 'finance': 'value.finance', 'web': 'value.web',
  'research_paper': 'value.research_paper', 'low': 'value.low', 'medium': 'value.medium', 'high': 'value.high',
}

/** Localized enum value where it is a word; codes stay verbatim. */
export function valueLabel(value: string, t: ClientTranslate<LocaleKey>): string {
  const key = VALUE_LABELS[value]
  return key === undefined ? value : t(key)
}

