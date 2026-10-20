/** Read-only facts the settings page derives from the effective settings and the catalog. */
import {
  connectionChoices as catalogChoices, connectionName as catalogConnectionName,
  type ClientTranslate, type Choice, type OptionCopy, type OptionCopyTable,
} from 'dsh-tool-web-enhanced-core/client'
import { CATALOG, type CatalogKey } from '../../catalog.ts'
import type { SearchSettings } from '../../settings/types.ts'
import type { Translate } from '../connections.ts'
import type { LocaleKey } from '../locales.ts'

const catalogLabel = (key: CatalogKey): string => CATALOG[key].label

/** Connections a default can name, in catalog order. */
export const connectionChoices = (config: SearchSettings, _t: Translate): Choice[] => catalogChoices(CATALOG, config, catalogLabel)

export const connectionName = (id: string, config: SearchSettings): string => catalogConnectionName(CATALOG, config, id, catalogLabel)

const OPTION_COPY: Readonly<Record<CatalogKey, Readonly<Record<string, OptionCopy<LocaleKey>>>>> = {
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

/** Copy for the options of one catalog entry. */
export const optionCopy = (key: CatalogKey): OptionCopyTable<LocaleKey> => ({ options: OPTION_COPY[key], fallback: 'options.title' })

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
