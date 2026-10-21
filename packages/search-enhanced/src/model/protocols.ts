import { isRecord, postJson, type SearchRow } from 'dsh-tool-web-enhanced-core/host'
import { MODEL_DEFAULTS, type ModelProtocol } from '../catalog.ts'
import type { HttpRequest } from '../search/http.ts'
import { text } from '../search/sources.ts'
import { DEEPSEEK_MESSAGES } from './deepseek.ts'
import type { ModelOptions, ModelRoute } from './types.ts'

export function modelUrl(protocol: ModelProtocol, baseURL: string): string {
  let end = baseURL.length
  while (end > 0 && baseURL.charCodeAt(end - 1) === 47) end--
  const base = baseURL.slice(0, end)
  switch (protocol) {
    case 'anthropic-messages': return base + (new URL(base).pathname.endsWith('/v1') ? '' : '/v1') + '/messages'
    case 'openai-responses': return base + '/responses'
    case 'openai-chat-completions': return base + '/chat/completions'
  }
}

export function modelRequest(route: ModelRoute, options: ModelOptions, query: string, secret: string): HttpRequest {
  const url = modelUrl(route.protocol, route.baseURL)
  const prompt = 'Perform a web search for the query: ' + query
  const approximate = optionalFields({ city: options.userCity, region: options.userRegion, country: options.userCountry === undefined ? undefined : options.userCountry.toUpperCase(), timezone: options.userTimezone })
  const hasLocation = Object.keys(approximate).length > 0
  const location = hasLocation ? { type: 'approximate', ...approximate } : undefined
  const allowedDomains = nonempty(options.allowedDomains)
  const blockedDomains = nonempty(options.blockedDomains)
  if (route.protocol === 'anthropic-messages') {
    const auth = route.auth.kind === 'account' ? { 'x-dsh-auth-token': secret } : { 'x-api-key': secret }
    const toolType = options.anthropicTool ?? (route.dialect === 'deepseek' ? DEEPSEEK_MESSAGES.anthropicTool : MODEL_DEFAULTS.anthropicTool)
    const tool = {
      type: toolType,
      name: 'web_search', max_uses: options.maxUses ?? MODEL_DEFAULTS.maxUses,
      ...optionalFields({
        allowed_domains: allowedDomains, blocked_domains: blockedDomains, user_location: location,
        allowed_callers: options.allowedCallers === undefined ? undefined : [options.allowedCallers], response_inclusion: toolType === 'web_search_20260318' ? options.responseInclusion : undefined,
      }),
    }
    return postJson(url, { ...auth, 'anthropic-version': '2023-06-01' }, {
      model: route.model, max_tokens: options.maxTokens ?? MODEL_DEFAULTS.maxTokens,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }], tools: [tool],
      ...(route.dialect === 'deepseek' ? { thinking: DEEPSEEK_MESSAGES.thinking } : {}),
    })
  }
  const headers = { authorization: 'Bearer ' + secret }
  switch (route.protocol) {
    case 'openai-responses': {
      const filters = allowedDomains === undefined && blockedDomains === undefined
        ? undefined : optionalFields({ allowed_domains: allowedDomains, blocked_domains: blockedDomains })
      return postJson(url, headers, {
        model: route.model, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
        tools: [{
          type: options.responsesTool ?? MODEL_DEFAULTS.responsesTool,
          ...optionalFields({ search_context_size: options.searchContextSize, filters, user_location: location, external_web_access: options.externalWebAccess, return_token_budget: options.returnTokenBudget }),
        }],
        tool_choice: 'auto', include: ['web_search_call.action.sources'], store: false, stream: false,
        ...optionalFields({ max_output_tokens: options.maxTokens }),
      })
    }
    case 'openai-chat-completions': return postJson(url, headers, {
      model: route.model, messages: [{ role: 'user', content: prompt }],
      web_search_options: optionalFields({ search_context_size: options.searchContextSize, user_location: hasLocation ? { type: 'approximate', approximate } : undefined }),
      stream: false, ...optionalFields({ max_completion_tokens: options.maxTokens }),
    })
  }
}

function nonempty(values: readonly string[] | undefined): readonly string[] | undefined {
  return values === undefined || values.length === 0 ? undefined : values
}

function optionalFields(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
}

export type ModelOutcome =
  | { readonly kind: 'answer'; readonly rows: readonly SearchRow[]; readonly content: string | undefined }
  | { readonly kind: 'failure'; readonly failure: 'invalid' }

const invalid = (): ModelOutcome => ({ kind: 'failure', failure: 'invalid' })
const answer = (rows: readonly SearchRow[], parts: readonly string[]): ModelOutcome => ({
  kind: 'answer', rows, content: parts.length === 0 ? undefined : parts.join('\n\n'),
})

export function parseModelResponse(protocol: ModelProtocol, payload: unknown): ModelOutcome {
  if (!isRecord(payload)) return invalid()
  switch (protocol) {
    case 'anthropic-messages': return parseMessages(payload)
    case 'openai-responses': return parseResponses(payload)
    case 'openai-chat-completions': return parseChat(payload)
  }
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function parseMessages(payload: Record<string, unknown>): ModelOutcome {
  if (!Array.isArray(payload.content)) return invalid()
  const rows: SearchRow[] = []
  const quotes = new Map<string, string>()
  const citations: SearchRow[] = []
  const blocks = records(payload.content)
  const parts = textParts(blocks, 'text')
  if (parts === undefined) return invalid()
  for (const block of blocks) {
    if (block.type !== 'text') continue
    for (const citation of records(block.citations)) {
      if (citation.type !== 'web_search_result_location') continue
      citations.push({ url: citation.url, title: citation.title, snippet: citation.cited_text })
      const url = text(citation.url)
      const quote = text(citation.cited_text)
      if (url !== undefined && quote !== undefined && !quotes.has(url)) quotes.set(url, quote)
    }
  }
  for (const block of blocks) {
    if (block.type !== 'web_search_tool_result') continue
    if (isRecord(block.content) && block.content.type === 'web_search_tool_result_error') continue
    if (!Array.isArray(block.content)) return invalid()
    for (const item of records(block.content)) {
      if (item.type !== 'web_search_result') continue
      const url = text(item.url)
      rows.push({ url: item.url, title: item.title, publishedAt: item.page_age, snippet: url === undefined ? undefined : quotes.get(url) })
    }
  }
  return answer([...rows, ...citations], parts)
}

// Citation boundaries do not create paragraphs; intervening tools/non-text do.
function textParts(blocks: readonly Record<string, unknown>[], type: string): string[] | undefined {
  const parts: string[] = []
  let adjacent = false
  for (const block of blocks) {
    if (block.type !== type) { adjacent = false; continue }
    if (typeof block.text !== 'string') return undefined
    if (adjacent) parts[parts.length - 1] += block.text
    else parts.push(block.text)
    adjacent = true
  }
  return parts
}

function parseResponses(payload: Record<string, unknown>): ModelOutcome {
  if (!Array.isArray(payload.output)) return invalid()
  const rows: SearchRow[] = []
  const parts: string[] = []
  for (const item of records(payload.output)) {
    if (item.type === 'web_search_call') {
      // action.url and queries may contain DeepSeek's ws_call_id markers, not sources.
      for (const source of records(isRecord(item.action) ? item.action.sources : undefined)) rows.push(sourceFields(source))
    } else if (item.type === 'message') {
      if (!Array.isArray(item.content)) return invalid()
      const blocks = records(item.content)
      const message = textParts(blocks, 'output_text')
      if (message === undefined) return invalid()
      if (message.length > 0) parts.push(message.join('\n\n'))
      for (const block of blocks) {
        if (block.type !== 'output_text') continue
        for (const annotation of records(block.annotations)) {
          if (annotation.type === 'url_citation') rows.push(sourceFields(annotation))
        }
      }
    }
  }
  return answer(rows, parts)
}

function parseChat(payload: Record<string, unknown>): ModelOutcome {
  if (!Array.isArray(payload.choices)) return invalid()
  const choice: unknown = payload.choices[0]
  if (!isRecord(choice) || !isRecord(choice.message)) return invalid()
  const message = choice.message
  const parts: string[] = []
  if (typeof message.content === 'string') parts.push(message.content)
  else if (Array.isArray(message.content)) {
    const content = textParts(records(message.content), 'text')
    if (content === undefined) return invalid()
    parts.push(...content)
  } else if (message.content !== undefined && message.content !== null) return invalid()
  const rows: SearchRow[] = []
  for (const annotation of records(message.annotations)) {
    if (annotation.type === 'url_citation' && isRecord(annotation.url_citation)) rows.push(sourceFields(annotation.url_citation))
  }
  if (Array.isArray(payload.citations)) {
    for (const citation of payload.citations) {
      if (typeof citation === 'string') rows.push({ url: citation })
      else if (isRecord(citation)) rows.push(sourceFields(citation))
    }
  }
  return answer(rows, parts)
}

function sourceFields(source: Record<string, unknown>): SearchRow {
  return { url: source.url, title: source.title }
}
