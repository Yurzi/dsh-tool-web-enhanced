/** Read-only facts the settings page derives from the effective settings and the catalog. */
import {
  connectionChoices as catalogChoices, connectionName as catalogConnectionName, protocolGroups,
  type ClientTranslate, type Choice, type OptionCopy, type OptionCopyTable, type OptionGroup,
} from 'dsh-tool-web-enhanced-core/client'
import { CATALOG, MODEL_PROTOCOLS, type CatalogKey, type ModelProtocol } from '../../catalog.ts'
import type { SearchSettings } from '../../settings/types.ts'
import type { Translate } from '../connections.ts'
import type { LocaleKey } from '../locales.ts'

/** Catalog names are service names, except the Session-model connection, which is described in the reader's language. */
export function localLabel(key: CatalogKey, t: ClientTranslate<LocaleKey>): string {
  return key === 'session-model' ? t('connection.sessionModel') : CATALOG[key].label
}

/** Connections a default can name, in catalog order. */
export const connectionChoices = (config: SearchSettings, t: Translate): Choice[] => catalogChoices(CATALOG, config, key => localLabel(key, t))

export const connectionName = (id: string, config: SearchSettings, t: ClientTranslate<LocaleKey>): string => catalogConnectionName(CATALOG, config, id, key => localLabel(key, t))

/** Model options; the group title (Conversation model) or the protocol (fixed connection) says where each applies. */
const MODEL_COPY = {
  maxTokens: { label: 'option.model.maxTokens', hint: 'option.model.maxTokens.hint' },
  anthropicTool: { label: 'option.model.anthropicTool', hint: 'option.model.anthropicTool.hint' },
  maxUses: { label: 'option.model.maxUses', hint: 'option.model.maxUses.hint' },
  allowedCallers: { label: 'option.model.allowedCallers', hint: 'option.model.allowedCallers.hint' },
  responseInclusion: { label: 'option.model.responseInclusion', hint: 'option.model.responseInclusion.hint' },
  responsesTool: { label: 'option.model.responsesTool', hint: 'option.model.responsesTool.hint' },
  searchContextSize: { label: 'option.model.searchContextSize', hint: 'option.model.searchContextSize.hint' },
  externalWebAccess: { label: 'option.model.externalWebAccess', hint: 'option.model.externalWebAccess.hint' },
  returnTokenBudget: { label: 'option.model.returnTokenBudget', hint: 'option.model.returnTokenBudget.hint' },
  allowedDomains: { label: 'option.model.allowedDomains', placeholder: 'option.model.domains.placeholder', hint: 'option.model.domains.sessionHint' },
  blockedDomains: { label: 'option.model.blockedDomains', placeholder: 'option.model.domains.placeholder', hint: 'option.model.domains.sessionHint' },
  // The location is explained once, on its first field.
  userCity: { label: 'option.model.userCity', hint: 'option.model.location.hint' },
  userRegion: { label: 'option.model.userRegion' },
  userCountry: { label: 'option.model.userCountry', placeholder: 'option.model.userCountry.placeholder' },
  userTimezone: { label: 'option.model.userTimezone', placeholder: 'option.model.userTimezone.placeholder' },
} as const satisfies Readonly<Record<string, OptionCopy<LocaleKey>>>

/**
 * A fixed connection speaks one protocol, so its hints say only what holds
 * there: that protocol's token default, whether it takes both domain lists,
 * and the tool default without the conversation model's DeepSeek rule.
 */
const PROTOCOL_HINTS = {
  'anthropic-messages': { maxTokens: 'option.model.maxTokens.anthropicHint', domains: 'option.model.domains.exclusiveHint' },
  'openai-responses': { maxTokens: 'option.model.maxTokens.responsesHint', domains: 'option.model.domains.bothHint' },
  'openai-chat-completions': { maxTokens: 'option.model.maxTokens.chatHint', domains: 'option.model.domains.bothHint' },
} as const satisfies Record<ModelProtocol, { readonly maxTokens: LocaleKey; readonly domains: LocaleKey }>

/** Copy for the options of one protocol of a custom model connection. */
export function protocolCopy(protocol: ModelProtocol): OptionCopyTable<LocaleKey> {
  const hints = PROTOCOL_HINTS[protocol]
  return { fallback: 'options.title', options: {
    ...MODEL_COPY,
    maxTokens: { ...MODEL_COPY.maxTokens, hint: hints.maxTokens },
    anthropicTool: { ...MODEL_COPY.anthropicTool, hint: 'option.model.anthropicTool.fixedHint' },
    allowedDomains: { ...MODEL_COPY.allowedDomains, hint: hints.domains },
    blockedDomains: { ...MODEL_COPY.blockedDomains, hint: hints.domains },
  } }
}

/** The Session-model connection takes every protocol's options; grouped by the protocols that apply them. */
export const SESSION_MODEL_GROUPS: readonly OptionGroup[] = protocolGroups(MODEL_PROTOCOLS)

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
  'session-model': MODEL_COPY,
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
  'full': 'value.full', 'excluded': 'value.excluded', 'default': 'value.default', 'unlimited': 'value.unlimited',
}

/** Localized enum value where it is a word; codes stay verbatim. */
export function valueLabel(value: string, t: ClientTranslate<LocaleKey>): string {
  const key = VALUE_LABELS[value]
  return key === undefined ? value : t(key)
}
