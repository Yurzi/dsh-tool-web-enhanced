/** Read-only facts the settings page derives from the effective settings and the catalog. */
import { builtinId } from 'dsh-tool-web-enhanced-core/shared'
import {
  connectionChoices as catalogChoices, connectionName as catalogConnectionName, credentialRefs as catalogCredentialRefs,
  type Choice, type ClientTranslate, type OptionCopy, type OptionCopyTable,
} from 'dsh-tool-web-enhanced-core/client'
import { CATALOG, type CatalogKey } from '../../catalog.ts'
import type { FetchSettings } from '../../settings/types.ts'
import { connectionLabel, type Translate } from '../connections.ts'
import type { LocaleKey } from '../locales.ts'
export { builtinOverride } from 'dsh-tool-web-enhanced-core/client'

/** Every credential reference the page reports on. */
export const credentialRefs = (config: FetchSettings): string[] => catalogCredentialRefs(CATALOG, config)

/** Catalog name of an entry; the local connection is named in the conversation's language. */
export const catalogLabel = (key: CatalogKey, t: Translate): string => connectionLabel({ id: builtinId(key), label: CATALOG[key].label }, t)

/** Connections a default can name, in catalog order. */
export const connectionChoices = (config: FetchSettings, t: Translate): Choice[] => catalogChoices(CATALOG, config, key => catalogLabel(key, t))

export const connectionName = (id: string, config: FetchSettings, t: Translate): string => catalogConnectionName(CATALOG, config, id, key => catalogLabel(key, t))

const OPTION_COPY: Readonly<Record<CatalogKey, Readonly<Record<string, OptionCopy<LocaleKey>>>>> = {
  local: {
    userAgent: { label: 'option.local.userAgent' },
    maxResponseBytes: { label: 'option.local.maxResponseBytes' },
    maxBodyChars: { label: 'option.local.maxBodyChars' },
    timeoutMs: { label: 'option.local.timeoutMs' },
    maxRedirects: { label: 'option.local.maxRedirects' },
  },
  'deepseek-fetch-api': {
    baseURL: { label: 'option.native.baseURL' },
  },
  exa: {
    maxAgeHours: { label: 'option.exa.maxAgeHours', placeholder: 'option.exa.maxAgeHours.placeholder', hint: 'option.exa.maxAgeHours.hint' },
    livecrawlTimeout: { label: 'option.exa.livecrawlTimeout' },
  },
  firecrawl: {
    onlyMainContent: { label: 'option.firecrawl.onlyMainContent' },
    maxAge: { label: 'option.firecrawl.maxAge', placeholder: 'option.firecrawl.maxAge.placeholder', hint: 'option.firecrawl.maxAge.hint' },
    storeInCache: { label: 'option.firecrawl.storeInCache' },
    timeout: { label: 'option.firecrawl.timeout' },
    waitFor: { label: 'option.firecrawl.waitFor' },
    proxy: { label: 'option.firecrawl.proxy' },
  },
  tavily: {
    extract_depth: { label: 'option.tavily.extract_depth' },
    format: { label: 'option.tavily.format' },
    timeout: { label: 'option.tavily.timeout' },
  },
  tinyfish: {
    ttl: { label: 'option.tinyfish.ttl', placeholder: 'option.tinyfish.ttl.placeholder', hint: 'option.tinyfish.ttl.hint' },
    per_url_timeout_ms: { label: 'option.tinyfish.per_url_timeout_ms' },
  },
}

/** Copy for the options of one catalog entry; an option without copy yet falls back to a generic label. */
export const optionCopy = (key: CatalogKey): OptionCopyTable<LocaleKey> => ({ options: OPTION_COPY[key], fallback: 'options.title' })

/** How each remote service handles what it receives, as far as its published terms say. */
export const SERVICE_NOTES = {
  exa: 'services.note.exa',
  firecrawl: 'services.note.firecrawl',
  tavily: 'services.note.tavily',
  tinyfish: 'services.note.tinyfish',
} as const satisfies Partial<Record<CatalogKey, LocaleKey>>

const VALUE_LABELS: Readonly<Record<string, LocaleKey>> = {
  auto: 'value.auto', basic: 'value.basic', enhanced: 'value.enhanced', advanced: 'value.advanced', markdown: 'value.markdown', text: 'value.text',
}

/** Localized enum value where it is a word; codes stay verbatim. */
export function valueLabel(value: string, t: ClientTranslate<LocaleKey>): string {
  const key = Object.hasOwn(VALUE_LABELS, value) ? VALUE_LABELS[value] : undefined
  return key === undefined ? value : t(key)
}
